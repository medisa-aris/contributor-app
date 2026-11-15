/** Cukup `query` saja: dipakai migrasi (QueryRunner) dan skrip (DataSource). */
type Queryable = { query(sql: string, parameters?: unknown[]): Promise<unknown> };

/** Dimensi kolom embedding memori (openai/text-embedding-3-small). */
export const MEMORY_EMBEDDING_DIMENSIONS = 1536;

/**
 * Pasang pgvector untuk memori bila ekstensinya tersedia di server PostgreSQL.
 * Idempoten; mengembalikan false bila ekstensi tidak ada (memori tetap jalan dengan teks penuh).
 */
export async function enableMemoryVector(queryRunner: Queryable): Promise<boolean> {
  const available = (await queryRunner.query(
    `SELECT 1 FROM pg_available_extensions WHERE name = 'vector'`,
  )) as unknown[];
  if (available.length === 0) return false;
  await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);
  await queryRunner.query(
    `ALTER TABLE memory_entries ADD COLUMN IF NOT EXISTS embedding vector(${MEMORY_EMBEDDING_DIMENSIONS})`,
  );
  await queryRunner.query(
    `CREATE INDEX IF NOT EXISTS idx_memory_entries_embedding ON memory_entries
       USING hnsw (embedding vector_cosine_ops) WHERE status = 'active'`,
  );
  await queryRunner.query(
    `CREATE INDEX IF NOT EXISTS idx_memory_entries_pending_embed ON memory_entries (created_at)
       WHERE embedding IS NULL`,
  );
  return true;
}
