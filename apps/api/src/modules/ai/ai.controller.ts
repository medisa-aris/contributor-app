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
import { DocumentsService } from '../documents/documents.service';
import { ModelAccessService } from './models/model-access.service';
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
import { AiGatewayService, clampToolResult, storableProviderContent } from './gateway.service';
import { TasksService } from './tasks.service';
import type { ChatMessage, ChatResult } from './providers/types';
import {
  applyLoopEvent,
  ChatToolsService,
  loopContent,
  type ToolTrace,
  type ToolTraceStep,
} from './chat-tools.service';
import { APPROVAL_PLACEHOLDER, ChatTurnService } from './chat-turn.service';
import { RunsService } from './runs/runs.service';
import { ToolApprovalsService } from './tool-approvals.service';
import { WebSearchService } from './web-search/web-search.service';
import { MemoryExtractionService } from '../memory/memory-extraction.service';
import { MemoryService, type MemoryRetrieval } from '../memory/memory.service';
import { DecideToolApprovalDto, SetConversationConnectorsDto } from './dto/ai.dto';


/** Giliran chat dipindah ke kerja panjang (dilempar dari callback loop, ditangkap di chatStream). */
class PromoteToRun extends Error {}
const PROMOTE_AFTER_ITERATIONS = 3;
const PROMOTE_AFTER_MS = 90_000;

