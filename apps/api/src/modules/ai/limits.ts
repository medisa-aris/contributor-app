import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import type { ChatMessage } from './providers/types';

export const AI_LIMITS = {
  maxHistoryMessages: 40,
  maxContentLength: 20000,
  maxPromptLength: 8000,
  maxTaskInstructionLength: 20000,
  maxOutputTokens: 2048,
  /** Turn yang boleh membuat dokumen membutuhkan ruang keluaran lebih besar. */
  maxOutputTokensWithDocuments: 8192,
  /** Loop tool menambah pesan tool_use/tool_result; batasnya lebih longgar. */
  maxHistoryMessagesWithTools: 160,
  /** Jumlah maksimum putaran model ↔ tool dalam satu loop. */
  maxToolIterations: 12,
  /** Panjang maksimum hasil tool yang diumpankan kembali ke model (karakter). */
  maxToolResultLength: 16000,
} as const;

export function validateChatMessages(
  messages: ChatMessage[],
  maxMessages: number = AI_LIMITS.maxHistoryMessages,
): void {
  if (messages.length === 0) {
    throw new AppError(ERROR_CODES.validation, 'Riwayat pesan tidak boleh kosong.', 400);
  }
  if (messages.length > maxMessages) {
    throw new AppError(
      ERROR_CODES.validation,
      `Riwayat pesan melebihi batas ${maxMessages} pesan. Mulai percakapan baru.`,
      400,
    );
  }
  for (const message of messages) {
    if (
      message.role !== 'system' &&
      message.role !== 'user' &&
      message.role !== 'assistant' &&
      message.role !== 'tool'
    ) {
      throw new AppError(ERROR_CODES.validation, 'Peran pesan tidak valid.', 400);
    }
    if (message.role === 'tool' && !message.toolCallId) {
      throw new AppError(ERROR_CODES.validation, 'Hasil tool tanpa toolCallId.', 400);
    }
    // Giliran asisten yang hanya memanggil tool boleh tanpa teks.
    const toolOnly = message.role === 'assistant' && (message.toolCalls?.length ?? 0) > 0;
    if (typeof message.content !== 'string' || (!toolOnly && message.content.trim().length === 0)) {
      throw new AppError(ERROR_CODES.validation, 'Isi pesan tidak boleh kosong.', 400);
    }
    if (message.content.length > AI_LIMITS.maxContentLength) {
      throw new AppError(
        ERROR_CODES.validation,
        `Isi pesan melebihi batas ${AI_LIMITS.maxContentLength} karakter.`,
        400,
      );
    }
  }
}

export function validatePrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) {
    throw new AppError(ERROR_CODES.validation, 'Pertanyaan tidak boleh kosong.', 400);
  }
  if (trimmed.length > AI_LIMITS.maxPromptLength) {
    throw new AppError(
      ERROR_CODES.validation,
      `Pertanyaan melebihi batas ${AI_LIMITS.maxPromptLength} karakter.`,
      400,
    );
  }
  return trimmed;
}

export function validateTaskInstruction(instruction: string): string {
  const trimmed = instruction.trim();
  if (trimmed.length === 0) {
    throw new AppError(ERROR_CODES.validation, 'Instruksi tugas tidak boleh kosong.', 400);
  }
  if (trimmed.length > AI_LIMITS.maxTaskInstructionLength) {
    throw new AppError(
      ERROR_CODES.validation,
      `Instruksi tugas melebihi batas ${AI_LIMITS.maxTaskInstructionLength} karakter.`,
      400,
    );
  }
  return trimmed;
}
