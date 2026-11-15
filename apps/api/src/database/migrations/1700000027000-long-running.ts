import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Kerja panjang (docs/LLM-MultiModel-requirement.md §14): run yang tahan putus koneksi dan
 * restart, checkpoint per langkah, log event untuk SSE yang dapat diputar ulang, eksekusi
 * tool yang idempoten, serta kemampuan model untuk kerja panjang.
 */
export class LongRunning1700000027000 implements MigrationInterface {
  name = 'LongRunning1700000027000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE ai_models
        ADD COLUMN long_run_allowed         boolean NOT NULL DEFAULT false,
        ADD COLUMN supports_effort          boolean NOT NULL DEFAULT false,
        ADD COLUMN default_effort           varchar(10),
        ADD COLUMN supports_thinking        boolean NOT NULL DEFAULT false,
        ADD COLUMN supports_compaction      boolean NOT NULL DEFAULT false,
        ADD COLUMN supports_context_editing boolean NOT NULL DEFAULT false,
        ADD COLUMN supports_task_budget     boolean NOT NULL DEFAULT false,
        ADD COLUMN supports_prompt_cache    boolean NOT NULL DEFAULT false,
        ADD COLUMN accepts_sampling_params  boolean NOT NULL DEFAULT true;
      -- Model Claude terbaru menolak temperature/top_p/top_k; adapter Anthropic tidak mengirimnya.
      UPDATE ai_models SET accepts_sampling_params = false WHERE provider = 'anthropic';
      -- Model bawaan yang sudah dipakai dengan tools boleh langsung dipakai untuk kerja panjang.
      UPDATE ai_models SET long_run_allowed = true WHERE is_default AND supports_tools;

      CREATE TYPE ai_run_kind AS ENUM ('conversation_turn', 'task');
      CREATE TYPE ai_run_status AS ENUM
        ('queued', 'running', 'waiting_input', 'waiting_approval',
         'completed', 'failed', 'cancelled', 'budget_exhausted', 'deadline_exceeded');

      CREATE TABLE ai_runs (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        kind             ai_run_kind NOT NULL,
        user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        conversation_id  uuid REFERENCES conversations(id) ON DELETE CASCADE,
        task_id          uuid REFERENCES ai_tasks(id) ON DELETE CASCADE,
        agent_id         uuid REFERENCES agents(id) ON DELETE SET NULL,
        model_id         uuid REFERENCES ai_models(id) ON DELETE SET NULL,
        status           ai_run_status NOT NULL DEFAULT 'queued',
        prompt           text,
        options          jsonb NOT NULL DEFAULT '{}'::jsonb,
        effort           varchar(10),
        iterations       integer NOT NULL DEFAULT 0,
        max_iterations   integer NOT NULL,
        token_budget     bigint,
        tokens_in        bigint NOT NULL DEFAULT 0,
        tokens_out       bigint NOT NULL DEFAULT 0,
        deadline_at      timestamptz NOT NULL,
        lease_owner      varchar(100),
        lease_expires_at timestamptz,
        heartbeat_at     timestamptz,
        attempt          smallint NOT NULL DEFAULT 0,
        checkpoint_seq   integer NOT NULL DEFAULT 0,
        result_message_id bigint,
        error            text,
        error_code       varchar(60),
        created_at       timestamptz NOT NULL DEFAULT now(),
        started_at       timestamptz,
        finished_at      timestamptz,
        CONSTRAINT ck_ai_runs_kind CHECK (
          (kind = 'conversation_turn' AND conversation_id IS NOT NULL AND task_id IS NULL)
          OR (kind = 'task' AND task_id IS NOT NULL))
      );
      CREATE INDEX idx_ai_runs_claim ON ai_runs (created_at) WHERE status = 'queued';
      CREATE INDEX idx_ai_runs_lease ON ai_runs (lease_expires_at) WHERE status = 'running';
      CREATE INDEX idx_ai_runs_user_active ON ai_runs (user_id)
        WHERE status IN ('queued', 'running', 'waiting_input', 'waiting_approval');
      CREATE INDEX idx_ai_runs_conversation ON ai_runs (conversation_id, created_at DESC);

