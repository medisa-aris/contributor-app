import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AiProviderCode } from '@bara/shared';
import { DataSource } from 'typeorm';
import { DATA_SOURCE } from '../../../database/database.module';

export type AiUsageSource =
  | 'conversation'
  | 'regenerate'
  | 'task'
  | 'agent_subtask'
  | 'attachment_summary'
  | 'memory'
  | 'model_test'
  | 'system';

/** Pemakaian sistem dicatat tetapi tidak memotong kuota siapa pun. */
export const NON_QUOTA_SOURCES: readonly AiUsageSource[] = ['attachment_summary', 'memory', 'model_test', 'system'];

export interface UsageEntry {
  userId: string | null;
  modelId: string | null;
  provider: AiProviderCode;
  modelKey: string;
  source: AiUsageSource;
  sourceId?: string | null;
  agentId?: string | null;
  tokensIn: number;
  tokensOut: number;
  estimated: boolean;
}

/** Buku besar pemakaian token: satu baris per panggilan penyedia; sumber tunggal kuota. */
@Injectable()
export class UsageLedgerService {
  private readonly logger = new Logger(UsageLedgerService.name);

  constructor(@Inject(DATA_SOURCE) private readonly dataSource: DataSource) {}

  /** Jawaban tetap dikembalikan walau pencatatan gagal; dicoba ulang sekali. */
  async record(entry: UsageEntry): Promise<void> {
    const params = [
      entry.userId,
      entry.modelId,
      entry.provider,
      entry.modelKey,
      entry.source,
      entry.sourceId ?? null,
      entry.agentId ?? null,
      Math.max(0, Math.round(entry.tokensIn)),
      Math.max(0, Math.round(entry.tokensOut)),
      entry.estimated,
      !NON_QUOTA_SOURCES.includes(entry.source),
    ];
    const sql = `INSERT INTO ai_usage_ledger
        (user_id, model_id, provider, model_key, source, source_id, agent_id,
         tokens_in, tokens_out, estimated, counts_toward_quota)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await this.dataSource.query(sql, params);
        return;
      } catch (error) {
        if (attempt === 2) {
          this.logger.error(`Pemakaian token gagal dicatat: ${(error as Error).message}`);
        }
      }
    }
  }

  async tokensSince(
    who: { userId?: string; agentId?: string },
    modelId: string,
    since: Date,
  ): Promise<number> {
    const column = who.agentId ? 'agent_id' : 'user_id';
    const rows = (await this.dataSource.query(
      `SELECT COALESCE(sum(tokens_in + tokens_out), 0)::bigint AS used
         FROM ai_usage_ledger
        WHERE ${column} = $1 AND model_id = $2 AND counts_toward_quota AND created_at >= $3`,
      [who.agentId ?? who.userId, modelId, since],
    )) as { used: string }[];
    return Number(rows[0]?.used ?? 0);
  }

  async callsSince(userId: string, modelId: string, since: Date): Promise<number> {
    const rows = (await this.dataSource.query(
      `SELECT count(*)::int AS n FROM ai_usage_ledger
        WHERE user_id = $1 AND model_id = $2 AND counts_toward_quota AND created_at >= $3`,
      [userId, modelId, since],
    )) as { n: number }[];
    return rows[0]?.n ?? 0;
  }

  /** Total per model dalam jendela, untuk satu atau banyak pengguna. */
  async totals(
    userIds: string[] | null,
    since: Date,
    groupBy: 'user' | 'model',
  ): Promise<{ key: string; tokens: number }[]> {
    const column = groupBy === 'user' ? 'user_id' : 'model_id';
    const rows = (await this.dataSource.query(
      `SELECT ${column}::text AS key, COALESCE(sum(tokens_in + tokens_out), 0)::bigint AS tokens
         FROM ai_usage_ledger
        WHERE counts_toward_quota AND created_at >= $1 AND ${column} IS NOT NULL
          AND ($2::uuid[] IS NULL OR user_id = ANY($2::uuid[]))
        GROUP BY ${column}`,
      [since, userIds],
    )) as { key: string; tokens: string }[];
    return rows.map((r) => ({ key: r.key, tokens: Number(r.tokens) }));
  }
}
