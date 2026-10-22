# BeLead AI — Berau Coal Leadership AI Companion

Enterprise Employee AI Enablement Framework — aplikasi web full-stack yang menyiapkan karyawan memakai AI dalam tiga peran:

- **Multi Brain** — asisten pengetahuan perusahaan (SOP, kebijakan, dokumentasi) dengan sitasi sumber.
- **Partner** — mitra berpikir: brainstorming, menguji asumsi, analisis akar masalah, perbandingan alternatif.
- **Subordinate** — asisten eksekusi tugas: analisis data, laporan, workflow multi-langkah, dengan persetujuan manusia untuk tindakan sensitif.

Di atas tiga mode itu, tiga pusat menopang operasional:

- **Knowledge Center** — sumber, dokumen, dan koleksi pengetahuan; pencarian FTS dengan cuplikan bercetak dan sitasi locator.
- **Agent Center** — katalog agen AI, eksekusi tugas, dan antrean persetujuan untuk aksi sensitif.
- **Integration Center** — konektor MCP/REST, pemeriksaan kesehatan eksplisit, dan status kredensial boolean (tanpa membocorkan nilai).

> Status: **Fase 1–6 selesai** — Fondasi + Autentikasi + RBAC + AI Workspace + Knowledge/Agent/Integration Center, terverifikasi end-to-end di browser untuk peran demo (admin, manajer, staf, dan tim HSE K3L).

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
| `admin@bara.local`   | `Kontrib-d98a5d6d!` | administrator |
| `manajer@bara.local` | `ManajerDemo123!`   | manager       |
| `staf@bara.local`    | `StafDemo123!`      | staf          |

Selain itu tersedia **tim HSE K3L PT Berau Coal** (data fiktif dari `apps/api/src/database/seeds/data/hse-demo.json`), semuanya memakai kata sandi `HseDemo123!`:

| Email                | Jabatan                                       | Departemen   | Peran          |
| -------------------- | --------------------------------------------- | ------------ | -------------- |
| `hendra@bara.local`  | GM Safety                                     | `HSE`        | manager        |
| `ratna@bara.local`   | Manager HIRA                                  | `HSE-HIRA`   | manager        |
| `bambang@bara.local` | Manager Safety                                | `HSE-SAFETY` | manager        |
| `dimas@bara.local`   | Superintendent HIRA Operasional               | `HIRA-OPS`   | superintendent |
| `siti@bara.local`    | Superintendent Risk Control & MOC             | `HIRA-RCM`   | superintendent |
| `fajar@bara.local`   | Superintendent Safety Operasional & Inspeksi  | `SAFE-OPS`   | superintendent |
| `maria@bara.local`   | Superintendent Safety Compliance & Audit      | `SAFE-CMP`   | superintendent |

Hierarki pelaporan dimodelkan lewat pohon departemen (`HSE` → `HSE-HIRA`/`HSE-SAFETY` → departemen superintendent) dan peran ber-scope `department`: GM melihat seluruh subtree, manager melihat timnya. Tiap akun HSE juga memiliki 5 percakapan contoh (20 pesan) di Riwayat Percakapan. Selain itu seed membuat **200 aktivitas contoh** (20 per akun untuk 10 akun demo): percakapan Multi Brain, percakapan Partner (4 gaya), dan tugas Subordinate, tersebar merata pada 30, 50, dan 90 hari terakhir (`data/hse-demo-bulk.json`).

**Login cepat.** Di halaman login tersedia panel **Masuk cepat (demo)** — secara bawaan **tertutup**; klik judulnya untuk membuka. Isinya dikelompokkan menjadi *Akun sistem* (admin, manajer, staf) dan *Tim HSE K3L* (7 akun), bisa di-scroll, dan satu klik langsung masuk. Daftar akun ada di `LoginView.vue` dan harus selaras dengan seed. Panel ini hanya untuk demo; sembunyikan sebelum produksi.

Akun demo hanya dibuat saat `NODE_ENV` **bukan** `production` — di produksi pakai `npm run db:create-admin`.

## Konfigurasi

Salin `apps/api/.env.example` ke `apps/api/.env` (di-gitignore). Variabel utama:

| Variabel                      | Keterangan                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                | Koneksi PostgreSQL (`postgres://user:sandi@host:5432/contributor_ai`; nama database tidak diubah)  |
| `CORS_ORIGINS`                | Origin web yang diizinkan, dipisah koma (juga dipakai untuk memvalidasi redirect OAuth)             |
| `INTEGRATIONS_ENCRYPTION_KEY` | Kunci AES-256-GCM (base64, 32 byte) untuk token OAuth MCP: `openssl rand -base64 32`                |
| `AI_PROVIDER`, `*_API_KEY`    | Penyedia LLM dan kunci API (hanya di sisi server)                                                   |

### MCP dengan OAuth (Integration Center)

Server MCP dapat memakai autentikasi **OAuth** (mis. Metabase `ptbc-hse-data`): BeLead AI melakukan discovery metadata, mendaftarkan client (RFC 7591) atau memakai **client ID manual** (tombol *Client OAuth*), lalu alur otorisasi PKCE S256. Token disimpan terenkripsi dan disegarkan otomatis; hanya scope baca yang diminta. Catatan: Metabase hanya menerima redirect `https` (atau `localhost`), dan gateway dapat memblokir pendaftaran dinamis dari `localhost` — gunakan domain https atau client ID manual dari admin Metabase.

## Tema dan warna

Token desain ada di `apps/web/src/styles/tokens.css`. Palet merek mengikuti hijau **Berau Coal Energy** (`beraucoalenergy.co.id`): `#86c543` (aksen/bar atas), `#537a2a` (aksi utama, kontras AA terhadap teks putih), dan turunannya untuk tema terang dan gelap. Logo dan tanda resmi belum dipakai; gunakan hanya aset yang disediakan Corporate Communications.

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
