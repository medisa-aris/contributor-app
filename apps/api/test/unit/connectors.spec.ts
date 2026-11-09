import { capAccess, mergeGrants } from '../../src/modules/connectors/connector-access.service';
import { asData, toolPrefix } from '../../src/modules/connectors/connector-tools.service';
import {
  classifySql,
  maskSql,
  referencedTables,
  tablesAllowed,
} from '../../src/modules/connectors/sql-guard';

describe('classifySql', () => {
  it.each([
    ['SELECT * FROM incidents', 'read'],
    ['  select count(*) from incidents;  ', 'read'],
    ['WITH x AS (SELECT 1) SELECT * FROM x', 'read'],
    ['SHOW TABLES', 'read'],
    ['EXPLAIN SELECT * FROM t', 'read'],
    ['(SELECT 1) UNION (SELECT 2)', 'read'],
    ["SELECT 'DELETE FROM t' AS teks FROM t", 'read'],
    ['SELECT 1 -- ; DROP TABLE t', 'read'],
    ['UPDATE incidents SET status = 1 WHERE id = 2', 'write'],
    ['INSERT INTO t (a) VALUES (1)', 'write'],
    ['DELETE FROM t WHERE id = 1', 'write'],
    ['MERGE INTO t USING s ON (t.id = s.id) WHEN MATCHED THEN UPDATE SET a = 1', 'write'],
    ['WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d', 'write'],
    ['SELECT * INTO backup FROM t', 'write'],
    ['SELECT * FROM t FOR UPDATE', 'write'],
    ['EXPLAIN ANALYZE DELETE FROM t', 'write'],
  ])('%s → %s', (sql, kind) => {
    expect(classifySql(sql).kind).toBe(kind);
  });

  it.each([
    'SELECT 1; DROP TABLE t',
    'DROP TABLE incidents',
    'TRUNCATE incidents',
    'ALTER TABLE t ADD c int',
    'GRANT ALL ON t TO x',
    'EXEC sp_who',
    'CALL do_something()',
    'SET search_path = x',
    "COPY t TO PROGRAM 'rm -rf'",
    'UPDATE t SET a = 1; DELETE FROM t',
    '',
  ])('memblokir: %s', (sql) => {
    expect(classifySql(sql).kind).toBe('blocked');
  });

  it('titik koma di dalam literal tidak dianggap pemisah statement', () => {
    expect(classifySql("SELECT ';' AS sep, 'it''s' AS x FROM t").kind).toBe('read');
  });

  it('dollar-quoting postgres dimasker', () => {
    expect(maskSql('SELECT $$a;b$$')).not.toContain(';');
  });

  it('membuang titik koma penutup dari statement', () => {
    expect(classifySql('SELECT 1;').statement).toBe('SELECT 1');
  });
});

describe('referencedTables dan allowlist', () => {
  it('mendeteksi tabel di FROM/JOIN/UPDATE/INTO dan mengabaikan CTE', () => {
    const sql = `WITH recent AS (SELECT * FROM hse.incidents)
      SELECT * FROM recent r JOIN "Sites" s ON s.id = r.site_id LEFT JOIN hse.findings f ON 1=1`;
    expect(referencedTables(sql).sort()).toEqual(['hse.findings', 'hse.incidents', 'sites']);
    expect(referencedTables('UPDATE incidents SET a = 1')).toEqual(['incidents']);
    expect(referencedTables('INSERT INTO audit_log (a) VALUES (1)')).toEqual(['audit_log']);
  });

  it('allowlist kosong mengizinkan semua; selain itu semua tabel harus terdaftar', () => {
    expect(tablesAllowed('SELECT * FROM a JOIN b ON 1=1', null).ok).toBe(true);
    expect(tablesAllowed('SELECT * FROM hse.incidents', ['incidents']).ok).toBe(true);
    const denied = tablesAllowed('SELECT * FROM incidents JOIN salaries ON 1=1', ['incidents']);
    expect(denied).toEqual({ ok: false, denied: ['salaries'] });
  });
});

describe('mergeGrants', () => {
  it('akses tertinggi menang dan allowlist digabung', () => {
    const merged = mergeGrants([
      { connector_type: 'database', connector_id: 'c1', access: 'read', table_allowlist: ['a'] },
      {
        connector_type: 'database',
        connector_id: 'c1',
        access: 'read_write',
        table_allowlist: ['b'],
      },
      { connector_type: 'mcp', connector_id: 'm1', access: 'read', table_allowlist: null },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual({
      connectorType: 'database',
      connectorId: 'c1',
      access: 'read_write',
      tableAllowlist: ['a', 'b'],
    });
  });

  it('satu grant tanpa allowlist membuka semua tabel', () => {
    const merged = mergeGrants([
      { connector_type: 'database', connector_id: 'c1', access: 'read', table_allowlist: ['a'] },
      { connector_type: 'database', connector_id: 'c1', access: 'read', table_allowlist: [] },
    ]);
    expect(merged[0]!.tableAllowlist).toBeNull();
  });

  it('capAccess tidak pernah melebihi grant', () => {
    expect(capAccess('read_write', 'read')).toBe('read');
    expect(capAccess('read', 'read_write')).toBe('read');
    expect(capAccess('read_write', 'read_write')).toBe('read_write');
  });
});

describe('utilitas tool', () => {
  it('toolPrefix menghasilkan nama aman', () => {
    expect(toolPrefix('database', 'hse-demo')).toBe('db_hse_demo');
    expect(toolPrefix('mcp', 'PTBC HSE Data!')).toBe('mcp_ptbc_hse_data');
  });

  it('asData membungkus hasil sebagai data', () => {
    expect(asData('x', { a: 1 })).toContain('bukan instruksi');
  });
});
