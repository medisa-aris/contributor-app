import {
  ALL_PERMISSION_IDS,
  APP_CONFIG_DEFINITIONS,
  AUDIT_EVENTS,
  PERMISSION_CATALOG,
  SYSTEM_ROLES,
} from '@contributor/shared';
import { config as loadEnv } from 'dotenv';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../data-source-options';
import { updatedRows } from '../query-result';

loadEnv({ path: join(__dirname, '../../../.env') });

interface MenuSeed {
  key: string;
  label: string;
  i18nKey: string;
  icon: string;
  routePath: string;
  permission: string;
  isFuture: boolean;
}

interface ModuleSeed {
  identifier: string;
  name: string;
  description: string;
  items: MenuSeed[];
}

interface AppSeed {
  identifier: string;
  name: string;
  description: string;
  icon: string;
  modules: ModuleSeed[];
}

const NAV_TREE: readonly AppSeed[] = [
  {
    identifier: 'ai-workspace',
    name: 'Ruang Kerja AI',
    description: 'Otak kedua, mitra berpikir, dan asisten eksekusi bertenaga AI',
    icon: 'sparkle',
    modules: [
      {
        identifier: 'workspace',
        name: 'Ruang Kerja',
        description: 'Pintu masuk pengalaman AI harian',
        items: [
          {
            key: 'nav.ai-workspace.workspace',
            label: 'Ruang Kerja AI',
            i18nKey: 'nav.aiWorkspace.workspace',
            icon: 'sparkle',
            routePath: '/workspace',
            permission: 'ai.workspace.access',
            isFuture: true,
          },
        ],
      },
      {
        identifier: 'modes',
        name: 'Mode Berpikir',
        description: 'Second Brain, Counterpart, dan Subordinate',
        items: [
          {
            key: 'nav.ai-workspace.second-brain',
            label: 'Otak Kedua',
            i18nKey: 'nav.aiWorkspace.secondBrain',
            icon: 'brain',
            routePath: '/workspace/second-brain',
            permission: 'ai.secondbrain.query',
            isFuture: true,
          },
          {
            key: 'nav.ai-workspace.counterpart',
            label: 'Mitra Berpikir',
            i18nKey: 'nav.aiWorkspace.counterpart',
            icon: 'people-chat',
            routePath: '/workspace/counterpart',
            permission: 'ai.counterpart.analyze',
            isFuture: true,
          },
          {
            key: 'nav.ai-workspace.subordinate',
            label: 'Asisten Eksekusi',
            i18nKey: 'nav.aiWorkspace.subordinate',
            icon: 'bot',
            routePath: '/workspace/subordinate',
            permission: 'ai.subordinate.execute',
            isFuture: true,
          },
          {
            key: 'nav.ai-workspace.history',
            label: 'Riwayat Percakapan',
            i18nKey: 'nav.aiWorkspace.history',
            icon: 'history',
            routePath: '/workspace/history',
            permission: 'ai.workspace.history.read',
            isFuture: true,
          },
        ],
      },
    ],
  },
  {
    identifier: 'knowledge-center',
    name: 'Pusat Pengetahuan',
    description: 'Dokumen, koleksi, dan pencarian pengetahuan perusahaan',
    icon: 'book',
    modules: [
      {
        identifier: 'content',
        name: 'Konten',
        description: 'Dokumen dan koleksi sumber pengetahuan',
        items: [
          {
            key: 'nav.knowledge-center.documents',
            label: 'Dokumen',
            i18nKey: 'nav.knowledgeCenter.documents',
            icon: 'document',
            routePath: '/knowledge/documents',
            permission: 'knowledge.documents.read',
            isFuture: true,
          },
          {
            key: 'nav.knowledge-center.collections',
            label: 'Koleksi',
            i18nKey: 'nav.knowledgeCenter.collections',
            icon: 'folder',
            routePath: '/knowledge/collections',
            permission: 'knowledge.collections.read',
            isFuture: true,
          },
        ],
      },
      {
        identifier: 'search',
        name: 'Pencarian',
        description: 'Pencarian lintas pengetahuan',
        items: [
          {
            key: 'nav.knowledge-center.search',
            label: 'Pencarian Pengetahuan',
            i18nKey: 'nav.knowledgeCenter.search',
            icon: 'search',
            routePath: '/knowledge/search',
            permission: 'knowledge.search.use',
            isFuture: true,
          },
        ],
      },
    ],
  },
  {
    identifier: 'agent-center',
    name: 'Pusat Agen AI',
    description: 'Katalog, definisi, dan operasi agen AI',
    icon: 'bot',
    modules: [
      {
        identifier: 'catalog',
        name: 'Katalog',
        description: 'Daftar agen yang tersedia',
        items: [
          {
            key: 'nav.agent-center.catalog',
            label: 'Katalog Agen',
            i18nKey: 'nav.agentCenter.catalog',
            icon: 'apps',
            routePath: '/agents',
            permission: 'agents.view',
            isFuture: true,
          },
        ],
      },
      {
        identifier: 'definitions',
        name: 'Definisi Agen',
        description: 'Perancangan dan konfigurasi agen',
        items: [
          {
            key: 'nav.agent-center.definitions',
            label: 'Kelola Agen',
            i18nKey: 'nav.agentCenter.definitions',
            icon: 'settings',
            routePath: '/agents/definitions',
            permission: 'agents.create',
            isFuture: true,
          },
        ],
      },
      {
        identifier: 'operations',
        name: 'Operasional',
        description: 'Eksekusi tugas dan persetujuan',
        items: [
          {
            key: 'nav.agent-center.operations',
            label: 'Jalankan Tugas',
            i18nKey: 'nav.agentCenter.operations',
            icon: 'play',
            routePath: '/agents/operations',
            permission: 'agents.execute',
            isFuture: true,
          },
          {
            key: 'nav.agent-center.approvals',
            label: 'Persetujuan',
            i18nKey: 'nav.agentCenter.approvals',
            icon: 'checkmark-circle',
            routePath: '/agents/approvals',
            permission: 'agents.approve',
            isFuture: true,
          },
        ],
      },
    ],
  },
  {
    identifier: 'integration-center',
    name: 'Pusat Integrasi',
    description: 'Koneksi, provider, dan kredensial integrasi',
    icon: 'plug',
    modules: [
      {
        identifier: 'connections',
        name: 'Koneksi',
        description: 'Status koneksi dan provider',
        items: [
          {
            key: 'nav.integration-center.connections',
            label: 'Koneksi & Status',
            i18nKey: 'nav.integrationCenter.connections',
            icon: 'plug-connected',
            routePath: '/integrations',
            permission: 'integrations.view',
            isFuture: true,
          },
        ],
      },
      {
        identifier: 'credentials',
        name: 'Kredensial',
        description: 'Konfigurasi kredensial integrasi',
        items: [
          {
            key: 'nav.integration-center.credentials',
            label: 'Kredensial',
            i18nKey: 'nav.integrationCenter.credentials',
            icon: 'key',
            routePath: '/integrations/credentials',
            permission: 'integrations.configure',
            isFuture: true,
          },
        ],
      },
    ],
  },
  {
    identifier: 'administration',
    name: 'Administrasi',
    description: 'Manajemen akses, diagnostik, dan platform',
    icon: 'shield',
    modules: [
      {
        identifier: 'access',
        name: 'Manajemen Akses',
        description: 'Pengguna, grup, departemen, peran, permission, dan kebijakan',
        items: [
          {
            key: 'nav.administration.users',
            label: 'Pengguna',
            i18nKey: 'nav.administration.users',
            icon: 'people',
            routePath: '/administration/users',
            permission: 'rbac.users.read',
            isFuture: false,
          },
          {
            key: 'nav.administration.groups',
            label: 'Grup',
            i18nKey: 'nav.administration.groups',
            icon: 'people-team',
            routePath: '/administration/groups',
            permission: 'rbac.groups.read',
            isFuture: false,
          },
          {
            key: 'nav.administration.departments',
            label: 'Departemen',
            i18nKey: 'nav.administration.departments',
            icon: 'building',
            routePath: '/administration/departments',
            permission: 'rbac.departments.read',
            isFuture: false,
          },
          {
            key: 'nav.administration.roles',
            label: 'Peran',
            i18nKey: 'nav.administration.roles',
            icon: 'shield-key',
            routePath: '/administration/roles',
            permission: 'rbac.roles.read',
            isFuture: false,
          },
          {
            key: 'nav.administration.permissions',
            label: 'Katalog Permission',
            i18nKey: 'nav.administration.permissions',
            icon: 'list',
            routePath: '/administration/permissions',
            permission: 'rbac.permissions.read',
            isFuture: false,
          },
          {
            key: 'nav.administration.policies',
            label: 'Kebijakan',
            i18nKey: 'nav.administration.policies',
            icon: 'gavel',
            routePath: '/administration/policies',
            permission: 'rbac.policies.read',
            isFuture: false,
          },
        ],
      },
      {
        identifier: 'diagnostics',
        name: 'Diagnostik',
        description: 'Inspeksi otorisasi dan log audit',
        items: [
          {
            key: 'nav.administration.effective-permissions',
            label: 'Permission Efektif',
            i18nKey: 'nav.administration.effectivePermissions',
            icon: 'eye',
            routePath: '/administration/effective-permissions',
            permission: 'rbac.effective.inspect',
            isFuture: false,
          },
          {
            key: 'nav.administration.authz-test',
            label: 'Uji Otorisasi',
            i18nKey: 'nav.administration.authzTest',
            icon: 'beaker',
            routePath: '/administration/authz-test',
            permission: 'rbac.authz.test',
            isFuture: false,
          },
          {
            key: 'nav.administration.audit',
            label: 'Log Audit',
            i18nKey: 'nav.administration.audit',
            icon: 'history',
            routePath: '/administration/audit',
            permission: 'audit.logs.read',
            isFuture: false,
          },
        ],
      },
      {
        identifier: 'platform',
        name: 'Platform',
        description: 'Navigasi, konfigurasi, sesi, dan provider AI',
        items: [
          {
            key: 'nav.administration.navigation',
            label: 'Navigasi',
            i18nKey: 'nav.administration.navigation',
            icon: 'navigation',
            routePath: '/administration/navigation',
            permission: 'nav.manage',
            isFuture: false,
          },
          {
            key: 'nav.administration.config',
            label: 'Konfigurasi',
            i18nKey: 'nav.administration.config',
            icon: 'settings',
            routePath: '/administration/config',
            permission: 'config.read',
            isFuture: false,
          },
          {
            key: 'nav.administration.sessions',
            label: 'Sesi',
            i18nKey: 'nav.administration.sessions',
            icon: 'clock',
            routePath: '/administration/sessions',
            permission: 'security.sessions.manage',
            isFuture: false,
          },
          {
            key: 'nav.administration.providers',
            label: 'Provider AI',
            i18nKey: 'nav.administration.providers',
            icon: 'cloud',
            routePath: '/administration/providers',
            permission: 'providers.health.read',
            isFuture: false,
          },
        ],
      },
    ],
  },
];

