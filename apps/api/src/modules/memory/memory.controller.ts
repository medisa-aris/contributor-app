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
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type MemoryContextKind } from '@bara/shared';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import type { AuthContext } from '../../common/types/auth-context';
import { paginated } from '../admin/common/pagination';
import {
  CreateMemoryEntryDto,
  MemoryEntryListQueryDto,
  SetContextDoorsDto,
  SetMemoryDoorDto,
  UpdateMemoryEntryDto,
} from './dto/memory.dto';
import { MemoryScopeService } from './memory-scope.service';
import { MemoryService } from './memory.service';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

function contextKind(kind: string): MemoryContextKind {
  if (kind === 'conversation' || kind === 'task') return kind;
  throw new AppError(ERROR_CODES.notFound, 'Konteks tidak dikenal.', 404);
}

/**
 * Memori terpusat. Atasan tidak pernah mendapat endpoint untuk membaca catatan bawahan;
 * catatan hanya sampai ke atasan di dalam jawaban AI, beratribusi dan tercatat di log akses.
 */
@ApiTags('memory')
@Controller('memory')
export class MemoryController {
  constructor(
    private readonly memory: MemoryService,
    private readonly scope: MemoryScopeService,
  ) {}

  @Get('status')
  status() {
    return this.memory.status();
  }

  // ── Buku saya ──

  @RequirePermission(PERMISSIONS.memorySelfManage)
  @Get('me/summary')
  async mySummary(@CurrentAuth() auth: AuthContext) {
    return this.memory.summary(await this.memory.bookSubject(auth));
  }

  @RequirePermission(PERMISSIONS.memorySelfManage)
  @Get('me/entries')
  async myEntries(@CurrentAuth() auth: AuthContext, @Query() query: MemoryEntryListQueryDto) {
    const subject = await this.memory.bookSubject(auth);
    const { items, total } = await this.memory.listEntries(subject, {
      ...query,
      skip: query.skip,
      take: query.pageSize,
    });
    return paginated(items, { page: query.page, limit: query.pageSize, offset: query.skip }, total);
  }

  @RequirePermission(PERMISSIONS.memorySelfManage)
  @Post('me/entries')
  async createMyEntry(@CurrentAuth() auth: AuthContext, @Body() dto: CreateMemoryEntryDto) {
    return this.memory.createEntry(auth, await this.memory.bookSubject(auth), dto);
  }

  @RequirePermission(PERMISSIONS.memorySelfManage)
  @Patch('me/entries/:id')
  async updateMyEntry(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateMemoryEntryDto,
  ) {
    return this.memory.updateEntry(await this.memory.bookSubject(auth), id, dto);
  }

  @RequirePermission(PERMISSIONS.memorySelfManage)
  @Delete('me/entries/:id')
  async deleteMyEntry(@CurrentAuth() auth: AuthContext, @Param('id', uuid) id: string) {
    await this.memory.deleteEntry(auth, await this.memory.bookSubject(auth), id);
    return { deleted: true };
  }

  @RequirePermission(PERMISSIONS.memorySelfManage)
  @Get('me/door')
  async myDoor(@CurrentAuth() auth: AuthContext) {
    return this.memory.door(await this.memory.bookSubject(auth));
  }

  @RequirePermission(PERMISSIONS.memorySelfManage)
  @Put('me/door')
  async setMyDoor(@CurrentAuth() auth: AuthContext, @Body() dto: SetMemoryDoorDto) {
    return this.memory.setDoor(auth, await this.memory.bookSubject(auth), dto);
  }

  @RequirePermission(PERMISSIONS.memorySelfManage)
  @Get('me/access-log')
  async myAccessLog(@CurrentAuth() auth: AuthContext, @Query() query: PaginationQueryDto) {
    const { items, total } = await this.memory.accessLog(
      await this.memory.bookSubject(auth),
      query.skip,
      query.pageSize,
    );
    return paginated(items, { page: query.page, limit: query.pageSize, offset: query.skip }, total);
  }

