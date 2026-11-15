import { ApiError, apiGet, apiPost, apiPut, apiUrl } from '@/api/http';
import type { ConversationMode } from '@bara/shared';

export type RunStatus =
  | 'queued'
  | 'running'
  | 'waiting_input'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'budget_exhausted'
  | 'deadline_exceeded';

export const FINAL_RUN_STATUSES: RunStatus[] = ['completed', 'failed', 'cancelled', 'budget_exhausted', 'deadline_exceeded'];

export interface RunDto {
  id: string;
  kind: 'conversation_turn' | 'task';
  mode: ConversationMode | null;
  conversationId: string | null;
  taskId: string | null;
  modelId: string | null;
  status: RunStatus;
  effort: string | null;
  iterations: number;
  maxIterations: number;
  tokenBudget: number | null;
  tokensIn: number;
  tokensOut: number;
  deadlineAt: string;
  attempt: number;
  resultMessageId: string | null;
  error: string | null;
  errorCode: string | null;
  prompt: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  conversationTitle?: string | null;
  leaseOwner?: string | null;
}

export interface LongRunSettings {
  maxMinutes: number;
  maxIterations: number;
  maxConcurrentPerUser: number;
  autoPromote: boolean;
  defaultTokenBudget: number | null;
}

export interface StartRunInput {
  mode: ConversationMode;
  prompt: string;
  conversationId?: string;
  counterpartStyle?: string;
  webSearch?: boolean;
  modelId?: string;
  effort?: 'low' | 'medium' | 'high';
  maxMinutes?: number;
}

export const startRun = (input: StartRunInput) => apiPost<{ run: RunDto; conversationId: string }>('/ai/runs', input);
export const getRun = (id: string) => apiGet<RunDto>(`/ai/runs/${id}`);
export const listRuns = (status: 'active' | 'recent' = 'active') => apiGet<RunDto[]>('/ai/runs', { status });
export const cancelRun = (id: string) => apiPost<RunDto>(`/ai/runs/${id}/cancel`);
export const continueRun = (id: string) => apiPost<RunDto>(`/ai/runs/${id}/continue`, {});
export const adminRuns = () => apiGet<RunDto[]>('/admin/ai/runs');
export const adminCancelRun = (id: string) => apiPost<RunDto>(`/admin/ai/runs/${id}/cancel`);
export const getLongRunSettings = () => apiGet<LongRunSettings>('/admin/ai/long-run-settings');
export const saveLongRunSettings = (settings: LongRunSettings) =>
  apiPut<LongRunSettings>('/admin/ai/long-run-settings', settings);

export interface RunEvent {
  id: number;
  type: string;
  payload: Record<string, unknown>;
}

/**
 * Ikuti event run lewat SSE. Bila koneksi putus (tab tidur, jaringan), sambung ulang dengan
 * Last-Event-ID sehingga tidak ada event yang hilang atau terulang. Selesai saat stream ditutup
 * server setelah run berhenti, atau saat `signal` dibatalkan.
 */
export async function followRun(
  runId: string,
  onEvent: (event: RunEvent) => void,
  signal: AbortSignal,
  lastEventId = 0,
): Promise<number> {
  let last = lastEventId;
  let failures = 0;
  while (!signal.aborted) {
    try {
      const response = await fetch(apiUrl(`/ai/runs/${runId}/events`), {
        headers: { Accept: 'text/event-stream', ...(last > 0 ? { 'Last-Event-ID': String(last) } : {}) },
        credentials: 'include',
        signal,
      });
      if (!response.ok || !response.body) throw new ApiError(response.status, 'RUN_STREAM_FAILED', 'Gagal memantau proses.');
      failures = 0;
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf('\n\n');
          let id = 0;
          let type = 'message';
          let data = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('id:')) id = Number(line.slice(3).trim());
            else if (line.startsWith('event:')) type = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (!data) continue;
          try {
            onEvent({ id, type, payload: JSON.parse(data) as Record<string, unknown> });
          } catch {
            // payload rusak: lewati
          }
          if (id) last = id;
        }
      }
      // Server menutup stream setelah run berhenti.
      return last;
    } catch (error) {
      if (signal.aborted) return last;
      if (error instanceof ApiError && error.status === 404) throw error;
      failures += 1;
      await new Promise((resolve) => setTimeout(resolve, Math.min(10_000, 1000 * failures)));
    }
  }
  return last;
}