const SEED_ROLES = [
  {
    code: SYSTEM_ROLES.administrator,
    name: 'Administrator',
    description: 'Akses penuh ke seluruh aplikasi dan pengaturan',
    permissions: [...ALL_PERMISSION_IDS] as string[],
  },
  {
    code: SYSTEM_ROLES.manager,
    name: 'Manajer',
    description: 'Pemimpin tim: akses kerja AI dan visibilitas anggota tim',
    permissions: [
      'ai.workspace.access',
      'ai.secondbrain.query',
      'ai.counterpart.analyze',
      'ai.subordinate.execute',
      'knowledge.documents.read',
      'knowledge.search.use',
      'agents.view',
      'agents.execute',
      'admin.access',
      'rbac.users.read',
      'rbac.roles.read',
      'rbac.departments.read',
      'rbac.groups.read',
    ],
  },
  {
    code: SYSTEM_ROLES.staf,
    name: 'Staf',
    description: 'Akses kerja AI standar untuk seluruh karyawan',
    permissions: [
      'ai.workspace.access',
      'knowledge.documents.read',
      'knowledge.search.use',
      'agents.view',
    ],
  },
] as const;

const SEED_DEPARTMENTS = [
  { code: 'HQ', name: 'Kantor Pusat', parent: null },
  { code: 'IT', name: 'Teknologi Informasi', parent: 'HQ' },
  { code: 'HR', name: 'Sumber Daya Manusia', parent: 'HQ' },
] as const;

