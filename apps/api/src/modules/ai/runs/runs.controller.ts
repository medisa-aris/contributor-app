import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { PERMISSIONS, type ConversationMode } from '@bara/shared';
import type { Response } from 'express';
import { CurrentAuth } from '../../../common/decorators/current-auth.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { AppError, ERROR_CODES } from '../../../common/errors/app-error';
import type { AuthContext } from '../../../common/types/auth-context';
import { AI_LIMITS } from '../limits';
import { WebSearchService } from '../web-search/web-search.service';
import { FINAL_RUN_STATUSES, runDto, RunsService } from './runs.service';

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

export class CreateRunDto {
  @IsIn(['second_brain', 'counterpart']) mode: ConversationMode;
  @IsString() @MinLength(1) @MaxLength(AI_LIMITS.maxPromptLength) prompt: string;
  @IsOptional() @IsUUID() conversationId?: string;
  @IsOptional() @IsString() counterpartStyle?: string;
  @IsOptional() @IsBoolean() webSearch?: boolean;
  @IsOptional() @IsUUID() modelId?: string;
  @IsOptional() @IsIn(EFFORTS) effort?: string;
  @IsOptional() @IsInt() @Min(20000) tokenBudget?: number;
  @IsOptional() @IsInt() @Min(1) @Max(24 * 60) maxMinutes?: number;
}

export class ContinueRunDto {
  @IsOptional() @IsInt() @Min(1) @Max(1000) extraIterations?: number;
  @IsOptional() @IsInt() @Min(1) @Max(24 * 60) extraMinutes?: number;
  @IsOptional() @IsUUID() modelId?: string;
}

export class RunListQueryDto {
  @IsOptional() @IsIn(['active', 'recent']) status?: 'active' | 'recent';
}

export class EventsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) after?: number;
}

export class LongRunSettingsDto {
  @IsInt() @Min(1) @Max(24 * 60) maxMinutes: number;
  @IsInt() @Min(1) @Max(1000) maxIterations: number;
  @IsInt() @Min(1) @Max(20) maxConcurrentPerUser: number;
  @IsBoolean() autoPromote: boolean;
  @ValidateIf((_, v) => v !== null) @IsInt() @Min(20000) defaultTokenBudget: number | null;
}

const SSE_POLL_MS = 1000;

/** Kerja panjang (§14.9): mulai, pantau (SSE dapat diputar ulang), hentikan, lanjutkan. */
@ApiTags('ai-runs')
@Controller()
export class RunsController {
  constructor(
    private readonly runs: RunsService,
    private readonly webSearch: WebSearchService,
  ) {}

  @RequirePermission(PERMISSIONS.workspaceAccess)
  @Post('ai/runs')
  async create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateRunDto) {
    const required = dto.mode === 'second_brain' ? PERMISSIONS.secondBrainQuery : PERMISSIONS.counterpartAnalyze;
    if (!auth.effective.allowed.has(required)) {
      throw new AppError(ERROR_CODES.forbidden, `Butuh izin ${required}.`, 403, { required, missing: [required] });
    }
    this.webSearch.assertAllowed(auth, dto.webSearch);
    return this.runs.create(auth, dto);
  }

  @RequirePermission(PERMISSIONS.workspaceAccess)
  @Get('ai/runs')
  list(@CurrentAuth() auth: AuthContext, @Query() query: RunListQueryDto) {
    return this.runs.list(auth.user.id, query.status !== 'recent');
  }

  @RequirePermission(PERMISSIONS.workspaceAccess)
  @Get('ai/runs/:id')
  async get(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return runDto(await this.runs.owned(auth, id));
  }

  /**
   * SSE: putar ulang event setelah `Last-Event-ID` (atau ?after=), lalu ikuti event baru.
   * Memutus koneksi tidak memengaruhi run.
   */
  @RequirePermission(PERMISSIONS.workspaceAccess)
  @Get('ai/runs/:id/events')
  async events(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: EventsQueryDto,
    @Headers('last-event-id') lastEventId: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    await this.runs.owned(auth, id);
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    let closed = false;
    res.on('close', () => {
      closed = true;
    });
    let after = Number(lastEventId ?? query.after ?? 0) || 0;
    while (!closed) {
      const events = await this.runs.eventsAfter(id, after);
      for (const event of events) {
        res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
        after = event.id;
      }
      if (events.length === 0) {
        const run = await this.runs.find(id);
        if (!run || FINAL_RUN_STATUSES.includes(run.status) || run.status === 'waiting_approval') {
          // Semua event sudah terkirim dan run berhenti.
          const rest = await this.runs.eventsAfter(id, after);
          if (rest.length === 0) break;
          continue;
        }
        res.write(': keep-alive\n\n');
        await new Promise((resolve) => setTimeout(resolve, SSE_POLL_MS));
      }
    }
    if (!closed) res.end();
  }

  @RequirePermission(PERMISSIONS.workspaceAccess)
  @HttpCode(200)
  @Post('ai/runs/:id/cancel')
  cancel(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.runs.cancel(auth, id);
  }

  @RequirePermission(PERMISSIONS.workspaceAccess)
  @HttpCode(200)
  @Post('ai/runs/:id/continue')
  continueRun(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ContinueRunDto) {
    return this.runs.continueRun(auth, id, dto);
  }

  @RequirePermission(PERMISSIONS.modelsManage)
  @Get('admin/ai/runs')
  adminRuns() {
    return this.runs.list(null, true);
  }

  @RequirePermission(PERMISSIONS.modelsManage)
  @HttpCode(200)
  @Post('admin/ai/runs/:id/cancel')
  adminCancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.runs.cancel(null, id);
  }

  @RequirePermission(PERMISSIONS.modelsManage)
  @Get('admin/ai/long-run-settings')
  settings() {
    return this.runs.settings();
  }

  @RequirePermission(PERMISSIONS.modelsManage)
  @Put('admin/ai/long-run-settings')
  saveSettings(@CurrentAuth() auth: AuthContext, @Body() dto: LongRunSettingsDto) {
    return this.runs.saveSettings(auth.user.id, dto);
  }
}