function sseWrite(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

@ApiTags('ai-workspace')
@Controller('ai')
export class AiController {
  constructor(
    private readonly gateway: AiGatewayService,
    private readonly modelAccess: ModelAccessService,
    private readonly conversations: ConversationsService,
    private readonly attachments: AttachmentsService,
    private readonly tasks: TasksService,
    private readonly documents: DocumentsService,
    private readonly chatTools: ChatToolsService,
    private readonly toolApprovals: ToolApprovalsService,
    private readonly webSearch: WebSearchService,
    private readonly memory: MemoryService,
    private readonly memoryNotes: MemoryExtractionService,
    private readonly turns: ChatTurnService,
    private readonly runs: RunsService,
  ) {}

  private memoryFor(auth: AuthContext, conversationId: string, query: string): Promise<MemoryRetrieval> {
    return this.turns.memoryFor(auth, conversationId, query);
  }

  private afterTurn(auth: AuthContext, conversationId: string): void {
    this.turns.afterTurn(auth, conversationId);
  }

  /** Ketersediaan pencarian web untuk menampilkan opsinya; nama penyedia tidak dibuka. */
  @RequirePermission(PERMISSIONS.webSearchUse)
  @Get('web-search/status')
  webSearchStatus() {
    return { available: this.webSearch.isAvailable() };
  }

  /** Chat sinkron untuk mode Multi Brain / Partner. */
  @HttpCode(200)
  @Post('chat')
  async chat(@CurrentAuth() auth: AuthContext, @Body() dto: ChatRequestDto) {
    this.assertModePermission(auth, dto.mode);
    this.webSearch.assertAllowed(auth, dto.webSearch);
    if (dto.modelId) await this.modelAccess.assertSelectable(auth.user.id, dto.modelId);
    const prepared = await this.conversations.prepareTurn(auth, dto);
    if (dto.modelId) await this.modelAccess.setConversationModel(auth.user.id, prepared.id, dto.modelId);
    const context = await this.attachments.chatContext(prepared.id);
    const memory = await this.memoryFor(auth, prepared.id, dto.prompt);
    const pendingApprovals: string[] = [];
    const handlers = await this.chatTools.handlersFor(auth, prepared.id, pendingApprovals);
    if (handlers.length > 0) {
      const turn = await this.toolTurn(auth, prepared.id, handlers, pendingApprovals, {
        mode: dto.mode,
        counterpartStyle: dto.counterpartStyle,
        messages: this.conversations.toChatMessages(prepared.history),
        extraContext: context.text ?? undefined,
        images: context.images.length > 0 ? context.images : undefined,
        memory,
      });
      this.afterTurn(auth, prepared.id);
      const conversation = await this.conversations.detail(auth, prepared.id);
      return { conversation, assistant: turn };
    }
    const result = await this.gateway.chat({
      guard: { userId: auth.user.id, conversationId: prepared.id },
      mode: dto.mode,
      counterpartStyle: dto.counterpartStyle,
      messages: this.conversations.toChatMessages(prepared.history),
      extraContext: context.text ?? undefined,
      images: context.images.length > 0 ? context.images : undefined,
      documents: true,
      memoryContext: memory.block || undefined,
    });
    const created = await this.runDocumentTools(auth, prepared.id, result);
    const assistant = await this.conversations.completeTurn(prepared.id, {
      content: created.content,
      model: result.model,
      modelId: result.modelId ?? null,
      ...(created.content === result.content ? { providerContent: storableProviderContent(result.providerContent) } : {}),
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      ...(result.guardrails ? { guardrails: result.guardrails } : {}),
      memoryRefs: memory.refs,
    });
    await this.documents.attachToMessage(
      auth.user.id,
      created.documents.map((doc) => doc.id),
      String(assistant.id),
    );
    this.afterTurn(auth, prepared.id);
    const conversation = await this.conversations.detail(auth, prepared.id);
    return { conversation, assistant: { ...assistant, documents: created.documents } };
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
    this.webSearch.assertAllowed(auth, dto.webSearch);
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
      if (dto.modelId) await this.modelAccess.assertSelectable(auth.user.id, dto.modelId);
      const prepared = await this.conversations.prepareTurn(auth, dto);
      if (dto.modelId) {
        await this.modelAccess.setConversationModel(auth.user.id, prepared.id, dto.modelId);
      }
      const context = await this.attachments.chatContext(prepared.id);
      const memory = await this.memoryFor(auth, prepared.id, dto.prompt);
      sseWrite(res, 'ready', { conversationId: prepared.id });
      const pendingApprovals: string[] = [];
      const handlers = await this.chatTools.handlersFor(
        auth,
        prepared.id,
        pendingApprovals,
        abort.signal,
      );
      if (handlers.length > 0) {
        // Promosi otomatis ke kerja panjang (§14.5) di batas iterasi, sebelum tool berikutnya jalan.
        const promoteModel = await this.runs.promotableModel(auth.user.id, prepared.id);
        const startedAt = Date.now();
        const transcript: ChatMessage[] = [];
        let iterations = 0;
        let message;
        try {
          message = await this.toolTurn(
            auth,
            prepared.id,
            handlers,
            pendingApprovals,
            {
              mode: dto.mode,
              counterpartStyle: dto.counterpartStyle,
              messages: this.conversations.toChatMessages(prepared.history),
              extraContext: context.text ?? undefined,
              images: context.images.length > 0 ? context.images : undefined,
              signal: abort.signal,
              memory,
            },
            (event, payload) => sseWrite(res, event, payload),
            {
              onLoopEvent: (event) => {
                if (event.type === 'assistant') {
                  if (promoteModel && (iterations >= PROMOTE_AFTER_ITERATIONS || Date.now() - startedAt > PROMOTE_AFTER_MS)) {
                    throw new PromoteToRun();
                  }
                  iterations += 1;
                  transcript.push({ role: 'assistant', content: event.content, toolCalls: event.toolCalls });
                } else if (event.type === 'tool_result' && event.outcome.status !== 'pending_approval') {
                  transcript.push({
                    role: 'tool',
                    toolCallId: event.call.id,
                    toolName: event.call.name,
                    content: clampToolResult(event.outcome.content || '(kosong)'),
                    ...(event.outcome.status === 'error' ? { isError: true } : {}),
                  });
                }
              },
            },
          );
        } catch (error) {
          if (!(error instanceof PromoteToRun) || !promoteModel) throw error;
          const promptMessage = [...prepared.history].reverse().find((m) => m.role === 'user')!;
          const run = await this.runs.createPromoted(auth, {
            conversationId: prepared.id,
            mode: dto.mode,
            ...(dto.counterpartStyle ? { counterpartStyle: dto.counterpartStyle } : {}),
            ...(dto.webSearch !== undefined ? { webSearch: dto.webSearch } : {}),
            prompt: dto.prompt,
            promptMessageId: String(promptMessage.id),
            modelId: promoteModel,
            transcript,
            iterations,
          });
          sseWrite(res, 'run_started', { conversationId: prepared.id, run });
          res.end();
          return;
        }
        this.afterTurn(auth, prepared.id);
        sseWrite(res, 'done', { conversationId: prepared.id, message });
        res.end();
        return;
      }
      const stream = this.gateway.stream({
        guard: { userId: auth.user.id, conversationId: prepared.id },
        mode: dto.mode,
        counterpartStyle: dto.counterpartStyle,
        messages: this.conversations.toChatMessages(prepared.history),
        signal: abort.signal,
        extraContext: context.text ?? undefined,
        images: context.images.length > 0 ? context.images : undefined,
        documents: true,
        memoryContext: memory.block || undefined,
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
      const created = await this.runDocumentTools(auth, prepared.id, final);
      const assistant = await this.conversations.completeTurn(prepared.id, {
        content: created.content,
        model: final.model,
        modelId: final.modelId ?? null,
        ...(created.content === final.content ? { providerContent: storableProviderContent(final.providerContent) } : {}),
        tokensIn: final.tokensIn,
        tokensOut: final.tokensOut,
        ...(final.guardrails ? { guardrails: final.guardrails } : {}),
        memoryRefs: memory.refs,
      });
      await this.documents.attachToMessage(
        auth.user.id,
        created.documents.map((doc) => doc.id),
        String(assistant.id),
      );
      this.afterTurn(auth, prepared.id);
      sseWrite(res, 'done', {
        conversationId: prepared.id,
        message: { ...assistant, documents: created.documents },
      });
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
  async createConversation(@CurrentAuth() auth: AuthContext, @Body() dto: CreateConversationDto) {
    if (dto.modelId) await this.modelAccess.assertSelectable(auth.user.id, dto.modelId);
    const draft = await this.conversations.createDraft(auth, dto.mode);
    if (!dto.modelId) return draft;
    await this.modelAccess.setConversationModel(auth.user.id, draft.id, dto.modelId);
    return { ...draft, model_id: dto.modelId };
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
  async updateConversation(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Body() dto: UpdateConversationDto,
  ) {
    const { modelId, ...rest } = dto;
    if (modelId !== undefined) {
      await this.conversations.detail(auth, id); // pastikan milik pengguna (404 bila bukan)
      await this.modelAccess.setConversationModel(auth.user.id, id, modelId);
    }
    return this.conversations.update(auth, id, rest);
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
    const lastPrompt = [...prepared.history].reverse().find((m) => m.role === 'user')?.content ?? '';
    const memory = await this.memoryFor(auth, prepared.id, lastPrompt);
    const webHandlers = await this.chatTools.webHandlers(auth, prepared.id);
    if (webHandlers.length > 0) {
      const handlerMap = new Map(webHandlers.map((h) => [h.tool.name, h]));
      const steps: ToolTraceStep[] = [];
      const loop = await this.gateway.drainToolLoop(
        {
          guard: { userId: auth.user.id, conversationId: prepared.id },
          usageSource: 'regenerate',
          mode: prepared.mode,
          counterpartStyle: prepared.counterpartStyle ?? undefined,
          messages: this.conversations.toChatMessages(prepared.history),
          extraContext: context.text ?? undefined,
          images: context.images.length > 0 ? context.images : undefined,
          handlers: webHandlers,
          toolRules: this.chatTools.toolRules(webHandlers),
          memoryContext: memory.block || undefined,
        },
        (event) => {
          applyLoopEvent(steps, event, handlerMap);
        },
      );
      const assistant = await this.conversations.replaceAssistant(
        prepared.id,
        prepared.previousAssistantId,
        {
          content: loopContent(loop) || 'Penyedia AI tidak mengembalikan jawaban.',
          model: loop.model,
          modelId: loop.modelId ?? null,
          tokensIn: loop.tokensIn,
          tokensOut: loop.tokensOut,
          ...(loop.guardrails ? { guardrails: loop.guardrails } : {}),
          memoryRefs: memory.refs,
        },
      );
      if (steps.length > 0) {
        await this.chatTools.saveTrace(String(assistant.id), {
          steps,
          transcript: loop.appended,
          pending: null,
        });
      }
      const conversation = await this.conversations.detail(auth, prepared.id);
      return { conversation, assistant };
    }
    const result = await this.gateway.chat({
      guard: { userId: auth.user.id, conversationId: prepared.id },
      usageSource: 'regenerate',
      mode: prepared.mode,
      counterpartStyle: prepared.counterpartStyle ?? undefined,
      messages: this.conversations.toChatMessages(prepared.history),
      extraContext: context.text ?? undefined,
      images: context.images.length > 0 ? context.images : undefined,
      memoryContext: memory.block || undefined,
    });
    const assistant = await this.conversations.replaceAssistant(
      prepared.id,
      prepared.previousAssistantId,
      {
        content: result.content,
        model: result.model,
        modelId: result.modelId ?? null,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        ...(result.guardrails ? { guardrails: result.guardrails } : {}),
        memoryRefs: memory.refs,
      },
    );
    const conversation = await this.conversations.detail(auth, prepared.id);
    return { conversation, assistant };
  }

  @RequirePermission(PERMISSIONS.connectorsUse)
  @Get('conversations/:id/connectors')
  conversationConnectors(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ) {
    return this.chatTools.list(auth, id);
  }

  @RequirePermission(PERMISSIONS.connectorsUse)
  @Put('conversations/:id/connectors')
  setConversationConnectors(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Body() dto: SetConversationConnectorsDto,
  ) {
    return this.chatTools.set(auth, id, dto.connectors);
  }

  /** Persetujuan pemanggilan tool milik pengguna (chat dan tugas agent). */
  @Get('tool-approvals')
  toolApprovalsMine(@CurrentAuth() auth: AuthContext, @Query('status') status?: string) {
    return this.toolApprovals.listMine(
      auth.user.id,
      status === 'pending' || status === 'approved' || status === 'rejected' ? status : undefined,
    );
  }

  /**
   * Putuskan persetujuan tool di percakapan, jalankan (bila disetujui), lalu lanjutkan
   * jawaban asisten pada pesan yang sama.
   */
  @HttpCode(200)
  @Post('conversations/:id/tool-approvals/:approvalId/decide')
  async decideConversationApproval(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Param('approvalId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) approvalId: string,
    @Body() dto: DecideToolApprovalDto,
  ) {
    const existing = await this.toolApprovals.detail(auth.user.id, approvalId);
    if (existing.conversation_id !== id || !existing.message_id) {
      throw new AppError(
        ERROR_CODES.notFound,
        'Persetujuan tidak ditemukan pada percakapan ini.',
        404,
      );
    }
    const summary = await this.conversations.detail(auth, id);
    this.assertModePermission(auth, summary.mode as ConversationMode);
    const approval = await this.toolApprovals.claim(auth, approvalId, dto.decision, dto.note);
    const message = await this.chatTools.loadMessage(id, approval.message_id!);
    const trace: ToolTrace = message.tool_trace ?? { steps: [], transcript: [] };
    const outcome =
      dto.decision === 'approved' && approval.payload
        ? await this.chatTools.executeApproved(auth, id, {
            id: approvalId,
            payload: approval.payload,
          })
        : {
            status: 'error' as const,
            content: `Pengguna menolak operasi ini${dto.note ? `: ${dto.note}` : ''}. Jangan mengulanginya tanpa diminta.`,
          };
    const step = trace.steps.find((s) => s.approvalId === approvalId);
    if (step) {
      step.status =
        dto.decision === 'rejected' ? 'rejected' : outcome.status === 'ok' ? 'approved' : 'error';
      step.summary =
        dto.decision === 'rejected'
          ? 'Ditolak'
          : outcome.status === 'ok'
            ? `Disetujui dan dijalankan`
            : outcome.content.slice(0, 300);
    }
    trace.transcript.push({
      role: 'tool',
      toolCallId: approval.tool_call_id ?? step?.id ?? approvalId,
      ...(step ? { toolName: step.name } : {}),
      content: clampToolResult(outcome.content || '(kosong)'),
      ...(outcome.status === 'ok' ? {} : { isError: true }),
    });
    trace.pending = null;

    const pendingApprovals: string[] = [];
    const handlers = await this.chatTools.handlersFor(auth, id, pendingApprovals);
    const history = await this.chatTools.historyBefore(id, message.id);
    const handlerMap = new Map(handlers.map((h) => [h.tool.name, h]));
    const result = await this.gateway.drainToolLoop(
      {
        guard: { userId: auth.user.id, conversationId: id },
        mode: summary.mode as ConversationMode,
        counterpartStyle: summary.counterpart_style ?? undefined,
        messages: [...history, ...trace.transcript],
        handlers,
        toolRules: this.chatTools.toolRules(handlers),
      },
      (event) => {
        applyLoopEvent(trace.steps, event, handlerMap);
      },
    );
    trace.transcript.push(...result.appended);
    trace.pending = result.pending
      ? { approvalId: result.pending.approvalId, callId: result.pending.call.id }
      : null;
    const previous = message.content === APPROVAL_PLACEHOLDER ? '' : message.content;
    const addition = loopContent(result) || (result.pending ? APPROVAL_PLACEHOLDER : '');
    await this.chatTools.updateMessage(message.id, {
      content:
        [previous, addition].filter((part) => part.trim()).join('\n\n') || APPROVAL_PLACEHOLDER,
      tokensIn: (message.tokens_in ?? 0) + result.tokensIn,
      tokensOut: (message.tokens_out ?? 0) + result.tokensOut,
      ...(result.guardrails ? { guardrails: result.guardrails } : {}),
      trace,
    });
    await this.toolApprovals.attachMessage(pendingApprovals, message.id);
    return this.conversations.detail(auth, id);
  }

  @RequirePermission(PERMISSIONS.subordinateExecute)
  @Post('tasks')
  createTask(@CurrentAuth() auth: AuthContext, @Body() dto: CreateTaskDto) {
    this.webSearch.assertAllowed(auth, dto.webSearch);
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

  private toolTurn(...args: Parameters<ChatTurnService['toolTurn']>) {
    return this.turns.toolTurn(...args);
  }

  private runDocumentTools(...args: Parameters<ChatTurnService['runDocumentTools']>) {
    return this.turns.runDocumentTools(...args);
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
