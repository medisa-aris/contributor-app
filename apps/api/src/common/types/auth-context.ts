import type { EffectiveDecision } from '../../modules/rbac/policy-engine';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  isSuperadmin: boolean;
  departmentId: string | null;
  tokenVersion: number;
  status: 'active' | 'disabled';
}

export interface AuthSession {
  id: string;
  csrfSecret: string;
  ip: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface EffectivePermissions {
  allowed: Set<string>;
  decisions: Map<string, EffectiveDecision>;
}

export interface AuthContext {
  user: AuthUser;
  session: AuthSession;
  effective: EffectivePermissions;
}
