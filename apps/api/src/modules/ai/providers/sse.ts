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
