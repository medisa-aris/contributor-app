import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agent pribadi (ala QoderWake "Waker"): agent milik user dengan persona, skill, dan konektor;
 * grup agent (delegasi Leader / diskusi bergiliran); state percakapan tugas agar loop tool dapat
 * dilanjutkan setelah persetujuan atau balasan user; approval untuk pemanggilan tool tulis.
 *
 * Agent yang sudah ada (buatan admin) menjadi template.
 */
export class PersonalAgents1700000020000 implements MigrationInterface {
  name = 'PersonalAgents1700000020000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'needs_input'`);
    await queryRunner.query(`
      ALTER TABLE agents
        ADD COLUMN owner_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
        ADD COLUMN is_template boolean NOT NULL DEFAULT false,
        ADD COLUMN template_id uuid REFERENCES agents(id) ON DELETE SET NULL,
        ADD COLUMN avatar_color varchar(20),
        ADD COLUMN responsibilities text,
        ADD COLUMN boundaries text,
        ADD COLUMN memory text;
      UPDATE agents SET is_template = true WHERE owner_user_id IS NULL;
      CREATE INDEX idx_agents_owner ON agents (owner_user_id) WHERE owner_user_id IS NOT NULL;

      CREATE TABLE skills (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
        name varchar(120) NOT NULL,
        description text NOT NULL,
        instructions text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_skills_owner ON skills (owner_user_id);

      CREATE TABLE agent_skills (
        agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        skill_id uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        PRIMARY KEY (agent_id, skill_id)
      );

      CREATE TABLE agent_connectors (
        agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        connector_type connector_kind NOT NULL,
        connector_id uuid NOT NULL,
        access connector_access NOT NULL DEFAULT 'read',
        PRIMARY KEY (agent_id, connector_type, connector_id)
      );

      CREATE TYPE agent_group_mode AS ENUM ('delegate', 'discussion');
      CREATE TABLE agent_groups (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name varchar(150) NOT NULL,
        description text,
        mode agent_group_mode NOT NULL DEFAULT 'delegate',
        leader_agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        max_rounds smallint NOT NULL DEFAULT 3 CHECK (max_rounds BETWEEN 1 AND 6),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_agent_groups_owner ON agent_groups (owner_user_id);
      CREATE TABLE agent_group_members (
        group_id uuid NOT NULL REFERENCES agent_groups(id) ON DELETE CASCADE,
        agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        position smallint NOT NULL DEFAULT 0,
        PRIMARY KEY (group_id, agent_id)
      );

      ALTER TABLE ai_tasks
        ADD COLUMN group_id uuid REFERENCES agent_groups(id) ON DELETE SET NULL,
        ADD COLUMN parent_task_id uuid REFERENCES ai_tasks(id) ON DELETE CASCADE;
      CREATE INDEX idx_ai_tasks_parent ON ai_tasks (parent_task_id) WHERE parent_task_id IS NOT NULL;

      -- State loop tugas: pesan model/tool agar tugas bisa dilanjutkan (JSON ChatMessage).
      CREATE TABLE ai_task_messages (
        id bigserial PRIMARY KEY,
        task_id uuid NOT NULL REFERENCES ai_tasks(id) ON DELETE CASCADE,
        agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
        message jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_ai_task_messages_task ON ai_task_messages (task_id, id);

      ALTER TABLE approvals
        ALTER COLUMN task_id DROP NOT NULL,
        ADD COLUMN kind varchar(20) NOT NULL DEFAULT 'task',
        ADD COLUMN payload jsonb,
        ADD COLUMN tool_call_id varchar(120),
        ADD COLUMN conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
        ADD COLUMN message_id bigint REFERENCES conversation_messages(id) ON DELETE CASCADE;
      CREATE INDEX idx_approvals_requester_pending ON approvals (requester_id, created_at DESC) WHERE status = 'pending';
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_approvals_requester_pending;
      DELETE FROM approvals WHERE task_id IS NULL;
      ALTER TABLE approvals
        DROP COLUMN IF EXISTS message_id,
        DROP COLUMN IF EXISTS conversation_id,
        DROP COLUMN IF EXISTS tool_call_id,
        DROP COLUMN IF EXISTS payload,
        DROP COLUMN IF EXISTS kind,
        ALTER COLUMN task_id SET NOT NULL;
      DROP TABLE IF EXISTS ai_task_messages;
      ALTER TABLE ai_tasks DROP COLUMN IF EXISTS parent_task_id, DROP COLUMN IF EXISTS group_id;
      DROP TABLE IF EXISTS agent_group_members;
      DROP TABLE IF EXISTS agent_groups;
      DROP TYPE IF EXISTS agent_group_mode;
      DROP TABLE IF EXISTS agent_connectors;
      DROP TABLE IF EXISTS agent_skills;
      DROP TABLE IF EXISTS skills;
      DELETE FROM agents WHERE owner_user_id IS NOT NULL;
      ALTER TABLE agents
        DROP COLUMN IF EXISTS memory,
        DROP COLUMN IF EXISTS boundaries,
        DROP COLUMN IF EXISTS responsibilities,
        DROP COLUMN IF EXISTS avatar_color,
        DROP COLUMN IF EXISTS template_id,
        DROP COLUMN IF EXISTS is_template,
        DROP COLUMN IF EXISTS owner_user_id;
    `);
  }
}
