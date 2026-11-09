import { AppError, ERROR_CODES } from '../../../common/errors/app-error';
/**
 * Reads a fetch Response body as Server-Sent Events and yields each parsed
 * `data:` payload. Works with the web ReadableStream exposed by Node's fetch.
 */
export async function* iterateSse(response: Response): AsyncGenerator<unknown> {
  if (!response.body) {
    throw new Error('Response body kosong untuk streaming SSE.');
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') return;
        try {
          yield JSON.parse(payload);
        } catch {
          // Abaikan fragmen JSON yang belum utuh; penyedia yang sehat mengirim
          // satu objek per baris.
        }
      }
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

/** Penyebab teknis dari TypeError "fetch failed" milik undici (mis. ECONNRESET). */
function networkDetail(error: unknown): string {
  const cause = (error as { cause?: { code?: string; message?: string } }).cause;
  return (
    cause?.code ?? cause?.message ?? (error instanceof Error ? error.message : 'tidak diketahui')
  );
}

/**
 * fetch ke penyedia AI dengan satu kali coba ulang untuk kegagalan jaringan sesaat
 * (sebelum ada byte respons, sehingga aman diulang). Pembatalan/timeout tidak diulang.
 */
export async function fetchProvider(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fetchImpl(url, init);
    } catch (error) {
      if (init.signal?.aborted || !(error instanceof TypeError)) throw error;
      if (attempt >= 2) {
        throw new AppError(
          ERROR_CODES.aiUpstreamError,
          `Tidak dapat menghubungi penyedia AI (${networkDetail(error)}). Coba kirim ulang.`,
          502,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}
