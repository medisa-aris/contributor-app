export type AdminDataScope = 'global' | 'department' | 'own';
export type AdminUserStatus = 'active' | 'disabled';
export type PolicyEffect = 'allow' | 'deny';
export type PolicySubjectType = 'user' | 'group' | 'role';
export type NavLevel = 'application' | 'module' | 'feature' | 'menu_item';

export type AdminUserRow = {
  id: string;
  email: string;
  display_name: string;
  is_superadmin: boolean;
  status: AdminUserStatus;
  department_id: string | null;
  department_name: string | null;
  last_login_at: string | null;
  created_at: string;
};

export type AdminRoleAssignment = {
  id: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  dataScope: AdminDataScope;
  departmentId: string | null;
  source: 'user' | 'group';
  groupName: string | null;
};

export type AdminUserDetail = AdminUserRow & {
  assignments: AdminRoleAssignment[];
  groups: { id: string; code: string; name: string }[];
};

export type AdminRoleRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_system: boolean;
  created_at: string;
  permission_count: number;
  assignment_count: number;
};

export type AdminGroupRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  created_at: string;
  member_count: number;
  role_count: number;
};

export type AdminGroupMember = {
  id: string;
  email: string;
  display_name: string;
  status: AdminUserStatus;
  department_id: string | null;
  department_name: string | null;
};

export type AdminGroupRole = {
  id: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  dataScope: AdminDataScope;
  departmentId: string | null;
};

export type AdminGroupDetail = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  created_at: string;
  members: AdminGroupMember[];
  roles: AdminGroupRole[];
};

export type AdminDepartmentNode = {
  id: string;
  name: string;
  code: string;
  parent_id: string | null;
  user_count: number;
  users: AdminDepartmentUser[];
  children: AdminDepartmentNode[];
};

export type AdminDepartmentUser = {
  id: string;
  display_name: string;
  email: string;
  job_title: string | null;
  status: string;
};

export type AdminPolicyRow = {
  id: string;
  name: string;
  effect: PolicyEffect;
  subject_type: PolicySubjectType;
  subject_id: string;
  subject_label: string | null;
  permission_pattern: string;
  resource_type: string | null;
  resource_id: string | null;
  priority: number;
  conditions: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type AdminPermissionRow = {
  id: string;
  identifier: string;
  name: string;
  description: string | null;
  is_system: boolean;
  role_count: number;
};

export type EffectiveChainEntry = {
  kind: string;
  label: string;
  effect: 'allow' | 'deny' | 'info';
  detail: string;
};

export type EffectiveDecision = {
  permission: string;
  allowed: boolean;
  reason: string;
  scope: AdminDataScope | null;
  chain: EffectiveChainEntry[];
};

export type EffectivePermissionsResponse = {
  user: {
    id: string;
    email: string;
    display_name: string;
    status: AdminUserStatus;
    is_superadmin: boolean;
    department_id: string | null;
  };
  isSuperadmin: boolean;
  rbacVersion: number;
  assignments: Array<{
    roleCode: string;
    roleName: string;
    dataScope: AdminDataScope;
    departmentId: string | null;
    source: 'user' | 'group';
  }>;
  decisions: EffectiveDecision[];
};

export type AuthzTestResponse = {
  allowed: boolean;
  reason: string;
  scope: AdminDataScope | null;
  chain: EffectiveChainEntry[];
};

export type AdminAuditRow = {
  id: string;
  occurred_at: string;
  severity: string;
  event_key: string;
  summary: string;
  actor_user_id: string | null;
  actor_label: string | null;
  actor_ip: string | null;
  request_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  payload: Record<string, unknown>;
};

export type AdminSessionRow = {
  id: string;
  user_id: string;
  email: string;
  display_name: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
};

export type AdminConfigEntry = {
  key: string;
  value: unknown;
  description: string | null;
  is_public: boolean;
  updated_at: string;
  updated_by: string | null;
};

export type AdminProviderStatus = {
  name: string;
  configured: boolean;
  model: string | null;
  baseUrl: string | null;
  isDefault: boolean;
};

export type AdminProvidersOverview = {
  defaultProvider: string;
  providers: AdminProviderStatus[];
};

export type AdminNavApplication = {
  id: string;
  identifier: string;
  name: string;
  icon: string | null;
  description: string | null;
  sort_order: number;
  is_active: boolean;
};

export type AdminNavModule = {
  id: string;
  application_id: string;
  parent_id: string | null;
  identifier: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
};

export type AdminNavFeature = {
  id: string;
  module_id: string;
  identifier: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
};

export type AdminNavMenuItem = {
  id: string;
  key: string;
  application_id: string;
  module_id: string | null;
  feature_id: string | null;
  parent_id: string | null;
  label_default: string;
  i18n_key: string | null;
  icon: string | null;
  route_path: string | null;
  required_permission: string | null;
  sort_order: number;
  is_active: boolean;
  is_future: boolean;
};

export type AdminNavTree = {
  applications: AdminNavApplication[];
  modules: AdminNavModule[];
  features: AdminNavFeature[];
  menuItems: AdminNavMenuItem[];
};
