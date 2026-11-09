import { Client } from 'pg';
import type { DataSource } from 'typeorm';
import { encryptSecret, loadEncryptionKey } from '../../common/utils/secret-box';

/**
 * Database contoh `hse_demo` (fiktif) untuk mencoba konektor database:
 * lokasi kerja, insiden, inspeksi, dan temuan K3. Akun `hse_agent` dipakai konektor:
 * boleh SELECT semua tabel, dan INSERT/UPDATE pada `findings` untuk demo persetujuan tulis.
 *
 * Hanya untuk lingkungan lokal/demo; dilewati di production.
 */

const DEMO_DB = 'hse_demo';
const DEMO_ROLE = 'hse_agent';
const CONNECTOR_CODE = 'hse-demo';

const SITES = [
  ['PIT-A', 'Pit A Utara', 'Penambangan'],
  ['PIT-B', 'Pit B Selatan', 'Penambangan'],
  ['HAUL-12', 'Hauling Road KM 12', 'Pengangkutan'],
  ['PORT', 'Pelabuhan Batubara', 'Pelabuhan'],
  ['WS', 'Workshop Pusat', 'Perawatan'],
  ['ROM', 'Stockpile ROM', 'Pengolahan'],
] as const;

const CATEGORIES = [
  ['Near Miss', 1],
  ['First Aid', 2],
  ['Property Damage', 2],
  ['Environmental', 3],
  ['Medical Treatment', 3],
  ['Lost Time Injury', 4],
] as const;

const DESCRIPTIONS: Record<string, string[]> = {
  'Near Miss': [
    'Dump truck hampir bersenggolan dengan LV di persimpangan',
    'Batu jatuh dari highwall di dekat area kerja excavator',
    'Operator dozer tidak memakai sabuk pengaman saat manuver',
  ],
  'First Aid': ['Mekanik tergores saat mengganti filter', 'Pekerja terkilir saat turun dari unit'],
  'Property Damage': ['Spion dump truck patah menabrak rambu', 'Ban LV pecah terkena batu tajam'],
  Environmental: [
    'Tumpahan oli hidrolik ± 20 liter di area parkir unit',
    'Air limpasan keruh keluar dari settling pond',
  ],
  'Medical Treatment': ['Pekerja terkena serpihan logam di mata saat menggerinda'],
  'Lost Time Injury': ['Jari tangan terjepit saat pemasangan track link'],
};

const INSPECTION_TYPES = [
  'Inspeksi Rutin',
  'Audit K3',
  'Inspeksi Alat Berat',
  'Inspeksi Lingkungan',
];
const FINDINGS = [
  ['APAR kedaluwarsa di pos jaga', 'Sedang'],
  ['Rambu batas kecepatan tidak terbaca', 'Rendah'],
  ['Tanggul jalan angkut kurang dari setengah tinggi roda', 'Tinggi'],
  ['Kebocoran oli pada unit excavator', 'Sedang'],
  ['Housekeeping area workshop buruk', 'Rendah'],
  ['Retakan pada dinding highwall belum dipasang pemantauan', 'Kritis'],
  ['Kotak P3K tidak lengkap', 'Rendah'],
  ['Drainase pit tersumbat sedimen', 'Tinggi'],
] as const;
const PEOPLE = [
  'Dimas Saputra',
  'Siti Rahmawati',
  'Fajar Nugroho',
  'Maria Lestari',
  'Bambang Wicaksono',
];

/** Pseudo-random deterministik agar seed selalu menghasilkan data yang sama. */
function rng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!;
}

export interface HseDemoDbResult {
  created: boolean;
  connectorId: string | null;
  skippedReason?: string;
}

