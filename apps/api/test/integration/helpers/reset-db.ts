import { hash } from 'bcryptjs';
import type { DataSource } from 'typeorm';
import { ALL_PERMISSION_IDS, PERMISSION_CATALOG, SYSTEM_ROLES } from '@contributor/shared';

export const TEST_PASSWORD = 'Test123456!';

const TRUNCATE_TABLES = [
  'approvals',
  'rest_connectors',
  'mcp_servers',
  'knowledge_documents',
  'knowledge_collection_sources',
  'knowledge_collections',
  'knowledge_sources',
  'agents',
  'ai_task_events',
  'ai_tasks',
  'conversation_messages',
  'conversations',
  'audit_events',
  'app_config',
  'login_attempts',
  'sessions',
  'user_groups',
  'user_roles',
  'group_roles',
  'role_permissions',
  'resource_policies',
  'menu_items',
  'permissions',
  'features',
  'modules',
  'applications',
  'roles',
  'groups',
  'users',
  'departments',
];

export async function resetDatabase(dataSource: DataSource): Promise<void> {
  await dataSource.query(`TRUNCATE TABLE ${TRUNCATE_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}

export interface TestFixtures {
  users: {
    superadmin: string;
    admin: string;
    manager: string;
    managerHr: string;
    hrAdmin: string;
    staf: string;
    disabled: string;
  };
  roles: { administrator: string; manager: string; staf: string; hrAdmin: string };
  departments: { it: string; itData: string; hr: string };
}

export const MANAGER_PERMISSIONS = [
  'ai.workspace.access',
  'ai.secondbrain.query',
  'ai.counterpart.analyze',
  'ai.subordinate.execute',
  'ai.mindmap.team.read',
  'knowledge.documents.read',
  'knowledge.search.use',
  'agents.view',
  'agents.execute',
  'admin.access',
  'rbac.users.read',
  'rbac.roles.read',
  'rbac.departments.read',
  'rbac.groups.read',
];

export const STAF_PERMISSIONS = [
  'ai.workspace.access',
  'knowledge.documents.read',
  'knowledge.search.use',
  'agents.view',
];

export const HR_ADMIN_PERMISSIONS = [
  'admin.access',
  'rbac.users.read',
  'rbac.users.manage',
  'rbac.permissions.assign',
];

async function insertReturningId(
  dataSource: DataSource,
  sql: string,
  params: unknown[],
): Promise<string> {
  const rows = (await dataSource.query(sql, params)) as { id: string }[];
  const id = rows[0]?.id;
  if (!id) throw new Error(`INSERT gagal: ${sql}`);
  return id;
}

interface CreateUserInput {
  email: string;
  name: string;
  passwordHash: string;
  departmentId: string;
  isSuperadmin?: boolean;
  status?: string;
}

async function createUser(dataSource: DataSource, input: CreateUserInput): Promise<string> {
  return insertReturningId(
    dataSource,
    `INSERT INTO users (email, password_hash, display_name, department_id, is_superadmin, status)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      input.email,
      input.passwordHash,
      input.name,
      input.departmentId,
      input.isSuperadmin ?? false,
      input.status ?? 'active',
    ],
  );
}

