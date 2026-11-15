import { Injectable } from '@nestjs/common';
import { PERMISSIONS, type ConversationMode } from '@bara/shared';
import type { AuthContext } from '../../common/types/auth-context';
import { CREATE_DOCUMENT_TOOL_NAME, parseDocumentSpec } from '../documents/document-spec';
import { DocumentsService, type UserDocument } from '../documents/documents.service';
import { MemoryExtractionService } from '../memory/memory-extraction.service';
import { MemoryService, type MemoryRetrieval } from '../memory/memory.service';
import {
  applyLoopEvent,
  ChatToolsService,
  loopContent,
  type ToolTrace,
  type ToolTraceStep,
} from './chat-tools.service';
import { ConversationsService } from './conversations.service';
import {
  AiGatewayService,
  storableProviderContent,
  type ToolHandler,
  type ToolLoopEvent,
  type ToolLoopOptions,
  type ToolLoopResult,
} from './gateway.service';
import type { ChatMessage, ChatResult } from './providers/types';
import { ToolApprovalsService } from './tool-approvals.service';

/** Isi jawaban saat giliran berhenti menunggu persetujuan tanpa teks dari model. */
export const APPROVAL_PLACEHOLDER = 'Saya perlu persetujuan Anda sebelum menjalankan operasi berikut.';

/**
 * Satu giliran percakapan (Multi Brain/Partner) yang dipakai bersama oleh endpoint chat
 * dan worker kerja panjang, agar keduanya menyimpan jawaban, dokumen, dan jejak tool sama persis.
 */
@Injectable()
export class ChatTurnService {
  constructor(
    private readonly gateway: AiGatewayService,
    private readonly conversations: ConversationsService,
    private readonly documents: DocumentsService,
    private readonly chatTools: ChatToolsService,
    private readonly toolApprovals: ToolApprovalsService,
    private readonly memory: MemoryService,
    private readonly memoryNotes: MemoryExtractionService,
  ) {}

  /** Memori relevan untuk giliran ini (buku sendiri + pintu yang dibuka di percakapan). */
  memoryFor(auth: AuthContext, conversationId: string, query: string): Promise<MemoryRetrieval> {
    return this.memory.retrieve(
      auth.user.id,
      auth.effective.allowed,
      { kind: 'conversation', id: conversationId },
      query,
    );
  }

  /** Jadwalkan pencatatan memori di belakang layar setelah giliran tersimpan. */
  afterTurn(auth: AuthContext, conversationId: string): void {
    if (auth.effective.allowed.has(PERMISSIONS.memorySelfManage)) {
      this.memoryNotes.scheduleConversation(conversationId);
    }
  }

  /**
   * Satu giliran chat dengan loop tool konektor. `emit` (opsional) meneruskan delta teks
   * dan perubahan langkah tool ke klien SSE.
   */
  async toolTurn(
    auth: AuthContext,
    conversationId: string,
    handlers: ToolHandler[],
    pendingApprovals: string[],
    options: {
      mode: ConversationMode;
      counterpartStyle?: string;
      messages: ChatMessage[];
      extraContext?: string;
      images?: { name: string; mimeType: string; dataBase64: string }[];
      signal?: AbortSignal;
      memory?: MemoryRetrieval;
    },
    emit?: (event: string, payload: unknown) => void,
    hooks: {
      /** Opsi loop tambahan, mis. kerja panjang (longRun, maxIterations, onCompaction). */
      extras?: Partial<ToolLoopOptions>;
      /** Hasil loop mentah (alasan berhenti, pemakaian token). */
      onResult?: (result: ToolLoopResult) => void;
      /** Setiap event loop (untuk checkpoint run). */
      onLoopEvent?: (event: ToolLoopEvent) => void | Promise<void>;
    } = {},
  ) {
    const { memory, ...loopOptions } = options;
    const handlerMap = new Map(handlers.map((h) => [h.tool.name, h]));
    const steps: ToolTraceStep[] = [];
    const result = await this.gateway.drainToolLoop(
      {
        ...loopOptions,
        memoryContext: memory?.block || undefined,
        guard: { userId: auth.user.id, conversationId },
        documents: true,
        handlers,
        stream: Boolean(emit),
        toolRules: this.chatTools.toolRules(handlers),
        ...hooks.extras,
      },
      async (event: ToolLoopEvent) => {
        await hooks.onLoopEvent?.(event);
        if (event.type === 'delta') {
          emit?.('delta', { text: event.text });
          return;
        }
        if (event.type === 'assistant') {
          if (event.content.trim()) emit?.('delta', { text: '\n\n' });
          return;
        }
        const changed = applyLoopEvent(steps, event, handlerMap);
        if (changed) emit?.('tool', changed);
      },
    );
    hooks.onResult?.(result);
    const content =
      loopContent(result) || (result.stop === 'pending_approval' ? APPROVAL_PLACEHOLDER : '');
    const created = await this.runDocumentTools(auth, conversationId, {
      content,
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      ...(result.unhandledToolCalls.length > 0 ? { toolCalls: result.unhandledToolCalls } : {}),
    });
    const assistant = await this.conversations.completeTurn(conversationId, {
      content: created.content,
      model: result.model,
      modelId: result.modelId ?? null,
      // Diputar ulang hanya bila isi jawaban tidak diubah (dokumen menambah teks ke jawaban).
      ...(created.content === content ? { providerContent: storableProviderContent(result.providerContent) } : {}),
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      ...(result.guardrails ? { guardrails: result.guardrails } : {}),
      memoryRefs: memory?.refs ?? [],
    });
    const trace: ToolTrace = {
      steps,
      transcript: result.appended,
      pending: result.pending
        ? { approvalId: result.pending.approvalId, callId: result.pending.call.id }
        : null,
    };
    if (steps.length > 0) await this.chatTools.saveTrace(String(assistant.id), trace);
    await this.toolApprovals.attachMessage(pendingApprovals, String(assistant.id));
    await this.documents.attachToMessage(
      auth.user.id,
      created.documents.map((doc) => doc.id),
      String(assistant.id),
    );
    return {
      ...assistant,
      documents: created.documents,
      tool_trace: steps.length > 0 ? { steps, pending: trace.pending } : null,
    };
  }

  /**
   * Jalankan tool create_document yang diminta model. Kegagalan satu dokumen tidak
   * menggagalkan giliran; alasannya ditambahkan ke jawaban agar pengguna tahu.
   */
  async runDocumentTools(
    auth: AuthContext,
    conversationId: string,
    result: ChatResult,
  ): Promise<{ content: string; documents: UserDocument[] }> {
    const documents: UserDocument[] = [];
    const failures: string[] = [];
    for (const call of result.toolCalls ?? []) {
      if (call.name !== CREATE_DOCUMENT_TOOL_NAME) continue;
      try {
        documents.push(
          await this.documents.create(auth.user.id, conversationId, parseDocumentSpec(call.input)),
        );
      } catch (error) {
        failures.push(error instanceof Error ? error.message : 'Kesalahan tidak dikenal.');
      }
    }
    const parts: string[] = [];
    if (result.content.trim()) parts.push(result.content.trim());
    else if (documents.length > 0) {
      parts.push(
        documents.length === 1
          ? `Dokumen "${documents[0]!.title}" sudah dibuat.`
          : `${documents.length} dokumen sudah dibuat.`,
      );
    }
    if (failures.length > 0) parts.push(`Dokumen gagal dibuat: ${failures.join(' ')}`);
    if (parts.length === 0) parts.push('Penyedia AI tidak mengembalikan jawaban.');
    return { content: parts.join('\n\n'), documents };
  }
}
