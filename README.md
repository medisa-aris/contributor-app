# Contributor AI

Enterprise Employee AI Enablement Framework — aplikasi web full-stack yang menyiapkan karyawan memakai AI dalam tiga peran:

- **Second Brain** — asisten pengetahuan perusahaan (SOP, kebijakan, dokumentasi) dengan sitasi sumber.
- **Counterpart** — mitra berpikir: brainstorming, menguji asumsi, analisis akar masalah, perbandingan alternatif.
- **Subordinate** — asisten eksekusi tugas: analisis data, laporan, workflow multi-langkah, dengan persetujuan manusia untuk tindakan sensitif.

Di atas tiga mode itu, tiga pusat menopang operasional:

- **Knowledge Center** — sumber, dokumen, dan koleksi pengetahuan; pencarian FTS dengan cuplikan bercetak dan sitasi locator.
- **Agent Center** — katalog agen AI, eksekusi tugas, dan antrean persetujuan untuk aksi sensitif.
- **Integration Center** — konektor MCP/REST, pemeriksaan kesehatan eksplisit, dan status kredensial boolean (tanpa membocorkan nilai).

> Status: **Fase 1–6 selesai** — Fondasi + Autentikasi + RBAC + AI Workspace + Knowledge/Agent/Integration Center, terverifikasi end-to-end di browser untuk ketiga peran demo (admin, manajer, staf).

## Teknologi

| Lapisan   | Teknologi                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------ |
| Frontend  | Vue 3 + TypeScript (strict) + Vite + Vue Router + Pinia + vue-i18n + design system Fluent (custom)     |
| Backend   | NestJS 11 + TypeScript (strict) + TypeORM + PostgreSQL 16 + Redis (opsional)                           |
| Keamanan  | Sesi DB-backed + cookie HttpOnly, CSRF double-submit, rate limit + lockout, RBAC granular dengan audit |
| Infra dev | Docker Compose di host remote (PostgreSQL + Redis), aplikasi dev berjalan di Windows                   |

## Prasyarat

- Node.js >= 22 (diuji di Node 24)
- Akses SSH ke host Docker untuk PostgreSQL/Redis (`training@192.168.0.62`)
- Git Bash (Windows) untuk script `scripts/*.sh`

## Mulai Cepat

```bash
npm install                     # install semua workspace (+ build packages/shared)
npm run infra:up                # nyalakan PostgreSQL + Redis di host remote
cp apps/api/.env.example apps/api/.env   # lalu isi nilainya (lihat bagian Konfigurasi)
npm run db:migrate              # buat skema database
npm run db:seed                 # data demo: peran, izin, navigasi, departemen, konten pusat, akun demo
npm run dev                     # shared (watch) + API :3000 + Web :5173
```

Buka `http://localhost:5173` — login dengan salah satu akun demo (dicetak juga oleh `db:seed`):

| Email                       | Kata sandi          | Peran         |
| --------------------------- | ------------------- | ------------- |
| `admin@contributor.local`   | `Kontrib-d98a5d6d!` | administrator |
| `manajer@contributor.local` | `ManajerDemo123!`   | manager       |
| `staf@contributor.local`    | `StafDemo123!`      | staf          |

Akun demo hanya dibuat saat `NODE_ENV` **bukan** `production` — di produksi pakai `npm run db:create-admin`.

## Perintah Penting

| Perintah                                                                       | Fungsi                                       |
| ------------------------------------------------------------------------------ | -------------------------------------------- |
| `npm run dev`                                                                  | Jalankan semua (shared watch + API + Web)    |
| `npm run build`                                                                | Build produksi semua workspace               |
| `npm run lint` / `npm run format`                                              | ESLint / Prettier                            |
| `npm test`                                                                     | Unit + integration test (API) dan test (Web) |
| `npm run db:migrate`                                                           | Terapkan migrasi database                    |
| `npm run db:seed`                                                              | Seed data demo (idempoten)                   |
| `npm run db:create-admin`                                                      | Bootstrap administrator produksi             |
| `npm run infra:up` / `infra:ps` / `infra:logs` / `infra:down` / `infra:backup` | Operasi Docker host remote                   |

Dokumentasi: [`docs/architecture.md`](docs/architecture.md), [`docs/rbac.md`](docs/rbac.md), [`docs/api-conventions.md`](docs/api-conventions.md), [`docs/runbook.md`](docs/runbook.md).
