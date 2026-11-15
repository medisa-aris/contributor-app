import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DATA_SOURCE } from '../../database/database.module';
import { MEMORY_EMBEDDING_DIMENSIONS } from '../../database/memory-vector';
import { AiGatewayService } from '../ai/gateway.service';
import { GuardrailsService } from '../ai/guardrails/guardrails.service';
import { redactForMemory } from './memory-redactor';
import { MemorySettingsService } from './memory-settings.service';

const BACKFILL_INTERVAL_MS = 5 * 60_000;
const BACKFILL_BATCH = 50;
const AVAILABILITY_TTL_MS = 60_000;

export function toVectorLiteral(values: number[]): string {
  return `[${values.join(',')}]`;
}

/**
 * Embedding memori untuk pencarian semantik. Aktif hanya bila kolom `memory_entries.embedding`
 * ada (pgvector terpasang). Bila Guardrails aktif, nama orang juga ditutup sebelum teks dikirim
 * ke penyedia embedding; pencarian nama tetap dilayani teks penuh.
 */
@Injectable()
export class MemoryEmbeddingService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MemoryEmbeddingService.name);
  private availability: { at: number; value: boolean } | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly gateway: AiGatewayService,
    private readonly guardrails: GuardrailsService,
    private readonly settings: MemorySettingsService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.backfill(), BACKFILL_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** pgvector terpasang dan kolom embedding tersedia. */
  async vectorAvailable(): Promise<boolean> {
    if (this.availability && Date.now() - this.availability.at < AVAILABILITY_TTL_MS) {
      return this.availability.value;
    }
    const rows = (await this.dataSource.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'memory_entries' AND column_name = 'embedding'`,
    )) as unknown[];
    this.availability = { at: Date.now(), value: rows.length > 0 };
    return this.availability.value;
  }

  private async prepareText(texts: string[]): Promise<string[]> {
    const guardrails = await this.guardrails.getSettings();
    if (!guardrails.enabled) return texts;
    return texts.map((text) => redactForMemory(text, { names: true, terms: guardrails.terms }));
  }

  /** Embedding untuk teks; null bila semantik tidak aktif atau penyedia gagal (teks penuh tetap jalan). */
  async embed(texts: string[], signal?: AbortSignal): Promise<{ vectors: number[][]; model: string } | null> {
    if (texts.length === 0 || !(await this.vectorAvailable())) return null;
    const { embeddingModel } = await this.settings.get();
    try {
      const vectors = await this.gateway.embed(await this.prepareText(texts), embeddingModel, signal);
      if (!vectors) return null;
      if (vectors.some((v) => v.length !== MEMORY_EMBEDDING_DIMENSIONS)) {
        this.logger.warn(
          `Model embedding ${embeddingModel} menghasilkan dimensi ${vectors[0]?.length}, kolom memori ${MEMORY_EMBEDDING_DIMENSIONS}.`,
        );
        return null;
      }
      return { vectors, model: embeddingModel };
    } catch (error) {
      this.logger.warn(`Embedding memori gagal: ${(error as Error).message}`);
      return null;
    }
  }

  /** Simpan embedding untuk catatan tertentu; kegagalan dibiarkan NULL dan diisi ulang nanti. */
  async embedEntries(entries: { id: string; content: string }[]): Promise<void> {
    const result = await this.embed(entries.map((e) => e.content));
    if (!result) return;
    for (const [index, entry] of entries.entries()) {
      await this.dataSource.query(
        `UPDATE memory_entries SET embedding = $2::vector, embedding_model = $3 WHERE id = $1`,
        [entry.id, toVectorLiteral(result.vectors[index]!), result.model],
      );
    }
  }

  /** Isi embedding yang kosong atau dibuat dengan model lama. */
  async backfill(): Promise<number> {
    if (this.running || !(await this.vectorAvailable())) return 0;
    this.running = true;
    try {
      const { embeddingModel, enabled } = await this.settings.get();
      if (!enabled) return 0;
      const rows = (await this.dataSource.query(
        `SELECT id, content FROM memory_entries
          WHERE status = 'active' AND (embedding IS NULL OR embedding_model IS DISTINCT FROM $1)
          ORDER BY created_at LIMIT $2`,
        [embeddingModel, BACKFILL_BATCH],
      )) as { id: string; content: string }[];
      if (rows.length > 0) await this.embedEntries(rows);
      return rows.length;
    } catch (error) {
      this.logger.warn(`Pengisian embedding memori gagal: ${(error as Error).message}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
