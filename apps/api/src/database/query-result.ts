/**
 * Normalizes a raw dataSource.query() result into the ROWS array.
 *
 * TypeORM's Postgres driver returns [rows, affectedCount] for UPDATE/DELETE
 * statements, while SELECT and INSERT ... RETURNING return a plain rows array.
 * Reading the raw result directly (e.g. rows.length) silently treats the
 * two-element wrapper as data - always route mutations through this helper.
 */
export function updatedRows<T>(result: unknown): T[] {
  if (
    Array.isArray(result) &&
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === 'number'
  ) {
    return result[0] as T[];
  }
  return Array.isArray(result) ? (result as T[]) : [];
}
