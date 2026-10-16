import { ApiError, apiUrl, getCsrfToken } from '@/api/http';
import type { ChatRequestPayload, StreamErrorInfo, StreamEvent } from './types';

/**
 * Chat streaming (SSE) ke POST /ai/chat/stream.
 * Menguraikan event ready/delta/done/error dan meneruskannya lewat callback.
 * Reject promise bila respons HTTP gagal; kesalahan aliran dikirim lewat onEvent error.
 */
export async function chatStream(
  payload: ChatRequestPayload,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const csrf = getCsrfToken();
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    'Content-Type': 'application/json',
  };
  if (csrf) headers['X-CSRF-Token'] = csrf;

  const response = await fetch(apiUrl('/ai/chat/stream'), {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify({
      mode: payload.mode,
      prompt: payload.prompt,
      conversationId: payload.conversationId,
      counterpartStyle: payload.counterpartStyle,
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    let message = 'Permintaan streaming gagal.';
    try {
      const body = (await response.json()) as { error?: { message?: string; code?: string } };
      message = body.error?.message ?? message;
    } catch {
      // biarkan pesan bawaan
    }
    throw new ApiError(response.status, 'STREAM_FAILED', message);
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        dispatch(block, onEvent);
        boundary = buffer.indexOf('\n\n');
      }
    }
    if (buffer.trim()) dispatch(buffer, onEvent);
  } finally {
    reader.releaseLock();
  }
}

function dispatch(block: string, onEvent: (event: StreamEvent) => void): void {
  let eventName = 'message';
  let data = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!data) return;

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(data);
  } catch {
    return;
  }
  const body = parsed as Record<string, unknown>;

  switch (eventName) {
    case 'ready':
      onEvent({ type: 'ready', conversationId: String(body.conversationId ?? '') });
      break;
    case 'delta':
      onEvent({ type: 'delta', text: String(body.text ?? '') });
      break;
    case 'done':
      onEvent({
        type: 'done',
        conversationId: String(body.conversationId ?? ''),
        message: body.message as Extract<StreamEvent, { type: 'done' }>['message'],
      });
      break;
    case 'error':
      onEvent({
        type: 'error',
        info: {
          status: Number(body.status ?? 500),
          code: String(body.code ?? 'INTERNAL_ERROR'),
          message: String(body.message ?? 'Kesalahan tidak dikenal.'),
        } satisfies StreamErrorInfo,
      });
      break;
  }
}