      CREATE TABLE ai_run_messages (
        run_id     uuid NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
        seq        integer NOT NULL,
        message    jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (run_id, seq)
      );

      CREATE TABLE ai_run_tool_calls (
        run_id       uuid NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
        tool_call_id varchar(100) NOT NULL,
        name         varchar(150) NOT NULL,
        status       varchar(20) NOT NULL CHECK (status IN ('started', 'succeeded', 'failed', 'pending_approval')),
        result       jsonb,
        started_at   timestamptz NOT NULL DEFAULT now(),
        finished_at  timestamptz,
        PRIMARY KEY (run_id, tool_call_id)
      );

      CREATE TABLE ai_run_events (
        id         bigserial PRIMARY KEY,
        run_id     uuid NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
        type       varchar(30) NOT NULL,
        payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_ai_run_events_run ON ai_run_events (run_id, id);

      ALTER TABLE conversation_messages
        ADD COLUMN provider_content jsonb,
        ADD COLUMN run_id uuid REFERENCES ai_runs(id) ON DELETE SET NULL;
      ALTER TABLE ai_tasks ADD COLUMN current_run_id uuid REFERENCES ai_runs(id) ON DELETE SET NULL;
      ALTER TABLE ai_usage_ledger
        ADD COLUMN run_id uuid REFERENCES ai_runs(id) ON DELETE SET NULL,
        ADD COLUMN cache_read_tokens  integer NOT NULL DEFAULT 0,
        ADD COLUMN cache_write_tokens integer NOT NULL DEFAULT 0;
    `);
    await queryRunner.query(`
      INSERT INTO app_config (key, value, description, is_public) VALUES
        ('ai.long_run.max_minutes', '60', 'Batas waktu satu kerja panjang (menit)', false),
        ('ai.long_run.max_iterations', '60', 'Batas langkah tool per blok kerja panjang', false),
        ('ai.long_run.max_concurrent_per_user', '2', 'Kerja panjang aktif per pengguna', false),
        ('ai.long_run.auto_promote', 'true', 'Pindahkan giliran chat yang panjang menjadi kerja panjang otomatis', false),
        ('ai.long_run.default_token_budget', 'null', 'Anggaran token bawaan per kerja panjang (null = hanya kuota)', false)
      ON CONFLICT (key) DO NOTHING
    `);
    await queryRunner.query(`UPDATE ai_models_meta SET version = version + 1 WHERE id = 1`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM app_config WHERE key LIKE 'ai.long\\_run.%'`);
    await queryRunner.query(`
      ALTER TABLE ai_usage_ledger DROP COLUMN IF EXISTS run_id, DROP COLUMN IF EXISTS cache_read_tokens,
        DROP COLUMN IF EXISTS cache_write_tokens;
      ALTER TABLE ai_tasks DROP COLUMN IF EXISTS current_run_id;
      ALTER TABLE conversation_messages DROP COLUMN IF EXISTS provider_content, DROP COLUMN IF EXISTS run_id;
      DROP TABLE IF EXISTS ai_run_events;
      DROP TABLE IF EXISTS ai_run_tool_calls;
      DROP TABLE IF EXISTS ai_run_messages;
      DROP TABLE IF EXISTS ai_runs;
      DROP TYPE IF EXISTS ai_run_status;
      DROP TYPE IF EXISTS ai_run_kind;
      ALTER TABLE ai_models
        DROP COLUMN IF EXISTS long_run_allowed, DROP COLUMN IF EXISTS supports_effort,
        DROP COLUMN IF EXISTS default_effort, DROP COLUMN IF EXISTS supports_thinking,
        DROP COLUMN IF EXISTS supports_compaction, DROP COLUMN IF EXISTS supports_context_editing,
        DROP COLUMN IF EXISTS supports_task_budget, DROP COLUMN IF EXISTS supports_prompt_cache,
        DROP COLUMN IF EXISTS accepts_sampling_params;
    `);
  }
}
