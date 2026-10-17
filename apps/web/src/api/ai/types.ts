import type { AiTaskStatus, ConversationMode } from '@contributor/shared';

export type ConversationSummary = {
  id: string;
  mode: ConversationMode;
  title: string;
  counterpart_style: string | null;
  starred_at: string | null;
  updated_at: string;
  created_at: string;
};

export type ConversationMessage = {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  model: string | null;
  created_at: string;
};

export type ConversationDetail = ConversationSummary & {
  messages: ConversationMessage[];
};

export type ChatSendResult = {
  conversation: ConversationDetail;
  assistant: ConversationMessage;
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
}

export type StreamErrorInfo = {
  status: number;
  code: string;
  message: string;
};

export type StreamEvent =
  | { type: 'ready'; conversationId: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; conversationId: string; message: ConversationMessage }
  | { type: 'error'; info: StreamErrorInfo };
