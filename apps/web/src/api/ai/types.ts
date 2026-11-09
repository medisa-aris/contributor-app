import type { AiTaskStatus, ConversationMode } from '@bara/shared';
import type { UserDocument } from '@/api/documents/types';

export type ConversationSummary = {
  id: string;
  mode: ConversationMode;
  title: string;
  counterpart_style: string | null;
  web_search?: boolean;
  starred_at: string | null;
  updated_at: string;
  created_at: string;
};

export type ConversationMessage = {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  created_at: string;
  /** Dokumen yang dibuat AI pada pesan ini. */
  documents?: UserDocument[];
  /** Jejak pemanggilan tool konektor pada pesan asisten. */
  tool_trace?: ToolTrace | null;
  /** Jumlah data pribadi yang dimasking per kategori pada jawaban ini. */
  guardrails?: Record<string, number> | null;
};

export type ToolTraceStatus = 'running' | 'ok' | 'error' | 'pending_approval' | 'approved' | 'rejected';

export type ToolTraceStep = {
  id: string;
  name: string;
  label: string;
  source: string | null;
  input: Record<string, unknown>;
  status: ToolTraceStatus;
  summary: string;
  preview?: unknown;
  approvalId?: string;
};

export type ToolTrace = {
  steps: ToolTraceStep[];
  pending?: { approvalId: string; callId: string } | null;
};

export type ConversationDetail = ConversationSummary & {
  messages: ConversationMessage[];
};

export type ChatSendResult = {
  conversation: ConversationDetail;
  assistant: ConversationMessage;
};

export type ConversationAttachment = {
  id: string;
  conversation_id: string;
  file_name: string;
  mime_type: string;
  extension: string;
  size_bytes: number;
  kind: 'document' | 'image';
  extraction_status: 'ready' | 'image' | 'failed';
  extracted_chars: number;
  enabled: boolean;
  created_at: string;
  source_type: 'file' | 'url';
  source_url: string | null;
  summary: string | null;
};

export type TaskRow = {
  id: string;
  title: string;
  instruction: string;
  status: AiTaskStatus;
  result: string | null;
  error_message: string | null;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  duration_ms: number | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
};

export type TaskEventRow = {
  id: string;
  event_type: string;
  message: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type TaskDetail = TaskRow & {
  events: TaskEventRow[];
};

export interface ChatRequestPayload {
  mode: ConversationMode;
  prompt: string;
  conversationId?: string;
  counterpartStyle?: string;
  webSearch?: boolean;
}

export type StreamErrorInfo = {
  status: number;
  code: string;
  message: string;
};

export type StreamEvent =
  | { type: 'ready'; conversationId: string }
  | { type: 'delta'; text: string }
  | { type: 'tool'; step: ToolTraceStep }
  | { type: 'done'; conversationId: string; message: ConversationMessage }
  | { type: 'error'; info: StreamErrorInfo };
