import {
  ALL_PERMISSION_IDS,
  APP_CONFIG_DEFINITIONS,
  AUDIT_EVENTS,
  PERMISSION_CATALOG,
  SYSTEM_ROLES,
} from '@bara/shared';
import { hash } from 'bcryptjs';
import { config as loadEnv } from 'dotenv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../data-source-options';
import { updatedRows } from '../query-result';

loadEnv({ path: join(__dirname, '../../../.env') });

const BCRYPT_ROUNDS = 11;

// Data fiktif HSE K3L PT Berau Coal (lihat data/hse-demo.json). Hanya untuk demo.
interface HseDemoData {
  users: {
    key: string;
    displayName: string;
    jobTitle: string;
    departmentCode: string;
    role: string;
  }[];
  conversations: {
    owner: string;
    taskCode: string;
    title: string;
    mode: 'second_brain' | 'counterpart';
    messages: { role: 'user' | 'assistant'; content: string }[];
  }[];
}

const HSE_DEMO = JSON.parse(
  readFileSync(join(__dirname, 'data/hse-demo.json'), 'utf8'),
) as HseDemoData;
const HSE_DEMO_PASSWORD = 'HseDemo123!';

// Percakapan Multi Brain dan tugas Subordinate tambahan untuk GM Safety (data fiktif).
interface HseExtraData {
  conversations: HseDemoData['conversations'];
  tasks: {
    owner: string;
    code: string;
    title: string;
    instruction: string;
    result: string;
    steps: string[];
    tokensIn: number;
    tokensOut: number;
    durationMs: number;
  }[];
}

// 200 aktivitas contoh (percakapan Multi Brain/Partner dan tugas Subordinate) untuk seluruh akun demo.
type BulkItem = {
  user: string;
  mode: 'second_brain' | 'counterpart' | 'subordinate';
  hoursAgo: number;
  title: string;
} & (
  | {
      kind: 'conversation';
      style: string | null;
      messages: {
        role: 'user' | 'assistant';
        content: string;
        tokensIn?: number;
        tokensOut?: number;
      }[];
    }
  | {
      kind: 'task';
      status: 'completed' | 'failed' | 'cancelled';
      instruction: string;
      result?: string;
      error?: string;
      steps: string[];
      tokensIn: number;
      tokensOut: number;
      durationMs: number;
    }
);

const HSE_BULK = (
  JSON.parse(readFileSync(join(__dirname, 'data/hse-demo-bulk.json'), 'utf8')) as {
    items: BulkItem[];
  }
).items;

const HSE_EXTRA = JSON.parse(
  readFileSync(join(__dirname, 'data/hse-demo-hendra.json'), 'utf8'),
) as HseExtraData;