  // ── Buku agent milik saya ──

  @RequirePermission(PERMISSIONS.memorySelfManage, PERMISSIONS.agentsManagePersonal)
  @Get('agents/:agentId/summary')
  async agentSummary(@CurrentAuth() auth: AuthContext, @Param('agentId', uuid) agentId: string) {
    return this.memory.summary(await this.memory.bookSubject(auth, agentId));
  }

  @RequirePermission(PERMISSIONS.memorySelfManage, PERMISSIONS.agentsManagePersonal)
  @Get('agents/:agentId/entries')
  async agentEntries(
    @CurrentAuth() auth: AuthContext,
    @Param('agentId', uuid) agentId: string,
    @Query() query: MemoryEntryListQueryDto,
  ) {
    const { items, total } = await this.memory.listEntries(await this.memory.bookSubject(auth, agentId), {
      ...query,
      skip: query.skip,
      take: query.pageSize,
    });
    return paginated(items, { page: query.page, limit: query.pageSize, offset: query.skip }, total);
  }

  @RequirePermission(PERMISSIONS.memorySelfManage, PERMISSIONS.agentsManagePersonal)
  @Post('agents/:agentId/entries')
  async createAgentEntry(
    @CurrentAuth() auth: AuthContext,
    @Param('agentId', uuid) agentId: string,
    @Body() dto: CreateMemoryEntryDto,
  ) {
    return this.memory.createEntry(auth, await this.memory.bookSubject(auth, agentId), dto);
  }

  @RequirePermission(PERMISSIONS.memorySelfManage, PERMISSIONS.agentsManagePersonal)
  @Patch('agents/:agentId/entries/:id')
  async updateAgentEntry(
    @CurrentAuth() auth: AuthContext,
    @Param('agentId', uuid) agentId: string,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateMemoryEntryDto,
  ) {
    return this.memory.updateEntry(await this.memory.bookSubject(auth, agentId), id, dto);
  }

  @RequirePermission(PERMISSIONS.memorySelfManage, PERMISSIONS.agentsManagePersonal)
  @Delete('agents/:agentId/entries/:id')
  async deleteAgentEntry(
    @CurrentAuth() auth: AuthContext,
    @Param('agentId', uuid) agentId: string,
    @Param('id', uuid) id: string,
  ) {
    await this.memory.deleteEntry(auth, await this.memory.bookSubject(auth, agentId), id);
    return { deleted: true };
  }

  @RequirePermission(PERMISSIONS.memorySelfManage, PERMISSIONS.agentsManagePersonal)
  @Put('agents/:agentId/door')
  async setAgentDoor(
    @CurrentAuth() auth: AuthContext,
    @Param('agentId', uuid) agentId: string,
    @Body() dto: SetMemoryDoorDto,
  ) {
    return this.memory.setDoor(auth, await this.memory.bookSubject(auth, agentId), dto);
  }

  // ── Pintu yang dapat dibuka atasan ──

  @RequirePermission(PERMISSIONS.memoryDoorsOpen)
  @Get('reach')
  reach(@CurrentAuth() auth: AuthContext) {
    return this.scope.reach(auth.user.id);
  }

  @RequirePermission(PERMISSIONS.memorySelfManage)
  @Get('contexts/:kind/:id/doors')
  contextDoors(
    @CurrentAuth() auth: AuthContext,
    @Param('kind') kind: string,
    @Param('id', uuid) id: string,
  ) {
    return this.memory.contextDoors(auth, { kind: contextKind(kind), id });
  }

  @RequirePermission(PERMISSIONS.memoryDoorsOpen)
  @HttpCode(200)
  @Put('contexts/:kind/:id/doors')
  setContextDoors(
    @CurrentAuth() auth: AuthContext,
    @Param('kind') kind: string,
    @Param('id', uuid) id: string,
    @Body() dto: SetContextDoorsDto,
  ) {
    return this.memory.setContextDoors(auth, { kind: contextKind(kind), id }, dto.subjectIds);
  }
}
