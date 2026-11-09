import type {
  AiProviderAdapter,
  ChatRequestOptions,
  ChatResult,
} from '../providers/types';
import { StreamUnmasker } from './masker';
import type { GuardrailsService, GuardedRequest } from './guardrails.service';

/** Satu-satunya jalan keluar ke penyedia LLM: masking sebelum kirim, unmask saat kembali. */
export class GuardedProvider implements AiProviderAdapter {
  readonly id: string;

  constructor(
    private readonly inner: AiProviderAdapter,
    private readonly guardrails: GuardrailsService,
  ) {
    this.id = inner.id;
  }

  private restore(guarded: GuardedRequest, result: ChatResult): ChatResult {
    const keepMasked = new Set(
      (guarded.request.tools ?? []).filter((t) => t.keepMasked).map((t) => t.name),
    );
    return {
      ...result,
      content: guarded.session.unmask(result.content),
      ...(Object.keys(guarded.session.counts).length > 0
        ? { guardrails: { ...guarded.session.counts } }
        : {}),
      ...(result.toolCalls
        ? {
            toolCalls: result.toolCalls.map((call) =>
              keepMasked.has(call.name)
                ? call
                : { ...call, input: guarded.session.unmaskDeep(call.input) },
            ),
          }
        : {}),
    };
  }

  async chat(options: ChatRequestOptions): Promise<ChatResult> {
    const guarded = await this.guardrails.prepare(options);
    if (!guarded) return this.inner.chat(options);
    const result = this.restore(guarded, await this.inner.chat(guarded.request));
    await this.guardrails.finish(guarded);
    return result;
  }

  async *stream(options: ChatRequestOptions): AsyncGenerator<string, ChatResult> {
    const guarded = await this.guardrails.prepare(options);
    if (!guarded) return yield* this.inner.stream(options);

    const unmasker = new StreamUnmasker(guarded.session);
    const generator = this.inner.stream(guarded.request);
    for (;;) {
      const step = await generator.next();
      if (step.done) {
        const tail = unmasker.flush();
        if (tail) yield tail;
        const result = this.restore(guarded, step.value);
        await this.guardrails.finish(guarded);
        return result;
      }
      const text = unmasker.push(step.value);
      if (text) yield text;
    }
  }
}
