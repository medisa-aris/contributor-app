/**
 * Single source of truth for every stable permission identifier.
 * Identifiers are permanent API contract - never rename, only add/deprecate.
 */
export const PERMISSIONS = {
  // AI Workspace
  workspaceAccess: 'ai.workspace.access',
  secondBrainQuery: 'ai.secondbrain.query',
  counterpartAnalyze: 'ai.counterpart.analyze',
  subordinateExecute: 'ai.subordinate.execute',
  workspaceHistoryRead: 'ai.workspace.history.read',

  // Knowledge Center
  knowledgeDocumentsRead: 'knowledge.documents.read',
  knowledgeCollectionsRead: 'knowledge.collections.read',
  knowledgeCollectionsManage: 'knowledge.collections.manage',
  knowledgeSearchUse: 'knowledge.search.use',

  // AI Agent Center
  agentsView: 'agents.view',
  agentsCreate: 'agents.create',
  agentsUpdate: 'agents.update',
  agentsDelete: 'agents.delete',
  agentsExecute: 'agents.execute',
  agentsApprove: 'agents.approve',

  // Integration Center
  integrationsView: 'integrations.view',
  integrationsConfigure: 'integrations.configure',

  // Administration - access management
  adminAccess: 'admin.access',
  usersRead: 'rbac.users.read',
  usersManage: 'rbac.users.manage',
  groupsRead: 'rbac.groups.read',
  groupsManage: 'rbac.groups.manage',
  departmentsRead: 'rbac.departments.read',
  departmentsManage: 'rbac.departments.manage',
  rolesRead: 'rbac.roles.read',
  rolesManage: 'rbac.roles.manage',
  permissionsRead: 'rbac.permissions.read',
  permissionsAssign: 'rbac.permissions.assign',
  policiesRead: 'rbac.policies.read',
  policiesManage: 'rbac.policies.manage',
  effectiveInspect: 'rbac.effective.inspect',
  authzTest: 'rbac.authz.test',

  // Administration - platform and diagnostics
  navManage: 'nav.manage',
  configRead: 'config.read',
  configManage: 'config.manage',
  sessionsManage: 'security.sessions.manage',
  auditRead: 'audit.logs.read',
  providersHealthRead: 'providers.health.read',
} as const;

export type PermissionId = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export interface PermissionDefinition {
  id: PermissionId;
  name: string;
  description: string;
  application: string;
  module: string;
}

