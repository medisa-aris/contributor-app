/** Stable role codes for system-seeded roles. */
export const SYSTEM_ROLES = {
  administrator: 'administrator',
  manager: 'manager',
  staf: 'staf',
} as const;

export type SystemRoleCode = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];
