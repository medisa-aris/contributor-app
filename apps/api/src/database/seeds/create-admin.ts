import { AUDIT_EVENTS, SYSTEM_ROLES } from '@contributor/shared';
import { hash } from 'bcryptjs';
import { isEmail } from 'class-validator';
import { config as loadEnv } from 'dotenv';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../data-source-options';
import { updatedRows } from '../query-result';

loadEnv({ path: join(__dirname, '../../../.env') });

const BCRYPT_ROUNDS = 11;

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (apps/api/.env)');

  const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? '';
  const displayName = (process.env.ADMIN_NAME ?? 'Super Admin').trim();

  if (!email || !isEmail(email)) {
    throw new Error('ADMIN_EMAIL belum diisi atau tidak valid');
  }
  if (password.length < 10) {
    throw new Error('ADMIN_PASSWORD minimal 10 karakter');
  }

  const ds = new DataSource(buildDataSourceOptions(url));
  await ds.initialize();
  try {
    const roleRows = (await ds.query(
      `SELECT id FROM roles WHERE code = $1`,
      [SYSTEM_ROLES.administrator],
    )) as { id: string }[];
    const adminRoleId = roleRows[0]?.id;
    if (!adminRoleId) {
      throw new Error('Peran administrator belum ada - jalankan `npm run seed` terlebih dahulu');
    }

    const passwordHash = await hash(password, BCRYPT_ROUNDS);
    const existing = (await ds.query(
      `SELECT id FROM users WHERE lower(email) = lower($1)`,
      [email],
    )) as { id: string }[];

    let userId: string;
    let created: boolean;
    if (existing[0]?.id) {
      const updated = updatedRows<{ id: string }>(
        await ds.query(
          `UPDATE users
              SET password_hash = $2, display_name = $3, status = 'active', is_superadmin = true,
                  token_version = token_version + 1, failed_login_count = 0, locked_until = NULL,
                  updated_at = now()
            WHERE id = $1
            RETURNING id`,
          [existing[0].id, passwordHash, displayName],
        ),
      );
      userId = updated[0]?.id ?? existing[0].id;
      created = false;
    } else {
      const inserted = (await ds.query(
        `INSERT INTO users (email, password_hash, display_name, status, is_superadmin)
         VALUES ($1, $2, $3, 'active', true)
         RETURNING id`,
        [email, passwordHash, displayName],
      )) as { id: string }[];
      const id = inserted[0]?.id;
      if (!id) throw new Error('Gagal membuat pengguna admin');
      userId = id;
      created = true;
    }

    await ds.query(
      `INSERT INTO user_roles (user_id, role_id, data_scope, department_id)
       VALUES ($1, $2, 'global', NULL)
       ON CONFLICT ON CONSTRAINT uq_user_roles DO NOTHING`,
      [userId, adminRoleId],
    );

    await ds.query(`INSERT INTO rbac_meta (id, version) VALUES (1, 1) ON CONFLICT (id) DO NOTHING`);
    await ds.query(`UPDATE rbac_meta SET version = version + 1, updated_at = now() WHERE id = 1`);

    await ds.query(
      `INSERT INTO audit_events (severity, event_key, summary, actor_label, entity_type, entity_id, payload)
       VALUES ('info', $1, $2, 'bootstrap', 'user', $3, $4::jsonb)`,
      [
        AUDIT_EVENTS.systemBootstrapAdminCreated,
        created
          ? `Admin bootstrap dibuat: ${email}`
          : `Admin bootstrap diperbarui: ${email}`,
        userId,
        JSON.stringify({ email, created, isSuperadmin: true, role: SYSTEM_ROLES.administrator }),
      ],
    );

    console.log(`Admin ${created ? 'dibuat' : 'diperbarui'}: ${email}`);
    console.log(`  ID: ${userId}`);
    console.log('  Peran: administrator (scope global), is_superadmin: true');
  } finally {
    await ds.destroy();
  }
}

main().catch((err: Error) => {
  console.error(`create-admin gagal: ${err.message}`);
  process.exit(1);
});