export async function seedTestFixtures(dataSource: DataSource): Promise<TestFixtures> {
  const passwordHash = await hash(TEST_PASSWORD, 11);

  const it = await insertReturningId(
    dataSource,
    `INSERT INTO departments (name, code) VALUES ('IT', 'IT') RETURNING id`,
    [],
  );
  const itData = await insertReturningId(
    dataSource,
    `INSERT INTO departments (name, code, parent_id) VALUES ('IT - Data', 'IT-DATA', $1) RETURNING id`,
    [it],
  );
  const hr = await insertReturningId(
    dataSource,
    `INSERT INTO departments (name, code) VALUES ('HR', 'HR') RETURNING id`,
    [],
  );

  const permissionIds = new Map<string, string>();
  for (const def of PERMISSION_CATALOG) {
    const id = await insertReturningId(
      dataSource,
      `INSERT INTO permissions (identifier, name, description, is_system)
       VALUES ($1, $2, $3, true) RETURNING id`,
      [def.id, def.name, def.description],
    );
    permissionIds.set(def.id, id);
  }

  const adminRoleId = await insertReturningId(
    dataSource,
    `INSERT INTO roles (code, name, is_system) VALUES ($1, 'Administrator', true) RETURNING id`,
    [SYSTEM_ROLES.administrator],
  );
  const managerRoleId = await insertReturningId(
    dataSource,
    `INSERT INTO roles (code, name, is_system) VALUES ($1, 'Manajer', true) RETURNING id`,
    [SYSTEM_ROLES.manager],
  );
  const stafRoleId = await insertReturningId(
    dataSource,
    `INSERT INTO roles (code, name, is_system) VALUES ($1, 'Staf', true) RETURNING id`,
    [SYSTEM_ROLES.staf],
  );
  const hrAdminRoleId = await insertReturningId(
    dataSource,
    `INSERT INTO roles (code, name, is_system) VALUES ('hr_admin', 'HR Admin', false) RETURNING id`,
    [],
  );

  for (const permission of ALL_PERMISSION_IDS) {
    await dataSource.query(
      `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`,
      [adminRoleId, permissionIds.get(permission)],
    );
  }
  for (const permission of MANAGER_PERMISSIONS) {
    await dataSource.query(
      `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`,
      [managerRoleId, permissionIds.get(permission)],
    );
  }
  for (const permission of STAF_PERMISSIONS) {
    await dataSource.query(
      `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`,
      [stafRoleId, permissionIds.get(permission)],
    );
  }
  for (const permission of HR_ADMIN_PERMISSIONS) {
    await dataSource.query(
      `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`,
      [hrAdminRoleId, permissionIds.get(permission)],
    );
  }

  const superadmin = await createUser(dataSource, {
    email: 'superadmin@test.local',
    name: 'Super Admin',
    passwordHash,
    departmentId: it,
    isSuperadmin: true,
  });
  const admin = await createUser(dataSource, {
    email: 'admin@test.local',
    name: 'Admin',
    passwordHash,
    departmentId: it,
  });
  const manager = await createUser(dataSource, {
    email: 'manager@test.local',
    name: 'Manajer',
    passwordHash,
    departmentId: it,
  });
  const managerHr = await createUser(dataSource, {
    email: 'managerhr@test.local',
    name: 'Manajer HR',
    passwordHash,
    departmentId: hr,
  });
  const hrAdmin = await createUser(dataSource, {
    email: 'hradmin@test.local',
    name: 'Admin HR',
    passwordHash,
    departmentId: hr,
  });
  const staf = await createUser(dataSource, {
    email: 'staf@test.local',
    name: 'Staf',
    passwordHash,
    departmentId: itData,
  });
  const disabled = await createUser(dataSource, {
    email: 'disabled@test.local',
    name: 'Nonaktif',
    passwordHash,
    departmentId: it,
    status: 'disabled',
  });

  await dataSource.query(
    `INSERT INTO user_roles (user_id, role_id, data_scope) VALUES ($1, $2, 'global')`,
    [admin, adminRoleId],
  );
  await dataSource.query(
    `INSERT INTO user_roles (user_id, role_id, data_scope, department_id) VALUES ($1, $2, 'department', $3)`,
    [manager, managerRoleId, it],
  );
  await dataSource.query(
    `INSERT INTO user_roles (user_id, role_id, data_scope, department_id) VALUES ($1, $2, 'department', $3)`,
    [managerHr, managerRoleId, hr],
  );
  await dataSource.query(
    `INSERT INTO user_roles (user_id, role_id, data_scope, department_id) VALUES ($1, $2, 'department', $3)`,
    [hrAdmin, hrAdminRoleId, hr],
  );
  await dataSource.query(
    `INSERT INTO user_roles (user_id, role_id, data_scope) VALUES ($1, $2, 'own')`,
    [staf, stafRoleId],
  );

  // app_config ikut di-truncate, jadi baris bawaan migrasi di-seed ulang agar
  // pengujian konfigurasi publik dan admin selalu berangkat dari keadaan sama.
  await dataSource.query(`
INSERT INTO app_config (key, value, description, is_public) VALUES
  ('app.name', '"Contributor AI"', 'Nama aplikasi yang tampil di antarmuka', true),
  ('app.default_locale', '"id"', 'Bahasa antarmuka bawaan', true),
  ('app.default_theme', '"system"', 'Tema bawaan', true),
  ('app.timezone', '"Asia/Jakarta"', 'Zona waktu tampilan', true),
  ('ai.show_token_usage', 'true', 'Tampilkan total token konteks dan output pada antarmuka chat (Ya/Tidak)', true),
  ('security.lockout_threshold', '5', 'Jumlah kegagalan login sebelum akun terkunci', false),
  ('security.lockout_minutes', '15', 'Durasi kunci akun dalam menit', false),
  ('security.session_idle_minutes', '480', 'Batas idle sesi dalam menit', false),
  ('security.session_absolute_hours', '168', 'Batas absolut umur sesi dalam jam', false)
ON CONFLICT (key) DO NOTHING;
`);

  return {
    users: { superadmin, admin, manager, managerHr, hrAdmin, staf, disabled },
    roles: { administrator: adminRoleId, manager: managerRoleId, staf: stafRoleId, hrAdmin: hrAdminRoleId },
    departments: { it, itData, hr },
  };
}
