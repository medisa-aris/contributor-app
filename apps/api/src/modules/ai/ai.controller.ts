import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type AiTaskStatus, type ConversationMode } from '@bara/shared';
import type { Response } from 'express';
import { ATTACHMENT_LIMITS, AttachmentsService } from './attachments.service';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { paginated } from '../admin/common/pagination';
import type { AuthContext } from '../../common/types/auth-context';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import { ConversationsService } from './conversations.service';
import {
  AddUrlAttachmentDto,
  ChatRequestDto,
  ConversationListQueryDto,
  CreateConversationDto,
  CreateTaskDto,
  TaskListQueryDto,
  UpdateAttachmentDto,
  UpdateConversationDto,
} from './dto/ai.dto';
import { AiGatewayService } from './gateway.service';
import { TasksService } from './tasks.service';
import type { ChatResult } from './providers/types';

function sseWrite(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

@ApiTags('ai-workspace')
@Controller('ai')
export class AiController {
  constructor(
    private readonly gateway: AiGatewayService,
    private readonly conversations: ConversationsService,
    private readonly attachments: AttachmentsService,
    private readonly tasks: TasksService,
  ) {}

  /** Chat sinkron untuk mode Multi Brain / Partner. */
  @HttpCode(200)
  @Post('chat')
  async chat(@CurrentAuth() auth: AuthContext, @Body() dto: ChatRequestDto) {
    this.assertModePermission(auth, dto.mode);
    const prepared = await this.conversations.prepareTurn(auth, dto);
    const context = await this.attachments.chatContext(prepared.id);
    const result = await this.gateway.chat({
      mode: dto.mode,
      counterpartStyle: dto.counterpartStyle,
      messages: this.conversations.toChatMessages(prepared.history),
      extraContext: context.text ?? undefined,
      images: context.images.length > 0 ? context.images : undefined,
    });
    const assistant = await this.conversations.completeTurn(prepared.id, {
      content: result.content,
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    });
    const conversation = await this.conversations.detail(auth, prepared.id);
    return { conversation, assistant };
  }

  /** Chat streaming (SSE) — dipanggil dengan fetch + ReadableStream dari browser. */
  @HttpCode(200)
  @Post('chat/stream')
  async chatStream(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: ChatRequestDto,
    @Res() res: Response,
  ): Promise<void> {
    this.assertModePermission(auth, dto.mode);
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Klien menekan Stop = koneksi ditutup. Batalkan juga permintaan ke provider
    // agar jawaban tidak tersimpan setelah pengguna menghentikannya.
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });

    try {
      const prepared = await this.conversations.prepareTurn(auth, dto);
      const context = await this.attachments.chatContext(prepared.id);
      sseWrite(res, 'ready', { conversationId: prepared.id });
      const stream = this.gateway.stream({
        mode: dto.mode,
        counterpartStyle: dto.counterpartStyle,
        messages: this.conversations.toChatMessages(prepared.history),
        signal: abort.signal,
        extraContext: context.text ?? undefined,
        images: context.images.length > 0 ? context.images : undefined,
      });
      let final: ChatResult | null = null;
      for (;;) {
        const next = await stream.next();
        if (next.done) {
          final = next.value;
          break;
        }
        sseWrite(res, 'delta', { text: next.value });
      }
      if (!final) {
        throw new AppError(
          ERROR_CODES.aiUpstreamError,
          'Aliran jawaban terputus sebelum selesai.',
          502,
        );
      }
      const assistant = await this.conversations.completeTurn(prepared.id, {
        content: final.content,
        model: final.model,
        tokensIn: final.tokensIn,
        tokensOut: final.tokensOut,
      });
      sseWrite(res, 'done', { conversationId: prepared.id, message: assistant });
      res.end();
    } catch (error) {
      if (abort.signal.aborted) return;
      const status =
        typeof (error as { status?: number }).status === 'number'
          ? (error as { status: number }).status
          : 500;
      const code = (error as { code?: string }).code ?? 'INTERNAL_ERROR';
      const message = error instanceof Error ? error.message : 'Kesalahan tidak dikenal.';
      sseWrite(res, 'error', { status, code, message });
      res.end();
    }
  }

  @RequirePermission(PERMISSIONS.workspaceHistoryRead)
  @Get('conversations')
  async listConversations(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ConversationListQueryDto,
  ) {
    const { items, total } = await this.conversations.list(auth, {
      mode: query.mode,
      search: query.search,
      skip: query.skip,
      take: query.pageSize,
    });
    return paginated(items, { page: query.page, limit: query.pageSize, offset: query.skip }, total);
  }

  /** Draf percakapan agar lampiran bisa diunggah sebelum pesan pertama. */
  @RequirePermission(PERMISSIONS.secondBrainQuery)
  @Post('conversations')
  createConversation(@CurrentAuth() auth: AuthContext, @Body() dto: CreateConversationDto) {
    return this.conversations.createDraft(auth, dto.mode);
  }

  @RequirePermission(PERMISSIONS.secondBrainQuery)
  @Get('conversations/:id/attachments')
  listAttachments(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ) {
    return this.attachments.list(auth, id);
  }

  @RequirePermission(PERMISSIONS.secondBrainQuery)
  @Post('conversations/:id/attachments')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: ATTACHMENT_LIMITS.maxFileBytes, files: 1 },
    }),
  )
  uploadAttachment(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new AppError(ERROR_CODES.validation, 'Pilih berkas yang akan diunggah.', 400);
    }
    return this.attachments.upload(auth, id, file);
  }

  @RequirePermission(PERMISSIONS.secondBrainQuery)
  @Post('conversations/:id/attachments/url')
  addUrlAttachment(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Body() dto: AddUrlAttachmentDto,
  ) {
    return this.attachments.addUrl(auth, id, dto.url);
  }

  @RequirePermission(PERMISSIONS.secondBrainQuery)
  @Patch('conversations/:id/attachments/:attachmentId')
  updateAttachment(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Param('attachmentId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) attachmentId: string,
    @Body() dto: UpdateAttachmentDto,
  ) {
    return this.attachments.updateEnabled(auth, id, attachmentId, dto.enabled);
  }

  @RequirePermission(PERMISSIONS.secondBrainQuery)
  @Delete('conversations/:id/attachments/:attachmentId')
  async removeAttachment(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Param('attachmentId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) attachmentId: string,
  ) {
    await this.attachments.remove(auth, id, attachmentId);
    return { deleted: true };
  }

  @RequirePermission(PERMISSIONS.workspaceHistoryRead)
  @Get('conversations/:id')
  conversationDetail(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ) {
    return this.conversations.detail(auth, id);
  }

  @RequirePermission(PERMISSIONS.workspaceHistoryRead)
  @Delete('conversations/:id')
  async removeConversation(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ) {
    await this.conversations.remove(auth, id);
    return { deleted: true };
  }

  @RequirePermission(PERMISSIONS.workspaceHistoryRead)
  @Patch('conversations/:id')
  updateConversation(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Body() dto: UpdateConversationDto,
  ) {
    return this.conversations.update(auth, id, dto);
  }

  @HttpCode(200)
  @Post('conversations/:id/regenerate')
  async regenerateConversation(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ) {
    const prepared = await this.conversations.prepareRegenerate(auth, id);
    this.assertModePermission(auth, prepared.mode);
    const context = await this.attachments.chatContext(prepared.id);
    const result = await this.gateway.chat({
      mode: prepared.mode,
      counterpartStyle: prepared.counterpartStyle ?? undefined,
      messages: this.conversations.toChatMessages(prepared.history),
      extraContext: context.text ?? undefined,
      images: context.images.length > 0 ? context.images : undefined,
    });
    const assistant = await this.conversations.replaceAssistant(
      prepared.id,
      prepared.previousAssistantId,
      {
        content: result.content,
        model: result.model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
      },
    );
    const conversation = await this.conversations.detail(auth, prepared.id);
    return { conversation, assistant };
  }

  @RequirePermission(PERMISSIONS.subordinateExecute)
  @Post('tasks')
  createTask(@CurrentAuth() auth: AuthContext, @Body() dto: CreateTaskDto) {
    return this.tasks.create(auth, dto);
  }

  @RequirePermission(PERMISSIONS.subordinateExecute)
  @Get('tasks')
  async listTasks(@CurrentAuth() auth: AuthContext, @Query() query: TaskListQueryDto) {
    const { items, total } = await this.tasks.list(auth, {
      status: query.status as AiTaskStatus | undefined,
      skip: query.skip,
      take: query.pageSize,
    });
    return paginated(items, { page: query.page, limit: query.pageSize, offset: query.skip }, total);
  }

  @RequirePermission(PERMISSIONS.subordinateExecute)
  @Get('tasks/:id')
  taskDetail(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ) {
    return this.tasks.detail(auth, id);
  }

  @RequirePermission(PERMISSIONS.subordinateExecute)
  @HttpCode(200)
  @Post('tasks/:id/run')
  runTask(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ) {
    return this.tasks.run(auth, id);
  }

  @RequirePermission(PERMISSIONS.subordinateExecute)
  @HttpCode(200)
  @Post('tasks/:id/cancel')
  cancelTask(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ) {
    return this.tasks.cancel(auth, id);
  }

  private assertModePermission(auth: AuthContext, mode: ConversationMode): void {
    const required =
      mode === 'second_brain' ? PERMISSIONS.secondBrainQuery : PERMISSIONS.counterpartAnalyze;
    if (!auth.effective.allowed.has(required)) {
      // PermissionGuard menolak route ber-permission tetap; pemeriksaan ini
      // mengamankan endpoint gabungan yang izinnya bergantung isi body.
      throw new AppError(ERROR_CODES.forbidden, `Butuh izin ${required}.`, 403, {
        required,
        missing: [required],
      });
    }
  }
}
