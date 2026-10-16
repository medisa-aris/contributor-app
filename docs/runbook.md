# Runbook — Contributor AI

Panduan operasional harian: menjalankan, memverifikasi, dan memulihkan sistem. Riwayat desain ada di [`architecture.md`](architecture.md); aturan izin di [`rbac.md`](rbac.md).

## 1. Prasyarat

| Hal | Detail |
| --- | --- |
| Node.js | >= 22 (diuji di 24) |
| SSH | `training@192.168.0.62` tanpa password (key-based) |
| Shell | Git Bash (Windows) — semua script `scripts/*.sh` |
| Port lokal | `3000` (API), `5173` (Web) |

> **Host 192.168.0.62 dipakai bersama proyek lain.** Jangan pernah `docker system prune`, menghapus volume, atau menyentuh container di luar proyek compose `contributor-ai`. Postgres/Redis hanya terikat di IP LAN host dan tidak boleh diubah ke `0.0.0.0`.

## 2. Menyalakan Lingkungan Dev

```bash
npm install                 # sekali; menjalankan build packages/shared otomatis (postinstall)
npm run infra:up            # PostgreSQL 16 + Redis 7 di host remote
npm run db:migrate          # terapkan skema (idempoten)
npm run db:seed             # data demo: admin, role, departemen, navigasi (idempoten; mencetak akun demo)
npm run dev                 # shared (watch) + API :3000 + Web :5173
```

Cek cepat: `http://localhost:3000/api/health` → `{"data":{"status":"ok",...}}`; `http://localhost:5173` → halaman masuk.

## 3. Konfigurasi (.env)

| Berkas | Isi | Git |
| --- | --- | --- |
| `infra/.env` | kredensial Postgres/Redis untuk host remote | diabaikan |
| `apps/api/.env` | `DATABASE_URL`, `TEST_DATABASE_URL`, `CORS_ORIGINS`, cookie, `AI_PROVIDER`/`AI_MODEL`/`AI_BASE_URL`, (opsional) `REDIS_URL`, `OPENROUTER_API_KEY` | diabaikan |

Aturan: rahasia **hanya** di `.env` server-side. `OPENROUTER_API_KEY` tidak boleh masuk repo, argumen CLI, log, atau bundle frontend. Template ada di `*.env.example` (placeholder saja).

Konfigurasi runtime non-rahasia (mis. `security.lockout_threshold`, `security.session_absolute_hours`, `app.default_locale`) disimpan di tabel `app_config` dan diubah via UI **Konfigurasi** (`config.manage`).

## 4. Perintah Harian

| Perintah | Fungsi |
| --- | --- |
| `npm run dev` | Semua workspace (shared watch + API + Web) |
| `npm run build` | Build produksi: shared (CJS+ESM) → API → Web |
| `npm test` | API: unit + integration; Web: vitest |
| `npm run db:create-admin` | Bootstrap superadmin produksi (pakai `ADMIN_EMAIL`/`ADMIN_PASSWORD` dari env) |
| `npm run infra:ps` / `logs` | Status / log container remote |
| `npm run infra:backup` | Dump `contributor_ai` → `~/contributor-ai-infra/backup-contributor_ai-<stamp>.sql.gz` di host remote |

**Setelah mengubah `packages/shared`**: jalankan `npm run build -w @contributor/shared` lalu restart dev server web — paket ini dipra-bundle ganda (CJS untuk API, ESM untuk Vite).

## 5. Verifikasi Rilis (checklist)

1. `npm run typecheck` — semua workspace hijau.
2. `npm test` — API 5 suite / 77 test; Web 3 file / 11 test (baseline Fase 1–3).
3. `npm run build` — build produksi lolos.
4. Smoke UI: login superadmin → sidebar memuat seluruh seksi; buka **Permission Efektif** untuk satu pengguna → jumlah keputusan 38; buka **Uji Otorisasi** → jalankan satu kombinasi.
5. Smoke deny: login akun staf → menu administrasi tidak tampil; akses paksa `GET /api/admin/users` dengan sesi staf → `403 AUTHORIZATION_FORBIDDEN`.

## 6. Troubleshooting

| Gejala | Sebab umum | Tindakan |
| --- | --- | --- |
| Login gagal terus (`AUTH_ACCOUNT_LOCKED`) | Lockout rate limit | Tunggu `security.lockout_minutes`, atau bersihkan baris terkait di `login_attempts`; event `auth.login.unlocked_admin` tercatat bila dibuka admin |
| Perubahan izin belum terasa | Cache otorisasi (TTL keputusan 60 dtk; versi 3 dtk) | Tunggu ≤ 3 dtk; bila tetap, pastikan `rbac_meta.version` naik setelah mutasi |
| API gagal start: koneksi DB | Container remote mati / `.env` salah | `npm run infra:ps`, `npm run infra:logs`; uji `psql` via `DATABASE_URL` |
| Web error aneh setelah mengubah shared | Bundle ESM lama | `npm run build -w @contributor/shared` + restart `npm run dev` |
| `EADDRINUSE` 3000/5173 | Proses dev lama | Hentikan proses pemakai port; jangan jalankan dua `npm run dev` |
| 403 yang membingungkan | Melihat pesan, bukan kode | Baca `error.details.missing` pada respons; atau pakai UI **Uji Otorisasi** |
| Sesi bocor/perlu cabut paksa | Karyawan keluar, dsb. | UI **Sesi** → Cabut (event `auth.session.revoked`); semua mutasi tercatat |

## 7. Pemulihan (Restore)

1. Dapatkan dump dari host remote (folder `~/contributor-ai-infra/`).
2. Pulihkan ke DB maintenance:
   ```bash
   gunzip -c backup-contributor_ai-<stamp>.sql.gz | \
     ssh training@192.168.0.62 "docker exec -i contributor-ai-postgres psql -U ca -d contributor_ai"
   ```
3. Setelah restore: `npm run db:migrate` (memastikan skema terbaru) → verifikasi login superadmin → cek **Versi RBAC** di UI Permission Efektif.

## 8. Keamanan Operasional

- Jangan pernah menyalin nilai dari `apps/api/.env` ke tiket, chat, atau log.
- Rotasi kunci `OPENROUTER_API_KEY`: ubah di `.env`, restart API — tidak ada penyimpanan lain.
- Bootstrap superadmin produksi lewat `db:create-admin`; setelah itu ganti kata sandi via UI.
- Semua keputusan tolak tercatat (`security.authorization.denied`, `security.privilege_escalation_blocked`) — pantau lewat Log Audit dengan filter severity `warn`/`critical`.
