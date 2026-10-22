# Runbook — BeLead AI

Panduan operasional harian: menjalankan, memverifikasi, dan memulihkan sistem. Riwayat desain ada di [`architecture.md`](architecture.md); aturan izin di [`rbac.md`](rbac.md).

## 1. Prasyarat

| Hal        | Detail                                             |
| ---------- | -------------------------------------------------- |
| Node.js    | >= 22 (diuji di 24)                                |
| SSH        | `training@192.168.0.62` tanpa password (key-based) |
| Shell      | Git Bash (Windows) — semua script `scripts/*.sh`   |
| Port lokal | `3000` (API), `5173` (Web)                         |

> **Host 192.168.0.62 dipakai bersama proyek lain.** Jangan pernah `docker system prune`, menghapus volume, atau menyentuh container di luar proyek compose `contributor-ai`. Postgres/Redis hanya terikat di IP LAN host dan tidak boleh diubah ke `0.0.0.0`.

## 2. Menyalakan Lingkungan Dev

```bash
npm install                 # sekali; menjalankan build packages/shared otomatis (postinstall)
npm run infra:up            # PostgreSQL 16 + Redis 7 di host remote
npm run db:migrate          # terapkan skema (idempoten)
npm run db:seed             # data demo: peran, izin, navigasi, departemen, konten tiga pusat,
                            # dan 10 akun demo (admin/manajer/staf + 7 tim HSE K3L) beserta 35 percakapan contoh (idempoten; dilewati otomatis
                            # saat NODE_ENV=production; mencetak kredensial akun demo)
npm run dev                 # shared (watch) + API :3000 + Web :5173
```

Cek cepat: `http://localhost:3000/api/health` → `{"data":{"status":"ok",...}}`; `http://localhost:5173` → halaman masuk.

## 3. Konfigurasi (.env)

| Berkas          | Isi                                                                                                                                               | Git       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `infra/.env`    | kredensial Postgres/Redis untuk host remote                                                                                                       | diabaikan |
| `apps/api/.env` | `DATABASE_URL`, `TEST_DATABASE_URL`, `CORS_ORIGINS`, cookie, `AI_PROVIDER`/`AI_MODEL`/`AI_BASE_URL`, (opsional) `REDIS_URL`, `OPENROUTER_API_KEY` | diabaikan |

Aturan: rahasia **hanya** di `.env` server-side. `OPENROUTER_API_KEY` tidak boleh masuk repo, argumen CLI, log, atau bundle frontend. Template ada di `*.env.example` (placeholder saja).

Konfigurasi runtime non-rahasia (mis. `security.lockout_threshold`, `security.session_absolute_hours`, `app.default_locale`) disimpan di tabel `app_config` dan diubah via UI **Konfigurasi** (`config.manage`).

## 4. Perintah Harian

| Perintah                    | Fungsi                                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| `npm run dev`               | Semua workspace (shared watch + API + Web)                                                           |
| `npm run build`             | Build produksi: shared (CJS+ESM) → API → Web                                                         |
| `npm test`                  | API: unit + integration; Web: vitest                                                                 |
| `npm run db:create-admin`   | Bootstrap superadmin produksi (pakai `ADMIN_EMAIL`/`ADMIN_PASSWORD` dari env)                        |
| `npm run infra:ps` / `logs` | Status / log container remote                                                                        |
| `npm run infra:backup`      | Dump `contributor_ai` → `~/contributor-ai-infra/backup-contributor_ai-<stamp>.sql.gz` di host remote |

**Setelah mengubah `packages/shared`**: jalankan `npm run build -w @bara/shared` lalu restart dev server web — paket ini dipra-bundle ganda (CJS untuk API, ESM untuk Vite).

## 5. Verifikasi Rilis (checklist)

1. `npm run typecheck` — semua workspace hijau.
2. `npm test` — baseline Fase 1–6: API 39 unit + 7 suite integrasi / 114 test; Web 3 file / 11 test.
3. `npm run build` — build produksi lolos.
4. Smoke UI: login superadmin → sidebar memuat seluruh seksi; buka **Permission Efektif** untuk satu pengguna; buka **Uji Otorisasi** → jalankan satu kombinasi.
5. Smoke deny: login akun staf → menu administrasi dan mode AI tidak tampil; akses paksa `GET /api/admin/users` dengan sesi staf → `403 AUTHORIZATION_FORBIDDEN`.
6. Smoke AI Workspace (login akun dengan tiga izin mode, mis. manajer):
   - **Otak Kedua**: kirim satu pertanyaan → jawaban streaming tuntas dan tersimpan.
   - **Subordinate**: buat tugas → **Jalankan** → status bergerak `Dibuat → Selesai`, dialog Detail menampilkan hasil + jejak eksekusi (created/validating/running/completed, token, durasi, model).
   - **Riwayat Percakapan** (butuh `ai.workspace.history.read`): kedua tab memuat data milik-sendiri; hapus satu percakapan → baris hilang.