export async function seedHseDemoDatabase(ds: DataSource): Promise<HseDemoDbResult> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl)
    return { created: false, connectorId: null, skippedReason: 'DATABASE_URL kosong' };
  const password = process.env.HSE_DEMO_DB_PASSWORD || 'HseAgent-Demo-2026';
  const url = new URL(databaseUrl);

  // 1. Buat database bila belum ada.
  const admin = new Client({ connectionString: databaseUrl });
  await admin.connect();
  let created = false;
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [DEMO_DB]);
    if (exists.rowCount === 0) {
      await admin.query(`CREATE DATABASE ${DEMO_DB}`);
      created = true;
    }
    const role = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [DEMO_ROLE]);
    const escaped = password.replace(/'/g, "''");
    await admin.query(
      role.rowCount === 0
        ? `CREATE ROLE ${DEMO_ROLE} LOGIN PASSWORD '${escaped}'`
        : `ALTER ROLE ${DEMO_ROLE} LOGIN PASSWORD '${escaped}'`,
    );
  } catch (error) {
    await admin.end();
    return {
      created: false,
      connectorId: null,
      skippedReason: `Tidak dapat membuat database demo: ${String(error)}`,
    };
  }
  await admin.end();

  // 2. Skema dan data contoh.
  const demoUrl = new URL(databaseUrl);
  demoUrl.pathname = `/${DEMO_DB}`;
  const db = new Client({ connectionString: demoUrl.toString() });
  await db.connect();
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS sites (
        id serial PRIMARY KEY, code varchar(20) UNIQUE NOT NULL, name varchar(100) NOT NULL, area varchar(50) NOT NULL);
      CREATE TABLE IF NOT EXISTS incidents (
        id serial PRIMARY KEY, incident_no varchar(20) UNIQUE NOT NULL, occurred_at timestamptz NOT NULL,
        site_id int NOT NULL REFERENCES sites(id), category varchar(40) NOT NULL, severity smallint NOT NULL,
        description text NOT NULL, status varchar(20) NOT NULL, reported_by varchar(100) NOT NULL);
      CREATE TABLE IF NOT EXISTS inspections (
        id serial PRIMARY KEY, inspection_no varchar(20) UNIQUE NOT NULL, inspected_at date NOT NULL,
        site_id int NOT NULL REFERENCES sites(id), type varchar(40) NOT NULL, score numeric(5,1) NOT NULL,
        inspector varchar(100) NOT NULL);
      CREATE TABLE IF NOT EXISTS findings (
        id serial PRIMARY KEY, inspection_id int NOT NULL REFERENCES inspections(id), description text NOT NULL,
        risk_level varchar(10) NOT NULL, pic varchar(100) NOT NULL, due_date date NOT NULL,
        status varchar(20) NOT NULL, closed_at timestamptz);
      COMMENT ON TABLE incidents IS 'Laporan insiden K3 (fiktif, data demo)';
      COMMENT ON TABLE findings IS 'Temuan inspeksi dan tindak lanjutnya (fiktif, data demo)';
    `);
    const count = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM incidents');
    if ((count.rows[0]?.n ?? 0) === 0) {
      const random = rng(20261108);
      for (const [code, name, area] of SITES) {
        await db.query(
          'INSERT INTO sites (code, name, area) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [code, name, area],
        );
      }
      const siteIds = (await db.query<{ id: number }>('SELECT id FROM sites ORDER BY id')).rows.map(
        (r) => r.id,
      );
      for (let i = 1; i <= 72; i += 1) {
        const [category, baseSeverity] = pick(random, CATEGORIES);
        const daysAgo = Math.floor(random() * 180);
        const status =
          daysAgo < 14
            ? pick(random, ['Open', 'Investigasi'])
            : random() < 0.9
              ? 'Closed'
              : 'Investigasi';
        await db.query(
          `INSERT INTO incidents (incident_no, occurred_at, site_id, category, severity, description, status, reported_by)
           VALUES ($1, now() - ($2 || ' days')::interval - ($3 || ' hours')::interval, $4, $5, $6, $7, $8, $9)`,
          [
            `INC-${String(i).padStart(4, '0')}`,
            daysAgo,
            Math.floor(random() * 12),
            pick(random, siteIds),
            category,
            Math.min(5, baseSeverity + (random() < 0.2 ? 1 : 0)),
            pick(random, DESCRIPTIONS[category]!),
            status,
            pick(random, PEOPLE),
          ],
        );
      }
      for (let i = 1; i <= 36; i += 1) {
        const daysAgo = Math.floor(random() * 180);
        const inspection = await db.query<{ id: number }>(
          `INSERT INTO inspections (inspection_no, inspected_at, site_id, type, score, inspector)
           VALUES ($1, current_date - $2::int, $3, $4, $5, $6) RETURNING id`,
          [
            `INS-${String(i).padStart(4, '0')}`,
            daysAgo,
            pick(random, siteIds),
            pick(random, INSPECTION_TYPES),
            Math.round((70 + random() * 28) * 10) / 10,
            pick(random, PEOPLE),
          ],
        );
        const findingCount = 1 + Math.floor(random() * 3);
        for (let f = 0; f < findingCount; f += 1) {
          const [description, risk] = pick(random, FINDINGS);
          const due = daysAgo - (risk === 'Kritis' ? 3 : risk === 'Tinggi' ? 7 : 14);
          const closed = due > 5 && random() < 0.75;
          await db.query(
            `INSERT INTO findings (inspection_id, description, risk_level, pic, due_date, status, closed_at)
             VALUES ($1, $2, $3, $4, current_date - $5::int, $6, CASE WHEN $7 THEN now() - ($5 || ' days')::interval END)`,
            [
              inspection.rows[0]!.id,
              description,
              risk,
              pick(random, PEOPLE),
              due,
              closed ? 'Closed' : due < 0 ? 'Open' : 'In Progress',
              closed,
            ],
          );
        }
      }
    }
    await db.query(`
      GRANT CONNECT ON DATABASE ${DEMO_DB} TO ${DEMO_ROLE};
      GRANT USAGE ON SCHEMA public TO ${DEMO_ROLE};
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${DEMO_ROLE};
      GRANT INSERT, UPDATE ON findings TO ${DEMO_ROLE};
      GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${DEMO_ROLE};
    `);
  } finally {
    await db.end();
  }

  // 3. Daftarkan konektor dan beri akses ke departemen HSE (beserta sub-departemennya).
  const key = loadEncryptionKey(process.env.INTEGRATIONS_ENCRYPTION_KEY);
  if (!key) {
    return {
      created,
      connectorId: null,
      skippedReason: 'INTEGRATIONS_ENCRYPTION_KEY belum diatur; konektor tidak didaftarkan',
    };
  }
  const existing = (await ds.query(`SELECT id FROM db_connectors WHERE code = $1`, [
    CONNECTOR_CODE,
  ])) as { id: string }[];
  let connectorId = existing[0]?.id ?? null;
  if (!connectorId) {
    const rows = (await ds.query(
      `INSERT INTO db_connectors
         (code, name, description, engine, host, port, database_name, username, password_enc, options, allow_write, row_limit)
       VALUES ($1, 'HSE Demo (PostgreSQL)', $2, 'postgres', $3, $4, $5, $6, $7, '{"schema":"public"}', true, 200)
       RETURNING id`,
      [
        CONNECTOR_CODE,
        'Database contoh K3: sites, incidents, inspections, findings (data fiktif). Tulis hanya pada tabel findings.',
        url.hostname,
        Number(url.port || 5432),
        DEMO_DB,
        DEMO_ROLE,
        encryptSecret(password, key),
      ],
    )) as { id: string }[];
    connectorId = rows[0]!.id;
  }
  await ds.query(
    `INSERT INTO connector_grants (connector_type, connector_id, subject_type, subject_id, access)
     SELECT 'database', $1, 'department', d.id, 'read_write' FROM departments d WHERE d.code = 'HSE'
     ON CONFLICT ON CONSTRAINT uq_connector_grant DO NOTHING`,
    [connectorId],
  );
  return { created, connectorId };
}
