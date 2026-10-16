# Arsitektur Contributor AI

> Fase 1–3: Fondasi + Autentikasi + RBAC. Dokumen ini menjelaskan struktur, alur, dan keputusan desain utama.

## 1. Peta Monorepo

```
contributor-app/
├── apps/
│   ├── api/          # NestJS 11 (CommonJS) — REST API /api/*
│   └── web/          # Vue 3 + Vite + Pinia + vue-i18n — SPA
├── packages/
│   └── shared/       # @contributor/shared — katalog permission, enum, tipe kontrak API
├── scripts/          # infra.sh (operasi Docker host remote), utilitas
└── docs/             # dokumen ini
```

Package manager: **npm workspaces**. `packages/shared` di-build ganda:

| Output | Format | Dipakai oleh |
| --- | --- | --- |
| `dist/` | CommonJS (via `main` / kondisi `require`) | NestJS API |
| `dist/esm/` | ESM (via `module` / kondisi `import`, plus `dist/esm/package.json` berisi `{"type":"module"}`) | Vite/Rollup di web |

Build: `npm run build -w @contributor/shared` menjalankan `tsc -p tsconfig.json && tsc -p tsconfig.esm.json && node scripts/write-esm-marker.cjs`.

## 2. Topologi Runtime (dev)

```
Windows (dev)                          Docker host remote (training@192.168.0.62)
┌───────────────────────┐              ┌──────────────────────────────┐
│ Web  :5173 (Vite)     │              │ postgres:16  → 192.168.0.62:5432 │
│  └─ proxy /api ───────┼── LAN ─────→ │ redis:7      → 192.168.0.62:6379 │
│ API  :3000 (NestJS)   │              │ compose project: contributor-ai  │
└───────────────────────┘              └──────────────────────────────┘
```

- Docker Compose berada di `infra/` (proyek `contributor-ai`), port terikat ke IP LAN host. Host ini **dipakai bersama** — jangan pernah `docker system prune` atau menyentuh container milik proyek lain.
- Redis saat ini **opsional** (hanya dibaca sebagai konfigurasi); cache otorisasi berjalan in-memory (`AuthzCacheService`) dengan antarmuka yang siap diganti implementasi Redis tanpa mengubah pemanggil.
- Rahasia ada di `infra/.env` dan `apps/api/.env` (keduanya gitignored). `*.env.example` hanya memuat placeholder.

## 3. Backend (apps/api)

### 3.1 Modul

| Modul | Isi |
| --- | --- |
| `auth` | Login/logout, sesi DB-backed, CSRF double-submit, rate limit + lockout (`login_attempts`) |
| `rbac` | `policy-engine.ts`, `effective-permissions.service.ts`, `escalation.service.ts`, `authz-cache.service.ts`, `rbac-diagnostics.controller.ts` |
| `admin` | Controller admin: users, roles, permissions, departments, groups, policies, nav-admin, sessions, config, providers, audit, diagnostics |
| `audit` | `audit.interceptor.ts` + `audit.service.ts` — pencatatan AuditEvent |
| `health` | `/api/health` |

### 3.2 Pipeline HTTP (`configure-app.ts`)

Urutan global yang identik untuk produksi dan test:

1. `pino-http` (log terstruktur) + middleware `requestId` (X-Request-Id).
2. `cookie-parser`, `helmet` (CSP diserahkan ke reverse proxy), CORS `credentials: true` dengan allowlist dari env.
3. Global prefix **`api`**.
4. `ValidationPipe` — `whitelist: true, forbidNonWhitelisted: true, transform: true`.
5. `AllExceptionsFilter` (amplop error seragam) → `ResponseEnvelopeInterceptor` (amplop sukses seragam).

### 3.3 Lapisan data

TypeORM + migrasi SQL murni di `apps/api/src/database/migrations/`:

- `1700000000000-initial-schema.ts` — seluruh tabel + indeks.
- `1700000001000-seed-rbac-meta-and-app-config.ts` — baris `rbac_meta` (versi RBAC) dan `app_config` awal.

Tabel (19): `users`, `sessions`, `login_attempts`, `roles`, `permissions`, `role_permissions`, `user_roles`, `groups`, `user_groups`, `group_roles`, `departments`, `resource_policies`, `applications`, `modules`, `features`, `menu_items`, `app_config`, `rbac_meta`, `audit_events`.

`rbac_meta.version` adalah **versi otorisasi global**: setiap mutasi RBAC menaikkannya; `AuthzCacheService` memakai versi ini sebagai kunci cache sehingga perubahan izin berlaku cepat tanpa restart.

### 3.4 Autentikasi & sesi

