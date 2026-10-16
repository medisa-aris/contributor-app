import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AiWorkspace1700000002000 implements MigrationInterface {
  name = 'AiWorkspace1700000002000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TYPE conversation_mode AS ENUM ('second_brain', 'counterpart');
CREATE TYPE task_status AS ENUM ('created', 'validating', 'awaiting_approval', 'running', 'completed', 'failed', 'cancelled');

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode conversation_mode NOT NULL,
  title varchar(200) NOT NULL DEFAULT 'Percakapan baru',
  counterpart_style varchar(50),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_conversations_user_updated ON conversations (user_id, updated_at DESC);

CREATE TABLE conversation_messages (
  id bigserial PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role varchar(20) NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
  content text NOT NULL,
  model varchar(150),
  tokens_in integer,
  tokens_out integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_conversation_messages_conv ON conversation_messages (conversation_id, id);

CREATE TABLE ai_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title varchar(200) NOT NULL,
  instruction text NOT NULL,
  status task_status NOT NULL DEFAULT 'created',
  result text,
  error_message text,
  model varchar(150),
  tokens_in integer,
  tokens_out integer,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_tasks_user_created ON ai_tasks (user_id, created_at DESC);
CREATE INDEX idx_ai_tasks_open ON ai_tasks (status) WHERE status IN ('created', 'validating', 'awaiting_approval', 'running');

CREATE TABLE ai_task_events (
  id bigserial PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES ai_tasks(id) ON DELETE CASCADE,
  event_type varchar(50) NOT NULL,
  message text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_task_events_task ON ai_task_events (task_id, id);
`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP TABLE IF EXISTS ai_task_events;
DROP TABLE IF EXISTS ai_tasks;
DROP TABLE IF EXISTS conversation_messages;
DROP TABLE IF EXISTS conversations;
DROP TYPE IF EXISTS task_status;
DROP TYPE IF EXISTS conversation_mode;
`);
  }
}
