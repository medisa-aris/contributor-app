import type { ScopeMode } from '../../rbac/effective-permissions.service';

export interface ScopeFilter {
  mode: ScopeMode;
  userId: string;
  departmentIds: string[];
}

/**
 * SQL predicate fragment restricting `column` to the rows the viewer may read.
 * Params are appended to the supplied array; empty string means "no restriction".
 */
export function scopeClause(scope: ScopeFilter, column: string, params: unknown[]): string {
  if (scope.mode === 'all') return '';
  if (scope.mode === 'departments') {
    params.push(scope.departmentIds);
    return `${column} = ANY($${params.length}::uuid[])`;
  }
  if (scope.mode === 'own') {
    params.push(scope.userId);
    return `${column} = $${params.length}::uuid`;
  }
  return 'false';
}