// Kredensial demo untuk domain lokal `.local` — hanya untuk pelatihan.
// Pembuatan akun ini otomatis dilewati saat NODE_ENV=production.
const DEMO_USERS: readonly {
  email: string;
  password: string;
  displayName: string;
  role: string;
  dataScope: 'global' | 'department' | 'own';
  departmentCode: string | null;
  isSuperadmin: boolean;
  jobTitle?: string;
}[] = [
  {
    email: 'admin@bara.local',
    password: 'Kontrib-d98a5d6d!',
    displayName: 'Super Admin',
    role: SYSTEM_ROLES.administrator,
    dataScope: 'global',
    departmentCode: null,
    isSuperadmin: true,
  },
  {
    email: 'manajer@bara.local',
    password: 'ManajerDemo123!',
    displayName: 'Manajer Demo',
    role: SYSTEM_ROLES.manager,
    dataScope: 'department',
    departmentCode: 'IT',
    isSuperadmin: false,
  },
  {
    email: 'staf@bara.local',
    password: 'StafDemo123!',
    displayName: 'Staf Demo',
    role: SYSTEM_ROLES.staf,
    dataScope: 'own',
    departmentCode: 'IT',
    isSuperadmin: false,
  },
  ...HSE_DEMO.users.map((user) => ({
    email: `${user.key}@bara.local`,
    password: HSE_DEMO_PASSWORD,
    displayName: user.displayName,
    role: user.role,
    dataScope: 'department' as const,
    departmentCode: user.departmentCode,
    isSuperadmin: false,
    jobTitle: user.jobTitle,
  })),
];

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
    icon: 'desk',
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
            isFuture: false,
          },
          {
            key: 'nav.ai-workspace.mind-map',
            label: 'Peta Pikiran',
            i18nKey: 'nav.aiWorkspace.mindMap',
            icon: 'people',
            routePath: '/workspace/mind-map',
            permission: 'ai.mindmap.team.read',
            isFuture: false,
          },
        ],
      },
      {
        identifier: 'modes',
        name: 'Mode Berpikir',
        description: 'Multi Brain, Partner, dan Subordinate',
        items: [
          {
            key: 'nav.ai-workspace.second-brain',
            label: 'Multi Brain',
            i18nKey: 'nav.aiWorkspace.secondBrain',
            icon: 'brain',
            routePath: '/workspace/second-brain',
            permission: 'ai.secondbrain.query',
            isFuture: false,
          },
          {
            key: 'nav.ai-workspace.counterpart',
            label: 'Partner',
            i18nKey: 'nav.aiWorkspace.counterpart',
            icon: 'people-chat',
            routePath: '/workspace/counterpart',
            permission: 'ai.counterpart.analyze',
            isFuture: false,
          },
          {
            key: 'nav.ai-workspace.subordinate',
            label: 'Subordinate',
            i18nKey: 'nav.aiWorkspace.subordinate',
            icon: 'bot',
            routePath: '/workspace/subordinate',
            permission: 'ai.subordinate.execute',
            isFuture: false,
          },
          {
            key: 'nav.ai-workspace.history',
            label: 'Riwayat Percakapan',
            i18nKey: 'nav.aiWorkspace.history',
            icon: 'history',
            routePath: '/workspace/history',
            permission: 'ai.workspace.history.read',
            isFuture: false,
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
            isFuture: false,
          },
          {
            key: 'nav.knowledge-center.collections',
            label: 'Koleksi',
            i18nKey: 'nav.knowledgeCenter.collections',
            icon: 'folder',
            routePath: '/knowledge/collections',
            permission: 'knowledge.collections.read',
            isFuture: false,
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
            isFuture: false,
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
            isFuture: false,
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
            isFuture: false,
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
            isFuture: false,
          },
          {
            key: 'nav.agent-center.approvals',
            label: 'Persetujuan',
            i18nKey: 'nav.agentCenter.approvals',
            icon: 'checkmark-circle',
            routePath: '/agents/approvals',
            permission: 'agents.approve',
            isFuture: false,
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
            isFuture: false,
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
            isFuture: false,
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
      'ai.workspace.history.read',
      'ai.mindmap.team.read',
      'knowledge.documents.read',
      'knowledge.collections.read',
      'knowledge.search.use',
      'agents.view',
      'agents.execute',
      'agents.approve',
      'integrations.view',
      'admin.access',
      'rbac.users.read',
      'rbac.roles.read',
      'rbac.departments.read',
      'rbac.groups.read',
    ],
  },
  {
    code: SYSTEM_ROLES.superintendent,
    name: 'Superintendent',
    description: 'Pengawas operasional: akses kerja AI penuh tanpa akses administrasi',
    permissions: [
      'ai.workspace.access',
      'ai.secondbrain.query',
      'ai.counterpart.analyze',
      'ai.subordinate.execute',
      'ai.workspace.history.read',
      'knowledge.documents.read',
      'knowledge.collections.read',
      'knowledge.search.use',
      'agents.view',
      'agents.execute',
    ],
  },
  {
    code: SYSTEM_ROLES.staf,
    name: 'Staf',
    description: 'Akses kerja AI standar untuk seluruh karyawan',
    permissions: [
      'ai.workspace.access',
      'knowledge.documents.read',
      'knowledge.collections.read',
      'knowledge.search.use',
      'agents.view',
    ],
  },
] as const;

