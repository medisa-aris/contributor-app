import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1700000000000 implements MigrationInterface {
  name = 'InitialSchema1700000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TYPE user_status AS ENUM ('active', 'disabled');
CREATE TYPE data_scope AS ENUM ('global', 'department', 'own');
CREATE TYPE policy_effect AS ENUM ('allow', 'deny');
CREATE TYPE policy_subject_type AS ENUM ('user', 'group', 'role');
CREATE TYPE audit_severity AS ENUM ('info', 'warn', 'critical');

CREATE TABLE departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(150) NOT NULL,
  code varchar(50) NOT NULL UNIQUE,
  parent_id uuid REFERENCES departments(id) ON DELETE RESTRICT,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_departments_parent_name UNIQUE (parent_id, name)
);
CREATE INDEX idx_departments_parent ON departments (parent_id);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(320) NOT NULL UNIQUE,
  password_hash varchar(255) NOT NULL,
  display_name varchar(150) NOT NULL,
  status user_status NOT NULL DEFAULT 'active',
  is_superadmin boolean NOT NULL DEFAULT false,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  token_version integer NOT NULL DEFAULT 0,
  failed_login_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  locale varchar(8) NOT NULL DEFAULT 'id',
  theme varchar(8) NOT NULL DEFAULT 'system',
  last_login_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_users_email_lower ON users (lower(email));
CREATE INDEX idx_users_department ON users (department_id);
CREATE INDEX idx_users_status ON users (status);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash varchar(64) NOT NULL UNIQUE,
  csrf_secret varchar(64) NOT NULL,
  token_version_snapshot integer NOT NULL,
  ip varchar(45),
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoke_reason varchar(50)
);
CREATE INDEX idx_sessions_user_expires ON sessions (user_id, expires_at);
CREATE INDEX idx_sessions_user_active ON sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE login_attempts (
  id bigserial PRIMARY KEY,
  email varchar(320) NOT NULL,
  ip varchar(45),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  success boolean NOT NULL,
  reason varchar(30),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_login_attempts_email ON login_attempts (email, created_at DESC);
CREATE INDEX idx_login_attempts_ip ON login_attempts (ip, created_at DESC);

CREATE TABLE groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(150) NOT NULL,
  code varchar(50) NOT NULL UNIQUE,
  description text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_groups (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, group_id)
);
CREATE INDEX idx_user_groups_group ON user_groups (group_id);

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(100) NOT NULL UNIQUE,
  name varchar(150) NOT NULL,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier varchar(100) NOT NULL UNIQUE,
  name varchar(150) NOT NULL,
  description text,
  icon varchar(100),
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES modules(id) ON DELETE RESTRICT,
  identifier varchar(100) NOT NULL,
  name varchar(150) NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_modules_app_identifier UNIQUE (application_id, identifier)
);
CREATE INDEX idx_modules_parent ON modules (parent_id);

CREATE TABLE features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id uuid NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  identifier varchar(100) NOT NULL,
  name varchar(150) NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_features_module_identifier UNIQUE (module_id, identifier)
);

CREATE TABLE permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier varchar(150) NOT NULL UNIQUE,
  name varchar(150) NOT NULL,
  description text,
  application_id uuid REFERENCES applications(id) ON DELETE SET NULL,
  module_id uuid REFERENCES modules(id) ON DELETE SET NULL,
  feature_id uuid REFERENCES features(id) ON DELETE SET NULL,
  is_system boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_permissions_application ON permissions (application_id);
CREATE INDEX idx_permissions_feature ON permissions (feature_id);

CREATE TABLE role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_role_permissions UNIQUE (role_id, permission_id)
);
CREATE INDEX idx_role_permissions_permission ON role_permissions (permission_id);

CREATE TABLE user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  data_scope data_scope NOT NULL DEFAULT 'global',
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_user_roles_scope CHECK (data_scope <> 'department' OR department_id IS NOT NULL),
  CONSTRAINT uq_user_roles UNIQUE NULLS NOT DISTINCT (user_id, role_id, department_id)
);
CREATE INDEX idx_user_roles_role ON user_roles (role_id);

CREATE TABLE group_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  data_scope data_scope NOT NULL DEFAULT 'global',
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_group_roles_scope CHECK (data_scope <> 'department' OR department_id IS NOT NULL),
  CONSTRAINT uq_group_roles UNIQUE NULLS NOT DISTINCT (group_id, role_id, department_id)
);
CREATE INDEX idx_group_roles_role ON group_roles (role_id);

CREATE TABLE resource_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(150) NOT NULL,
  effect policy_effect NOT NULL,
  subject_type policy_subject_type NOT NULL,
  subject_id uuid NOT NULL,
  permission_pattern varchar(150) NOT NULL,
  resource_type varchar(100),
  resource_id varchar(150),
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_resource_policies_subject ON resource_policies (subject_type, subject_id);
CREATE INDEX idx_resource_policies_pattern ON resource_policies (permission_pattern) WHERE is_active;

CREATE TABLE menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key varchar(150) NOT NULL UNIQUE,
  label_default varchar(150) NOT NULL,
  i18n_key varchar(150),
  icon varchar(100),
  route_path varchar(255),
  parent_id uuid REFERENCES menu_items(id) ON DELETE RESTRICT,
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  module_id uuid REFERENCES modules(id) ON DELETE SET NULL,
  feature_id uuid REFERENCES features(id) ON DELETE SET NULL,
  required_permission varchar(150),
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  is_future boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_menu_items_parent ON menu_items (parent_id);
CREATE INDEX idx_menu_items_application ON menu_items (application_id);

CREATE TABLE audit_events (
  id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  severity audit_severity NOT NULL DEFAULT 'info',
  event_key varchar(100) NOT NULL,
  summary text NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_label varchar(200),
  actor_ip varchar(45),
  actor_user_agent text,
  request_id varchar(100),
  entity_type varchar(100),
  entity_id varchar(150),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_audit_events_occurred ON audit_events (occurred_at DESC);
CREATE INDEX idx_audit_events_key ON audit_events (event_key);
CREATE INDEX idx_audit_events_actor ON audit_events (actor_user_id);
CREATE INDEX idx_audit_events_entity ON audit_events (entity_type, entity_id);

CREATE TABLE app_config (
  key varchar(150) PRIMARY KEY,
  value jsonb NOT NULL,
  description text,
  is_public boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE rbac_meta (
  id smallint PRIMARY KEY,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP TABLE IF EXISTS rbac_meta;
DROP TABLE IF EXISTS app_config;
DROP TABLE IF EXISTS audit_events;
DROP TABLE IF EXISTS menu_items;
DROP TABLE IF EXISTS resource_policies;
DROP TABLE IF EXISTS group_roles;
DROP TABLE IF EXISTS user_roles;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS features;
DROP TABLE IF EXISTS modules;
DROP TABLE IF EXISTS applications;
DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS user_groups;
DROP TABLE IF EXISTS groups;
DROP TABLE IF EXISTS login_attempts;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS departments;
DROP TYPE IF EXISTS audit_severity;
DROP TYPE IF EXISTS policy_subject_type;
DROP TYPE IF EXISTS policy_effect;
DROP TYPE IF EXISTS data_scope;
DROP TYPE IF EXISTS user_status;
`);
  }
}
