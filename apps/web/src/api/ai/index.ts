import type { AiTaskStatus, ConversationMode } from '@contributor/shared';
import { apiDelete, apiGet, apiGetPaged, apiPatch, apiPost } from '@/api/http';
import type {
  ChatRequestPayload,
  ChatSendResult,
  ConversationDetail,
  ConversationSummary,
  TaskDetail,
  TaskRow,
} from './types';

export async function sendChat(payload: ChatRequestPayload): Promise<ChatSendResult> {
  return apiPost<ChatSendResult>('/ai/chat', {
    mode: payload.mode,
    prompt: payload.prompt,
    conversationId: payload.conversationId,
    counterpartStyle: payload.counterpartStyle,
  });
}

export function listConversations(query: {
  mode?: ConversationMode;
  search?: string;
  page: number;
  pageSize: number;
}) {
  return apiGetPaged<ConversationSummary>('/ai/conversations', {
    mode: query.mode,
    search: query.search,
    page: query.page,
    pageSize: query.pageSize,
  });
}

export function conversationDetail(id: string): Promise<ConversationDetail> {
  return apiGet<ConversationDetail>(`/ai/conversations/${id}`);
}

export function deleteConversation(id: string): Promise<{ deleted: boolean }> {
  return apiDelete<{ deleted: boolean }>(`/ai/conversations/${id}`);
}

export function updateConversation(
  id: string,
  patch: { title?: string; starred?: boolean },
): Promise<ConversationSummary> {
  return apiPatch<ConversationSummary>(`/ai/conversations/${id}`, patch);
}

export function regenerateReply(id: string): Promise<ChatSendResult> {
  return apiPost<ChatSendResult>(`/ai/conversations/${id}/regenerate`);
}

export function createTask(input: { title: string; instruction: string }): Promise<TaskRow> {
  return apiPost<TaskRow>('/ai/tasks', input);
}

export function listTasks(query: { status?: AiTaskStatus; page: number; pageSize: number }) {
  return apiGetPaged<TaskRow>('/ai/tasks', {
    status: query.status,
    page: query.page,
    pageSize: query.pageSize,
  });
}

export function taskDetail(id: string): Promise<TaskDetail> {
  return apiGet<TaskDetail>(`/ai/tasks/${id}`);
}

export function runTask(id: string): Promise<TaskRow> {
  return apiPost<TaskRow>(`/ai/tasks/${id}/run`);
}

export function cancelTask(id: string): Promise<TaskRow> {
  return apiPost<TaskRow>(`/ai/tasks/${id}/cancel`);
}

export * from './types';