- Sesi **DB-backed** (`sessions`) dengan token acak; cookie `ca_session` **HttpOnly** (+ `Secure` di produksi).
- **CSRF double-submit**: cookie `ca_csrf` + header `x-csrf-token` untuk semua request mutasi.
- **Rate limit + lockout** login via tabel `login_attempts` (kombinasi email+IP).
- Sesi aktif = `revoked_at IS NULL AND expires_at > now()`; admin dapat mencabut sesi dari UI (menu Sesi).

## 4. Frontend (apps/web)

```
src/
├── api/          # klien HTTP (amplop envelope, ApiError) + modul per-domain
├── components/ui # design system "Ca*" (Fluent, token CSS)
├── composables/  # usePagedList, dll.
├── i18n/         # vue-i18n — locale default: id
├── layouts/      # AppShell (sidebar dinamis, topbar, user menu)
├── router/       # route + guard izin per-halaman
├── stores/       # Pinia: auth (sesi + permission efektif), theme, toast
├── styles/       # tokens.css + gaya global
└── views/        # halaman (admin/ untuk 16 layar administrasi)
```

- **Navigasi dinamis**: sidebar dirender dari `GET /api/nav` — pohon Application → Module → Feature → MenuItem, difilter server berdasarkan permission efektif pengguna; item dengan `is_future` tampil dengan lencana "segera".
- **Guard router**: setiap route admin menyatakan permission yang dibutuhkan; pengguna tanpa izin dialihkan ke beranda tanpa request API apa pun.
- **Design system**: komponen `Ca*` (24 komponen) memakai token CSS `--ca-*` dari `styles/tokens.css` — warna, ukuran teks, spacing, radius, tinggi topbar/sidebar. Tema terang/gelap.
- **i18n**: seluruh teks UI Bahasa Indonesia (`locales/id.ts`); identifier teknis (permission, kode, event key) tetap Inggris.

## 5. Alur Otorisasi (ringkas)

```
Request → SessionAuthGuard (identifikasi) → AuthorizationGuard (izin)
   → PolicyEngine: kumpulkan grant dari peran (langsung + grup) → terapkan deny policy → keputusan
   → DataScope (global|department|own) diterapkan di service/query
   → AuditInterceptor mencatat aksi sensitif
```

Detail lengkap: [`rbac.md`](rbac.md). Kontrak HTTP: [`api-conventions.md`](api-conventions.md). Operasional: [`runbook.md`](runbook.md).

## 6. Keputusan Desain Penting

| Keputusan | Alasan |
| --- | --- |
| Deny-by-default di semua endpoint admin | Permukaan serangan minimal; setiap endpoint menyatakan permission eksplisit |
| Versi RBAC global (`rbac_meta`) sebagai kunci cache | Konsistensi: perubahan izin langsung terlihat, tanpa invalidasi per-pengguna |
| Sesi DB-backed, bukan JWT | Pencabutan seketika (revoke per sesi), audit lengkap, tanpa key rotation |
| Amplop respons seragam | Klien web menangani sukses/error dengan satu jalur kode |
| `packages/shared` build ganda CJS+ESM | Satu sumber kebenaran kontrak untuk dua ekosistem (Nest CJS, Vite ESM) |
| Migrasi SQL mentah, bukan `synchronize` | Terkontrol, dapat diaudit, aman untuk produksi |

## 7. Pedoman UI: Visualisasi Dulu, Form CRUD Kemudian

Sebelum membangun fitur input/CRUD apa pun, pertimbangkan dulu apakah ada pustaka visualisasi JS yang membuatnya lebih visual dan interaktif. Layar utama menampilkan visualisasi datanya; mode tambah/ubah/hapus tertanam di dalamnya, bukan layar form terpisah sebagai pintu utama.

- **Contoh rujukan**: organisasi/departemen → diagram struktur organisasi (org chart) dengan mode penambahan node di dalam diagram; katalog agen → kartu/grid interaktif; alur persetujuan → diagram alur.
- **Sudah diterapkan**: layar Departemen memakai `d3-org-chart` — kanvas org chart interaktif (zoom, seret, lipat cabang) dengan panel detail per node dan mode tambah/ubah/hapus tertanam (`DepartmentsAdminView.vue`).
- **Kandidat pustaka**: `d3-org-chart`, `echarts`, `vue-flow`, `vis-network` (d3/canvas/SVG) — pilih satu per kasus, jangan campur tanpa alasan.
- **Form tidak hilang**: mode sunting (panel/drawer/node inline) tetap ada, tapi sebagai pelengkap visualisasi, bukan pengganti.
- **Bahasa**: seluruh label tetap Bahasa Indonesia via `locales/id.ts`; visualisasi memakai token `--ca-*`.