7. Smoke isolasi: percakapan yang dibuat manajer tidak tampil di riwayat admin (dan sebaliknya).
8. Smoke Knowledge Center:
   - **Dokumen**: filter judul bekerja (masukkan kata dari judul seed, mis. `FAQ` → baris tersaring); unggah dokumen baru sebagai admin → status `Menunggu` lalu `Terindeks` (proses indeks berjalan sinkron saat unggah).
   - **Pencarian Pengetahuan**: cari `santunan klaim` → ≥ 2 hasil terurut dengan cuplikan bercetak tebal dan sitasi `Lokasi:`; filter koleksi `Proses Klaim Asuransi` mempersempit hasil.
   - Login staf: **Dokumen** terbaca tanpa tombol unggah/hapus; **Pencarian** berfungsi penuh.
9. Smoke Agent Center:
   - Jalankan agen `requires_approval` → status `Menunggu persetujuan`; login admin → **Persetujuan** → Setujui dengan catatan → tugas berjalan sampai `Selesai` di log **Jalankan Tugas**.
   - Login staf: **Katalog Agen** terbuka tanpa tombol _Jalankan_; akses langsung `/agents/operations`, `/agents/approvals`, `/integrations` → dialihkan ke beranda dengan pemberitahuan izin.
10. Smoke Integration Center: **Koneksi & Status** → **Periksa kesehatan** pada server MCP demo → lencana `Sehat` + stempel waktu; **Kredensial** hanya menampilkan status boolean (`Terkonfigurasi`/`Belum diisi`), bukan nilai.

## 6. Troubleshooting

| Gejala                                                     | Sebab umum                                               | Tindakan                                                                                                                                                                            |
| ---------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login gagal terus (`AUTH_ACCOUNT_LOCKED`)                  | Lockout rate limit                                       | Tunggu `security.lockout_minutes`, atau bersihkan baris terkait di `login_attempts`; event `auth.login.unlocked_admin` tercatat bila dibuka admin                                   |
| Perubahan izin belum terasa                                | Cache otorisasi (TTL keputusan 60 dtk; versi 3 dtk)      | Tunggu ≤ 3 dtk; bila tetap, pastikan `rbac_meta.version` naik setelah mutasi                                                                                                        |
| API gagal start: koneksi DB                                | Container remote mati / `.env` salah                     | `npm run infra:ps`, `npm run infra:logs`; uji `psql` via `DATABASE_URL`                                                                                                             |
| Web error aneh setelah mengubah shared                     | Bundle ESM lama                                          | `npm run build -w @bara/shared` + restart `npm run dev`                                                                                                                      |
| `EADDRINUSE` 3000/5173                                     | Proses dev lama                                          | Hentikan proses pemakai port; jangan jalankan dua `npm run dev`                                                                                                                     |
| 403 yang membingungkan                                     | Melihat pesan, bukan kode                                | Baca `error.details.missing` pada respons; atau pakai UI **Uji Otorisasi**                                                                                                          |
| Sesi bocor/perlu cabut paksa                               | Karyawan keluar, dsb.                                    | UI **Sesi** → Cabut (event `auth.session.revoked`); semua mutasi tercatat                                                                                                           |
| Chat/stream error atau jawaban kosong                      | Model salah ID / provider down / kunci tidak valid       | Lihat baris `Penyedia AI aktif: …` di log API; pastikan `AI_MODEL` adalah ID valid penyedia (mis. `google/gemini-3.1-flash-lite` untuk OpenRouter); uji kunci lewat dasbor penyedia |
| Tugas Subordinate berstatus `Gagal`                        | Instruksi menolak validasi, timeout, atau error upstream | Buka dialog **Detail** → baca `error_message` dan jejak `ai_task_events`; perbaiki instruksi lalu **Jalankan** ulang (status `failed` boleh dijalankan lagi)                        |
| Halaman tugas/riwayat menampilkan 0 baris padahal data ada | Konvensi respons list berubah                            | Endpoint AI memakai `paginated()` (`{data, meta}`) — klien web membaca `data` sebagai array dan `meta.total`                                                                        |
| Pencarian pengetahuan kosong padahal dokumen ada           | Indeks FTS belum terbentuk / query tak cocok             | Pastikan dokumen berstatus `indexed` (kolom `content_tsv` terisi); uji langsung di DB dengan `to_tsvector('indonesian', …)`; ingat filter sumber/koleksi ikut membatasi hasil       |
| Error 400 `property X should not exist`                    | Parameter query tidak dideklarasikan di DTO              | DTO turunan `PaginationQueryDto` menolak properti liar (`forbidNonWhitelisted`) — tambahkan field + validasi decorator di DTO, bukan di controller                                  |
| Pemeriksaan kesehatan MCP/REST gagal                       | Host demo sering offline (mesin pelatihan)               | Itu hasil yang benar — lencana `Bermasalah` + `last_health_at` tercatat; ulangi saat host aktif, jangan anggap bug sistem                                                           |

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
- Akun demo `@bara.local` (dibuat `db:seed`, kata sandi tercetak di layar) hanya untuk pelatihan lokal — seed melewatinya otomatis saat `NODE_ENV=production`; di produksi bootstrap lewat `db:create-admin`.
- Rotasi kunci `OPENROUTER_API_KEY`: ubah di `.env`, restart API — tidak ada penyimpanan lain.
- Bootstrap superadmin produksi lewat `db:create-admin`; setelah itu ganti kata sandi via UI.
- Semua keputusan tolak tercatat (`security.authorization.denied`, `security.privilege_escalation_blocked`) — pantau lewat Log Audit dengan filter severity `warn`/`critical`.