const SEED_DEPARTMENTS = [
  { code: 'HQ', name: 'Kantor Pusat', parent: null },
  { code: 'IT', name: 'Teknologi Informasi', parent: 'HQ' },
  { code: 'HR', name: 'Sumber Daya Manusia', parent: 'HQ' },
  { code: 'HSE', name: 'HSE K3L', parent: 'HQ' },
  { code: 'HSE-HIRA', name: 'HIRA', parent: 'HSE' },
  { code: 'HIRA-OPS', name: 'HIRA Operasional', parent: 'HSE-HIRA' },
  { code: 'HIRA-RCM', name: 'Risk Control & MOC', parent: 'HSE-HIRA' },
  { code: 'HSE-SAFETY', name: 'Safety', parent: 'HSE' },
  { code: 'SAFE-OPS', name: 'Safety Operasional & Inspeksi', parent: 'HSE-SAFETY' },
  { code: 'SAFE-CMP', name: 'Safety Compliance & Audit', parent: 'HSE-SAFETY' },
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

async function seedDemoContent(ds: DataSource): Promise<void> {
  const demoSources: {
    code: string;
    name: string;
    description: string;
    acl: Record<string, unknown>;
    documents: { title: string; locator: string; content: string }[];
  }[] = [
    {
      code: 'sop-klaim-jr',
      name: 'SOP Klaim Jasa Raharja',
      description: 'Prosedur layanan klaim santunan Jasa Raharja untuk calon kontributor',
      acl: {},
      documents: [
        {
          title: 'SOP Verifikasi Klaim Santunan',
          locator: 'sop/verifikasi-klaim.pdf',
          content:
            'Setiap pengajuan klaim santunan Jasa Raharja diverifikasi maksimal 3 hari kerja. ' +
            'Petugas memeriksa kelengkapan dokumen: identitas korban, surat keterangan kecelakaan dari kepolisian, ' +
            'dan nomor registrasi kejadian. Klaim yang lengkap diteruskan ke manajer klaim untuk persetujuan pembayaran.',
        },
        {
          title: 'FAQ Layanan Jasa Raharja',
          locator: 'sop/faq.pdf',
          content:
            'Pertanyaan umum: bagaimana cara mengajukan klaim? Korban atau ahli waris mengisi formulir pengajuan ' +
            'di kantor cabang atau aplikasi. Berapa lama pencairan? Maksimal 14 hari kerja setelah verifikasi selesai. ' +
            'Apakah ada biaya? Tidak ada biaya administrasi untuk pengajuan klaim santunan.',
        },
      ],
    },
    {
      code: 'panduan-keselamatan',
      name: 'Panduan Keselamatan Kerja',
      description: 'Materi keselamatan dan kesehatan kerja untuk seluruh pegawai',
      acl: {},
      documents: [
        {
          title: 'Panduan K3 Penumpang dan Roda',
          locator: 'k3/panduan.pdf',
          content:
            'Seluruh pegawai wajib memahami prosedur keselamatan kerja: gunakan alat pelindung diri saat turun ke lapangan, ' +
            'laporkan insiden dalam 1x24 jam, dan ikuti briefing keselamatan bulanan. Target kami: nol insiden fatal.',
        },
      ],
    },
    {
      code: 'kebijakan-internal-it',
      name: 'Kebijakan Internal IT',
      description: 'Kebijakan infrastruktur yang hanya dapat diakses peran administrator',
      acl: { roles: ['administrator'] },
      documents: [
        {
          title: 'Kebijakan Akses Server',
          locator: 'it/akses-server.pdf',
          content:
            'Akses server produksi hanya diberikan kepada administrator melalui jumphost dengan autentikasi dua faktor. ' +
            'Kredensial pribadi dilarang dibagikan, dan setiap sesi dicatat dalam log audit.',
        },
      ],
    },
  ];

  const sourceIds = new Map<string, string>();
  for (const source of demoSources) {
    const id = await insertOrSelect(
      ds,
      `INSERT INTO knowledge_sources (code, name, description, origin, acl)
       VALUES ($1, $2, $3, 'manual', $4::jsonb)
       ON CONFLICT (code) DO NOTHING
       RETURNING id`,
      [source.code, source.name, source.description, JSON.stringify(source.acl)],
      `SELECT id FROM knowledge_sources WHERE code = $1`,
      [source.code],
    );
    sourceIds.set(source.code, id);
    for (const doc of source.documents) {
      await ds.query(
        `INSERT INTO knowledge_documents (source_id, title, locator, content, status, indexed_at)
         SELECT $1::uuid, $2::varchar, $3::varchar, $4::text, 'indexed', now()
          WHERE NOT EXISTS (
            SELECT 1 FROM knowledge_documents WHERE source_id = $1::uuid AND title = $2::varchar
          )`,
        [id, doc.title, doc.locator, doc.content],
      );
    }
  }

  const klaimCollectionId = await insertOrSelect(
    ds,
    `INSERT INTO knowledge_collections (code, name, description)
     VALUES ('klaim-asuransi', 'Proses Klaim Asuransi', 'Semua referensi terkait alur klaim santunan')
     ON CONFLICT (code) DO NOTHING
     RETURNING id`,
    [],
    `SELECT id FROM knowledge_collections WHERE code = 'klaim-asuransi'`,
    [],
  );
  for (const code of ['sop-klaim-jr', 'panduan-keselamatan']) {
    await ds.query(
      `INSERT INTO knowledge_collection_sources (collection_id, source_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [klaimCollectionId, sourceIds.get(code)],
    );
  }

  const demoAgents: {
    code: string;
    name: string;
    description: string;
    instruction: string;
    tools: string[];
    requireApproval: boolean;
  }[] = [
    {
      code: 'penulis-laporan',
      name: 'Penulis Laporan Klaim',
      description: 'Menyusun draf laporan klaim mingguan dari data ringkasan',
      instruction:
        'Anda adalah asisten penulisan laporan klaim. Susun draf laporan ringkas berbahasa Indonesia ' +
        'dengan struktur: ringkasan eksekutif, statistik klaim, dan tindak lanjut. Gunakan gaya formal.',
      tools: ['knowledge.search'],
      requireApproval: false,
    },
    {
      code: 'notifikasi-pelanggan',
      name: 'Notifikasi ke Pemohon Klaim',
      description:
        'Mengirim notifikasi status klaim; tindakan sensitif yang wajib disetujui manusia',
      instruction:
        'Anda adalah agen notifikasi. Tugas Anda menyiapkan pesan notifikasi status klaim untuk pemohon. ' +
        'Karena pesan keluar perusahaan, setiap eksekusi wajib melalui persetujuan manusia terlebih dahulu.',
      tools: ['email.send', 'notification.send'],
      requireApproval: true,
    },
  ];
  for (const agent of demoAgents) {
    await ds.query(
      `INSERT INTO agents (code, name, description, instruction, tool_allowlist, require_approval)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (code) DO NOTHING`,
      [
        agent.code,
        agent.name,
        agent.description,
        agent.instruction,
        JSON.stringify(agent.tools),
        agent.requireApproval,
      ],
    );
  }

  await ds.query(
    `INSERT INTO mcp_servers (code, name, description, base_url, auth_type, enabled)
     VALUES ('mcp-demo-dokumen', 'MCP Server Dokumen (Demo)', 'Server MCP contoh untuk pelatihan integrasi',
             'http://192.168.0.62:3000/', 'none', true)
     ON CONFLICT (code) DO NOTHING`,
  );
  await ds.query(
    `INSERT INTO rest_connectors (code, name, description, base_url, tool_endpoints, auth_type, enabled)
     VALUES ('contoh-api-pelatihan', 'Contoh API Pelatihan', 'Konektor REST contoh; health check mengarah ke mesin pelatihan',
             'http://192.168.0.62:3000/',
             '[{"name":"daftar-klaim","method":"GET","path":"/rest/products"},{"name":"detail-klaim","method":"GET","path":"/rest/products/{id}"}]'::jsonb,
             'none', true)
     ON CONFLICT (code) DO NOTHING`,
  );
}

async function seedDemoUsers(ds: DataSource): Promise<number> {
  if (process.env.NODE_ENV === 'production') {
    console.log('  Akun demo: dilewati (NODE_ENV=production)');
    return 0;
  }

  let created = 0;
  for (const demo of DEMO_USERS) {
    const roleRows = (await ds.query(`SELECT id FROM roles WHERE code = $1`, [demo.role])) as {
      id: string;
    }[];
    const roleId = roleRows[0]?.id;
    if (!roleId)
      throw new Error(
        `Peran demo tidak ditemukan: ${demo.role} — jalankan seed RBAC terlebih dahulu`,
      );

    const departmentId = demo.departmentCode
      ? ((
          (await ds.query(`SELECT id FROM departments WHERE code = $1`, [demo.departmentCode])) as {
            id: string;
          }[]
        )[0]?.id ?? null)
      : null;

    // Akun demo lama memakai domain contributor.local; pindahkan ke domain baru.
    const legacyEmail = demo.email.replace('@bara.local', '@contributor.local');
    await ds.query(
      `UPDATE users SET email = $1
       WHERE lower(email) = lower($2)
         AND NOT EXISTS (SELECT 1 FROM users WHERE lower(email) = lower($1))`,
      [demo.email, legacyEmail],
    );

    const existing = (await ds.query(`SELECT id FROM users WHERE lower(email) = lower($1)`, [
      demo.email,
    ])) as { id: string }[];
    let userId = existing[0]?.id;
    if (!userId) {
      const passwordHash = await hash(demo.password, BCRYPT_ROUNDS);
      const inserted = (await ds.query(
        `INSERT INTO users (email, password_hash, display_name, status, is_superadmin, department_id, job_title)
         VALUES ($1, $2, $3, 'active', $4, $5, $6)
         ON CONFLICT (email) DO NOTHING
         RETURNING id`,
        [
          demo.email,
          passwordHash,
          demo.displayName,
          demo.isSuperadmin,
          departmentId,
          demo.jobTitle ?? null,
        ],
      )) as { id: string }[];
      userId = inserted[0]?.id;
      if (userId) created += 1;
    }
    if (!userId) {
      const again = (await ds.query(`SELECT id FROM users WHERE lower(email) = lower($1)`, [
        demo.email,
      ])) as { id: string }[];
      userId = again[0]?.id;
    }
    if (!userId) throw new Error(`Gagal membuat/memperoleh pengguna demo: ${demo.email}`);
    if (demo.jobTitle) {
      await ds.query(
        `UPDATE users SET job_title = $2 WHERE id = $1 AND job_title IS DISTINCT FROM $2`,
        [userId, demo.jobTitle],
      );
    }

    await ds.query(
      `INSERT INTO user_roles (user_id, role_id, data_scope, department_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ON CONSTRAINT uq_user_roles DO NOTHING`,
      [userId, roleId, demo.dataScope, demo.dataScope === 'department' ? departmentId : null],
    );
  }

  console.log(
    `  Akun demo: ${created} baru dibuat, ${DEMO_USERS.length} tersedia (kredensial lokal, jangan dipakai di produksi)`,
  );
  for (const demo of DEMO_USERS) {
    console.log(`    ${demo.email} / ${demo.password} — ${demo.displayName}`);
  }
  return created;
}

/** Menyisipkan percakapan contoh; idempoten per (pengguna, judul). Waktu disebar mundur per hari. */
async function insertDemoConversations(
  ds: DataSource,
  conversations: HseDemoData['conversations'],
  newestDaysAgo: number,
): Promise<number> {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();
  let created = 0;
  for (const [index, conv] of conversations.entries()) {
    const owner = (await ds.query(`SELECT id FROM users WHERE lower(email) = lower($1)`, [
      `${conv.owner}@bara.local`,
    ])) as { id: string }[];
    const userId = owner[0]?.id;
    if (!userId) continue;

    // Percakapan pertama paling lama, terakhir paling baru.
    const startedAt = new Date(now - (conversations.length - index + newestDaysAgo - 1) * DAY_MS);
    const inserted = (await ds.query(
      `INSERT INTO conversations (user_id, mode, title, created_at, updated_at)
       SELECT $1::uuid, $2::conversation_mode, $3::varchar, $4::timestamptz, $5::timestamptz
        WHERE NOT EXISTS (
          SELECT 1 FROM conversations WHERE user_id = $1::uuid AND title = $3::varchar
        )
       RETURNING id`,
      [
        userId,
        conv.mode,
        conv.title,
        startedAt,
        new Date(startedAt.getTime() + conv.messages.length * 60_000),
      ],
    )) as { id: string }[];
    const conversationId = inserted[0]?.id;
    if (!conversationId) continue;

    for (const [position, message] of conv.messages.entries()) {
      await ds.query(
        `INSERT INTO conversation_messages (conversation_id, role, content, created_at)
         VALUES ($1, $2, $3, $4)`,
        [
          conversationId,
          message.role,
          message.content,
          new Date(startedAt.getTime() + position * 60_000),
        ],
      );
    }
    created += 1;
  }
  return created;
}

/** 35 percakapan contoh HSE K3L (20 pesan tiap percakapan); idempoten per (pengguna, judul). */
async function seedHseConversations(ds: DataSource): Promise<number> {
  if (process.env.NODE_ENV === 'production') {
    console.log('  Percakapan contoh HSE: dilewati (NODE_ENV=production)');
    return 0;
  }
  const created = await insertDemoConversations(ds, HSE_DEMO.conversations, 12);
  console.log(
    `  Percakapan contoh HSE: ${created} baru dibuat, ${HSE_DEMO.conversations.length} tersedia`,
  );
  return created;
}

/** 10 percakapan Multi Brain dan 10 tugas Subordinate (selesai) untuk GM Safety; idempoten per judul. */
async function seedHendraExtras(ds: DataSource): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.log('  Data tambahan GM Safety: dilewati (NODE_ENV=production)');
    return;
  }
  const conversations = await insertDemoConversations(ds, HSE_EXTRA.conversations, 1);

  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();
  let tasks = 0;
  for (const [index, task] of HSE_EXTRA.tasks.entries()) {
    const owner = (await ds.query(`SELECT id FROM users WHERE lower(email) = lower($1)`, [
      `${task.owner}@bara.local`,
    ])) as { id: string }[];
    const userId = owner[0]?.id;
    if (!userId) continue;

    const createdAt = new Date(now - (HSE_EXTRA.tasks.length - index) * DAY_MS);
    const startedAt = new Date(createdAt.getTime() + 5_000);
    const finishedAt = new Date(startedAt.getTime() + task.durationMs);
    await ds.transaction(async (manager) => {
      const inserted = (await manager.query(
        `INSERT INTO ai_tasks
         (user_id, title, instruction, status, result, model, tokens_in, tokens_out, duration_ms,
          created_at, started_at, finished_at, updated_at)
       SELECT $1::uuid, $2::varchar, $3::text, 'completed', $4::text, 'demo-seed', $5::int, $6::int,
              $7::int, $8::timestamptz, $9::timestamptz, $10::timestamptz, $10::timestamptz
        WHERE NOT EXISTS (
          SELECT 1 FROM ai_tasks WHERE user_id = $1::uuid AND title = $2::varchar
        )
       RETURNING id`,
        [
          userId,
          task.title,
          task.instruction,
          task.result,
          task.tokensIn,
          task.tokensOut,
          task.durationMs,
          createdAt,
          startedAt,
          finishedAt,
        ],
      )) as { id: string }[];
      const taskId = inserted[0]?.id;
      if (!taskId) return;

      // Jejak eksekusi: 3 peristiwa siklus awal + 2 per langkah + 1 penutup (20-30 baris).
      const events: { type: string; message: string; payload?: object }[] = [
        { type: 'created', message: 'Tugas dibuat dan menunggu dijalankan.' },
        { type: 'validating', message: 'Instruksi divalidasi dan disiapkan.' },
        { type: 'running', message: 'Menghubungi penyedia AI…' },
      ];
      for (const step of task.steps) {
        events.push({ type: 'progress', message: `Mulai: ${step}` });
        events.push({ type: 'progress', message: `Selesai: ${step}` });
      }
      events.push({
        type: 'completed',
        message: 'Tugas selesai.',
        payload: {
          tokensIn: task.tokensIn,
          tokensOut: task.tokensOut,
          durationMs: task.durationMs,
        },
      });
      const span = finishedAt.getTime() - createdAt.getTime();
      for (const [position, event] of events.entries()) {
        await manager.query(
          `INSERT INTO ai_task_events (task_id, event_type, message, payload, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5)`,
          [
            taskId,
            event.type,
            event.message,
            JSON.stringify(event.payload ?? {}),
            new Date(createdAt.getTime() + (span * position) / (events.length - 1)),
          ],
        );
      }
      tasks += 1;
    });
  }
  console.log(
    `  Data tambahan GM Safety: ${conversations} percakapan Multi Brain dan ${tasks} tugas Subordinate baru dibuat`,
  );
}

/** 200 aktivitas contoh tersebar ke 10 akun, mode berpikir, dan 90 hari terakhir; idempoten per (pengguna, judul). */
async function seedBulkActivity(ds: DataSource): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.log('  Aktivitas contoh: dilewati (NODE_ENV=production)');
    return;
  }
  const HOUR_MS = 60 * 60 * 1000;
  const now = Date.now();
  const counts = { conversation: 0, task: 0 };

  for (const item of HSE_BULK) {
    const owner = (await ds.query(`SELECT id FROM users WHERE lower(email) = lower($1)`, [
      `${item.user}@bara.local`,
    ])) as { id: string }[];
    const userId = owner[0]?.id;
    if (!userId) continue;
    const createdAt = new Date(now - item.hoursAgo * HOUR_MS);

    if (item.kind === 'conversation') {
      await ds.transaction(async (manager) => {
        const inserted = (await manager.query(
          `INSERT INTO conversations (user_id, mode, title, counterpart_style, created_at, updated_at)
           SELECT $1::uuid, $2::conversation_mode, $3::varchar, $4::varchar, $5::timestamptz, $6::timestamptz
            WHERE NOT EXISTS (
              SELECT 1 FROM conversations WHERE user_id = $1::uuid AND title = $3::varchar
            )
           RETURNING id`,
          [
            userId,
            item.mode,
            item.title,
            item.style,
            createdAt,
            new Date(createdAt.getTime() + item.messages.length * 90_000),
          ],
        )) as { id: string }[];
        const conversationId = inserted[0]?.id;
        if (!conversationId) return;
        for (const [position, message] of item.messages.entries()) {
          await manager.query(
            `INSERT INTO conversation_messages
               (conversation_id, role, content, model, tokens_in, tokens_out, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              conversationId,
              message.role,
              message.content,
              message.role === 'assistant' ? 'demo-seed' : null,
              message.tokensIn ?? null,
              message.tokensOut ?? null,
              new Date(createdAt.getTime() + position * 90_000),
            ],
          );
        }
        counts.conversation += 1;
      });
      continue;
    }

    await ds.transaction(async (manager) => {
      const ran = item.status !== 'cancelled';
      const startedAt = ran ? new Date(createdAt.getTime() + 5_000) : null;
      const finishedAt = new Date(createdAt.getTime() + 5_000 + (ran ? item.durationMs : 2_000));
      const completed = item.status === 'completed';
      const inserted = (await manager.query(
        `INSERT INTO ai_tasks
           (user_id, title, instruction, status, result, error_message, model, tokens_in, tokens_out,
            duration_ms, created_at, started_at, finished_at, updated_at)
         SELECT $1::uuid, $2::varchar, $3::text, $4::task_status, $5::text, $6::text, $7::varchar,
                $8::int, $9::int, $10::int, $11::timestamptz, $12::timestamptz, $13::timestamptz,
                $13::timestamptz
          WHERE NOT EXISTS (
            SELECT 1 FROM ai_tasks WHERE user_id = $1::uuid AND title = $2::varchar
          )
         RETURNING id`,
        [
          userId,
          item.title,
          item.instruction,
          item.status,
          completed ? (item.result ?? null) : null,
          item.status === 'failed' ? (item.error ?? 'Tugas gagal.') : null,
          ran ? 'demo-seed' : null,
          completed ? item.tokensIn : null,
          completed ? item.tokensOut : null,
          completed ? item.durationMs : null,
          createdAt,
          startedAt,
          finishedAt,
        ],
      )) as { id: string }[];
      const taskId = inserted[0]?.id;
      if (!taskId) return;

      const events: { type: string; message: string; payload?: object }[] = [
        { type: 'created', message: 'Tugas dibuat dan menunggu dijalankan.' },
      ];
      if (item.status === 'cancelled') {
        events.push({ type: 'cancelled', message: 'Tugas dibatalkan oleh pengguna.' });
      } else {
        events.push(
          { type: 'validating', message: 'Instruksi divalidasi dan disiapkan.' },
          { type: 'running', message: 'Menghubungi penyedia AI…' },
        );
        // Tugas gagal berhenti di tengah langkah.
        const steps = completed
          ? item.steps
          : item.steps.slice(0, Math.ceil(item.steps.length / 2));
        for (const step of steps) {
          events.push({ type: 'progress', message: `Mulai: ${step}` });
          events.push({ type: 'progress', message: `Selesai: ${step}` });
        }
        events.push(
          completed
            ? {
                type: 'completed',
                message: 'Tugas selesai.',
                payload: {
                  tokensIn: item.tokensIn,
                  tokensOut: item.tokensOut,
                  durationMs: item.durationMs,
                },
              }
            : { type: 'failed', message: (item.error ?? 'Tugas gagal.').slice(0, 300) },
        );
      }
      const span = finishedAt.getTime() - createdAt.getTime();
      for (const [position, event] of events.entries()) {
        await manager.query(
          `INSERT INTO ai_task_events (task_id, event_type, message, payload, created_at)
           VALUES ($1, $2, $3, $4::jsonb, $5)`,
          [
            taskId,
            event.type,
            event.message,
            JSON.stringify(event.payload ?? {}),
            new Date(createdAt.getTime() + (span * position) / Math.max(events.length - 1, 1)),
          ],
        );
      }
      counts.task += 1;
    });
  }
  console.log(
    `  Aktivitas contoh: ${counts.conversation} percakapan dan ${counts.task} tugas baru dibuat (${HSE_BULK.length} tersedia)`,
  );
}