/** Default catalog metadata, seeded into the permissions table (name/description stay editable in DB). */
export const PERMISSION_CATALOG: readonly PermissionDefinition[] = [
  { id: PERMISSIONS.workspaceAccess, name: 'Akses Ruang Kerja AI', description: 'Membuka aplikasi Ruang Kerja AI', application: 'ai-workspace', module: 'workspace' },
  { id: PERMISSIONS.secondBrainQuery, name: 'Bertanya ke Otak Kedua', description: 'Bertanya pengetahuan perusahaan lewat mode Second Brain', application: 'ai-workspace', module: 'modes' },
  { id: PERMISSIONS.counterpartAnalyze, name: 'Berdiskusi dengan Mitra Berpikir', description: 'Analisis dan debat konsep lewat mode Counterpart', application: 'ai-workspace', module: 'modes' },
  { id: PERMISSIONS.subordinateExecute, name: 'Menjalankan Tugas Asisten', description: 'Eksekusi tugas lewat mode Subordinate', application: 'ai-workspace', module: 'modes' },
  { id: PERMISSIONS.workspaceHistoryRead, name: 'Melihat Riwayat Percakapan', description: 'Riwayat percakapan dan tugas di Ruang Kerja AI', application: 'ai-workspace', module: 'modes' },
  { id: PERMISSIONS.knowledgeDocumentsRead, name: 'Melihat Dokumen Pengetahuan', description: 'Daftar dan detail dokumen pengetahuan', application: 'knowledge-center', module: 'content' },
  { id: PERMISSIONS.knowledgeCollectionsRead, name: 'Melihat Koleksi Pengetahuan', description: 'Koleksi sumber pengetahuan', application: 'knowledge-center', module: 'content' },
  { id: PERMISSIONS.knowledgeCollectionsManage, name: 'Mengelola Koleksi Pengetahuan', description: 'Membuat dan mengubah koleksi sumber pengetahuan', application: 'knowledge-center', module: 'content' },
  { id: PERMISSIONS.knowledgeSearchUse, name: 'Menggunakan Pencarian Pengetahuan', description: 'Mencari di seluruh pengetahuan yang diizinkan', application: 'knowledge-center', module: 'search' },
  { id: PERMISSIONS.agentsView, name: 'Melihat Agen AI', description: 'Katalog agen dan riwayat tugasnya', application: 'agent-center', module: 'catalog' },
  { id: PERMISSIONS.agentsCreate, name: 'Membuat Agen AI', description: 'Mendefinisikan agen AI baru', application: 'agent-center', module: 'definitions' },
  { id: PERMISSIONS.agentsUpdate, name: 'Mengubah Agen AI', description: 'Mengubah definisi dan konfigurasi agen', application: 'agent-center', module: 'definitions' },
  { id: PERMISSIONS.agentsDelete, name: 'Menghapus Agen AI', description: 'Menghapus definisi agen AI', application: 'agent-center', module: 'definitions' },
  { id: PERMISSIONS.agentsExecute, name: 'Menjalankan Tugas Agen', description: 'Menjalankan tugas melalui agen AI', application: 'agent-center', module: 'operations' },
  { id: PERMISSIONS.agentsApprove, name: 'Menyetujui Tindakan Sensitif', description: 'Menyetujui tindakan agen yang bersifat sensitif', application: 'agent-center', module: 'operations' },
  { id: PERMISSIONS.integrationsView, name: 'Melihat Integrasi', description: 'Status koneksi, provider, dan konektor', application: 'integration-center', module: 'connections' },
  { id: PERMISSIONS.integrationsConfigure, name: 'Mengonfigurasi Integrasi', description: 'Kredensial dan konfigurasi integrasi', application: 'integration-center', module: 'credentials' },
  { id: PERMISSIONS.adminAccess, name: 'Akses Aplikasi Administrasi', description: 'Membuka aplikasi Administrasi', application: 'administration', module: 'access' },
  { id: PERMISSIONS.usersRead, name: 'Melihat Pengguna', description: 'Daftar dan detail pengguna', application: 'administration', module: 'access' },
  { id: PERMISSIONS.usersManage, name: 'Mengelola Pengguna', description: 'Membuat, mengubah, menonaktifkan pengguna', application: 'administration', module: 'access' },
  { id: PERMISSIONS.groupsRead, name: 'Melihat Grup', description: 'Daftar dan anggota grup', application: 'administration', module: 'access' },
  { id: PERMISSIONS.groupsManage, name: 'Mengelola Grup', description: 'Membuat, mengubah, mengelola anggota grup', application: 'administration', module: 'access' },
  { id: PERMISSIONS.departmentsRead, name: 'Melihat Departemen', description: 'Struktur departemen', application: 'administration', module: 'access' },
  { id: PERMISSIONS.departmentsManage, name: 'Mengelola Departemen', description: 'Membuat dan mengubah departemen', application: 'administration', module: 'access' },
  { id: PERMISSIONS.rolesRead, name: 'Melihat Peran', description: 'Daftar peran dan permission-nya', application: 'administration', module: 'access' },
  { id: PERMISSIONS.rolesManage, name: 'Mengelola Peran', description: 'Membuat, mengubah peran, dan mengatur permission', application: 'administration', module: 'access' },
  { id: PERMISSIONS.permissionsRead, name: 'Melihat Katalog Permission', description: 'Katalog permission yang tersedia', application: 'administration', module: 'access' },
  { id: PERMISSIONS.permissionsAssign, name: 'Menetapkan Peran', description: 'Menetapkan peran ke pengguna atau grup', application: 'administration', module: 'access' },
  { id: PERMISSIONS.policiesRead, name: 'Melihat Kebijakan', description: 'Kebijakan otorisasi allow/deny', application: 'administration', module: 'access' },
  { id: PERMISSIONS.policiesManage, name: 'Mengelola Kebijakan', description: 'Membuat dan mengubah kebijakan otorisasi', application: 'administration', module: 'access' },
  { id: PERMISSIONS.effectiveInspect, name: 'Memeriksa Permission Efektif', description: 'Permission efektif pengguna beserta alasannya', application: 'administration', module: 'diagnostics' },
  { id: PERMISSIONS.authzTest, name: 'Menguji Keputusan Otorisasi', description: 'Menjalankan pengujian keputusan otorisasi', application: 'administration', module: 'diagnostics' },
  { id: PERMISSIONS.navManage, name: 'Mengelola Navigasi', description: 'Mengelola aplikasi, modul, fitur, dan menu', application: 'administration', module: 'platform' },
  { id: PERMISSIONS.configRead, name: 'Melihat Konfigurasi', description: 'Konfigurasi aplikasi', application: 'administration', module: 'platform' },
  { id: PERMISSIONS.configManage, name: 'Mengelola Konfigurasi', description: 'Mengubah konfigurasi aplikasi', application: 'administration', module: 'platform' },
  { id: PERMISSIONS.sessionsManage, name: 'Mengelola Sesi Pengguna', description: 'Melihat dan mencabut sesi pengguna', application: 'administration', module: 'platform' },
  { id: PERMISSIONS.auditRead, name: 'Membaca Log Audit', description: 'Log audit keamanan dan perubahan', application: 'administration', module: 'diagnostics' },
  { id: PERMISSIONS.providersHealthRead, name: 'Melihat Status Provider AI', description: 'Status kesehatan provider AI terkonfigurasi', application: 'administration', module: 'platform' },
];

export const ALL_PERMISSION_IDS: readonly PermissionId[] = Object.values(PERMISSIONS);

const PERMISSION_ID_SET: ReadonlySet<string> = new Set(ALL_PERMISSION_IDS);

export function isKnownPermissionId(value: string): value is PermissionId {
  return PERMISSION_ID_SET.has(value);
}

/**
 * Pattern matching for grants and policies.
 * A pattern is either a full identifier or a trailing-wildcard prefix such as "knowledge.*".
 * The bare "*" matches everything (superadmin-style grants).
 */
export function matchesPermissionPattern(pattern: string, permission: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('*')) return permission.startsWith(pattern.slice(0, -1));
  return pattern === permission;
}
