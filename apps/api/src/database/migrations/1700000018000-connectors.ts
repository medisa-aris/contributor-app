import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Konektor database untuk agent dan percakapan, grant RBAC per konektor, dan log audit
 * setiap pemanggilan tool konektor.
 */
export class Connectors1700000018000 implements MigrationInterface {
  name = 'Connectors1700000018000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE db_engine AS ENUM ('postgres', 'mysql', 'mssql', 'oracle');
      CREATE TYPE connector_kind AS ENUM ('database', 'mcp');
      CREATE TYPE connector_access AS ENUM ('read', 'read_write');
      CREATE TYPE grant_subject AS ENUM ('user', 'role', 'department', 'group');

      CREATE TABLE db_connectors (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(60) NOT NULL UNIQUE,
        name varchar(150) NOT NULL,
        description text,
        engine db_engine NOT NULL,
        host varchar(255) NOT NULL,
        port integer NOT NULL,
        database_name varchar(150) NOT NULL,
        username varchar(150) NOT NULL,
        password_enc text,
        options jsonb NOT NULL DEFAULT '{}'::jsonb,
        allow_write boolean NOT NULL DEFAULT false,
        row_limit integer NOT NULL DEFAULT 200 CHECK (row_limit BETWEEN 1 AND 5000),
        timeout_ms integer NOT NULL DEFAULT 30000 CHECK (timeout_ms BETWEEN 1000 AND 300000),
        enabled boolean NOT NULL DEFAULT true,
        last_health_at timestamptz,
        last_health_ok boolean,
        last_health_detail text,
        created_by uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE connector_grants (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        connector_type connector_kind NOT NULL,
        connector_id uuid NOT NULL,
        subject_type grant_subject NOT NULL,
        subject_id uuid NOT NULL,
        access connector_access NOT NULL DEFAULT 'read',
        table_allowlist jsonb,
        created_by uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_connector_grant UNIQUE (connector_type, connector_id, subject_type, subject_id)
      );
      CREATE INDEX idx_connector_grants_subject ON connector_grants (subject_type, subject_id);
      CREATE INDEX idx_connector_grants_connector ON connector_grants (connector_type, connector_id);

      CREATE TABLE connector_tool_calls (
        id bigserial PRIMARY KEY,
        user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        agent_id uuid,
        task_id uuid,
        conversation_id uuid,
        connector_type connector_kind NOT NULL,
        connector_id uuid NOT NULL,
        tool varchar(120) NOT NULL,
        statement text,
        kind varchar(10) NOT NULL CHECK (kind IN ('read', 'write')),
        row_count integer,
        duration_ms integer,
        status varchar(20) NOT NULL,
        error text,
        approval_id uuid,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_connector_tool_calls_user ON connector_tool_calls (user_id, created_at DESC);
      CREATE INDEX idx_connector_tool_calls_connector ON connector_tool_calls (connector_type, connector_id, created_at DESC);
    `);

    // Izin baru: memakai konektor (user) dan mengelola agent pribadi.
    await queryRunner.query(
      `INSERT INTO permissions (identifier, name, description, is_system) VALUES
         ('connectors.use', 'Memakai Konektor Data',
          'Memasang konektor data yang di-grant admin ke agent dan percakapan', true),
         ('ai.agents.manage', 'Mengelola Agent Pribadi',
          'Membuat agent, skill, dan grup agent pribadi di mode Subordinate', true)
       ON CONFLICT (identifier) DO NOTHING`,
    );
    await queryRunner.query(
      `UPDATE permissions p
          SET application_id = a.id, module_id = m.id
         FROM applications a
         JOIN modules m ON m.application_id = a.id AND m.identifier = 'modes'
        WHERE a.identifier = 'ai-workspace'
          AND p.identifier IN ('connectors.use', 'ai.agents.manage')`,
    );
    // Berikan ke setiap peran yang sudah boleh menjalankan Subordinate.
    await queryRunner.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT DISTINCT rp.role_id, np.id
         FROM role_permissions rp
         JOIN permissions sp ON sp.id = rp.permission_id AND sp.identifier = 'ai.subordinate.execute'
         JOIN permissions np ON np.identifier IN ('connectors.use', 'ai.agents.manage')
       ON CONFLICT ON CONSTRAINT uq_role_permissions DO NOTHING`,
    );
    await queryRunner.query(
      `UPDATE rbac_meta SET version = version + 1, updated_at = now() WHERE id = 1`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM permissions WHERE identifier IN ('connectors.use', 'ai.agents.manage')`,
    );
    await queryRunner.query(`
      DROP TABLE IF EXISTS connector_tool_calls;
      DROP TABLE IF EXISTS connector_grants;
      DROP TABLE IF EXISTS db_connectors;
      DROP TYPE IF EXISTS grant_subject;
      DROP TYPE IF EXISTS connector_access;
      DROP TYPE IF EXISTS connector_kind;
      DROP TYPE IF EXISTS db_engine;
    `);
  }
}