async function seed(ds: DataSource): Promise<void> {
  await ds.query(`INSERT INTO rbac_meta (id, version) VALUES (1, 1) ON CONFLICT (id) DO NOTHING`);

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
           ON CONFLICT (key) DO UPDATE
             SET is_future = EXCLUDED.is_future, updated_at = now()`,
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
    const parentId = dept.parent ? (departmentIds.get(dept.parent) ?? null) : null;
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

  await seedDemoContent(ds);

  const demoUsersCreated = await seedDemoUsers(ds);
  await seedHseConversations(ds);
  await seedHendraExtras(ds);
  await seedBulkActivity(ds);

  if (demoUsersCreated > 0) {
    await ds.query(
      `INSERT INTO audit_events (severity, event_key, summary, actor_label, payload)
       VALUES ('info', $1, $2, 'seed', $3::jsonb)`,
      [
        AUDIT_EVENTS.systemSeedExecuted,
        `Akun demo dibuat: ${demoUsersCreated} pengguna`,
        JSON.stringify({ created: demoUsersCreated, accounts: DEMO_USERS.map((d) => d.email) }),
      ],
    );
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
  console.log(
    `  Nav: ${counts.applications} aplikasi, ${counts.modules} modul, ${counts.menu_items} menu`,
  );
  console.log(
    `  RBAC: ${counts.permissions} permission, ${counts.roles} peran, ${counts.role_permissions} grant`,
  );
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