async function insertOrSelect(
  ds: DataSource,
  insertSql: string,
  params: unknown[],
  selectSql: string,
  selectParams: unknown[],
): Promise<string> {
  const inserted = (await ds.query(insertSql, params)) as { id: string }[];
  if (inserted[0]?.id) return inserted[0].id;
  const existing = (await ds.query(selectSql, selectParams)) as { id: string }[];
  const id = existing[0]?.id;
  if (!id) throw new Error(`Baris tidak ditemukan setelah konflik: ${selectSql}`);
  return id;
}

async function seed(ds: DataSource): Promise<void> {
  await ds.query(
    `INSERT INTO rbac_meta (id, version) VALUES (1, 1) ON CONFLICT (id) DO NOTHING`,
  );

  for (const def of APP_CONFIG_DEFINITIONS) {
    await ds.query(
      `INSERT INTO app_config (key, value, description, is_public)
       VALUES ($1, $2::jsonb, $3, $4)
       ON CONFLICT (key) DO NOTHING`,
      [def.key, JSON.stringify(def.defaultValue), def.description, def.isPublic],
    );
  }

  for (const [appIndex, app] of NAV_TREE.entries()) {
    const appId = await insertOrSelect(
      ds,
      `INSERT INTO applications (identifier, name, description, icon, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (identifier) DO NOTHING
       RETURNING id`,
      [app.identifier, app.name, app.description, app.icon, appIndex + 1],
      `SELECT id FROM applications WHERE identifier = $1`,
      [app.identifier],
    );
    for (const [moduleIndex, mod] of app.modules.entries()) {
      const moduleId = await insertOrSelect(
        ds,
        `INSERT INTO modules (application_id, identifier, name, description, sort_order)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (application_id, identifier) DO NOTHING
         RETURNING id`,
        [appId, mod.identifier, mod.name, mod.description, moduleIndex + 1],
        `SELECT id FROM modules WHERE application_id = $1 AND identifier = $2`,
        [appId, mod.identifier],
      );
      for (const [itemIndex, item] of mod.items.entries()) {
        await ds.query(
          `INSERT INTO menu_items
             (key, application_id, module_id, label_default, i18n_key, icon,
              route_path, required_permission, sort_order, is_active, is_future)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10)
           ON CONFLICT (key) DO NOTHING`,
          [
            item.key,
            appId,
            moduleId,
            item.label,
            item.i18nKey,
            item.icon,
            item.routePath,
            item.permission,
            itemIndex + 1,
            item.isFuture,
          ],
        );
      }
    }
  }

  for (const def of PERMISSION_CATALOG) {
    await ds.query(
      `INSERT INTO permissions (identifier, name, description, is_system)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (identifier) DO NOTHING`,
      [def.id, def.name, def.description],
    );
    await ds.query(
      `UPDATE permissions p
          SET application_id = a.id, module_id = m.id
         FROM applications a
         LEFT JOIN modules m ON m.application_id = a.id AND m.identifier = $3
        WHERE a.identifier = $2 AND p.identifier = $1`,
      [def.id, def.application, def.module],
    );
  }

  for (const role of SEED_ROLES) {
    const roleId = await insertOrSelect(
      ds,
      `INSERT INTO roles (code, name, description, is_system)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (code) DO NOTHING
       RETURNING id`,
      [role.code, role.name, role.description],
      `SELECT id FROM roles WHERE code = $1`,
      [role.code],
    );
    await ds.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, p.id FROM permissions p WHERE p.identifier = ANY($2::text[])
       ON CONFLICT ON CONSTRAINT uq_role_permissions DO NOTHING`,
      [roleId, [...role.permissions]],
    );
  }

  const departmentIds = new Map<string, string>();
  for (const dept of SEED_DEPARTMENTS) {
    const parentId = dept.parent ? departmentIds.get(dept.parent) ?? null : null;
    const id = await insertOrSelect(
      ds,
      `INSERT INTO departments (code, name, parent_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (code) DO NOTHING
       RETURNING id`,
      [dept.code, dept.name, parentId],
      `SELECT id FROM departments WHERE code = $1`,
      [dept.code],
    );
    departmentIds.set(dept.code, id);
  }

  const versionRows = updatedRows<{ version: number }>(
    await ds.query(
      `UPDATE rbac_meta SET version = version + 1, updated_at = now() WHERE id = 1 RETURNING version`,
    ),
  );
  const version = versionRows[0]?.version ?? 1;

  await ds.query(
    `INSERT INTO audit_events (severity, event_key, summary, actor_label, payload)
     VALUES ('info', $1, $2, 'seed', $3::jsonb)`,
    [
      AUDIT_EVENTS.systemSeedExecuted,
      `Seed sistem dijalankan (versi RBAC ${version})`,
      JSON.stringify({ version }),
    ],
  );

  const countRows = (await ds.query(
    `SELECT
       (SELECT count(*) FROM applications)::int AS applications,
       (SELECT count(*) FROM modules)::int AS modules,
       (SELECT count(*) FROM menu_items)::int AS menu_items,
       (SELECT count(*) FROM permissions)::int AS permissions,
       (SELECT count(*) FROM roles)::int AS roles,
       (SELECT count(*) FROM role_permissions)::int AS role_permissions,
       (SELECT count(*) FROM departments)::int AS departments,
       (SELECT count(*) FROM app_config)::int AS app_config`,
  )) as Record<string, number>[];
  const counts = countRows[0] ?? {};

  console.log('Seed selesai (idempoten, aman dijalankan berulang):');
  console.log(`  Nav: ${counts.applications} aplikasi, ${counts.modules} modul, ${counts.menu_items} menu`);
  console.log(`  RBAC: ${counts.permissions} permission, ${counts.roles} peran, ${counts.role_permissions} grant`);
  console.log(`  Organisasi: ${counts.departments} departemen, ${counts.app_config} konfigurasi`);
  console.log(`  Versi RBAC: ${version}`);
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (apps/api/.env)');
  const ds = new DataSource(buildDataSourceOptions(url));
  await ds.initialize();
  try {
    const applied = await ds.runMigrations();
    if (applied.length > 0) {
      console.log(`Migrasi diterapkan: ${applied.map((m) => m.name).join(', ')}`);
    }
    await seed(ds);
  } finally {
    await ds.destroy();
  }
}

main().catch((err: Error) => {
  console.error(`Seed gagal: ${err.message}`);
  process.exit(1);
});
