export const DATA_SCOPES = ['global', 'department', 'own'] as const;
export type DataScope = (typeof DATA_SCOPES)[number];

export const POLICY_EFFECTS = ['allow', 'deny'] as const;
export type PolicyEffect = (typeof POLICY_EFFECTS)[number];

export const POLICY_SUBJECT_TYPES = ['user', 'group', 'role'] as const;
export type PolicySubjectType = (typeof POLICY_SUBJECT_TYPES)[number];

export const USER_STATUSES = ['active', 'disabled'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const AUDIT_SEVERITIES = ['info', 'warn', 'critical'] as const;
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number];

export const THEMES = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof THEMES)[number];

export const DATA_SCOPE_REACH: Record<DataScope, number> = {
  global: 3,
  department: 2,
  own: 1,
};
