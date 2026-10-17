# Arsitektur Contributor AI

> Fase 1–6: Fondasi + Autentikasi + RBAC + AI Workspace + tiga pusat (Knowledge, Agent, Integration). Dokumen ini menjelaskan struktur, alur, dan keputusan desain utama.

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

| Output      | Format                                                                                         | Dipakai oleh       |
| ----------- | ---------------------------------------------------------------------------------------------- | ------------------ |
| `dist/`     | CommonJS (via `main` / kondisi `require`)                                                      | NestJS API         |
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

| Modul          | Isi                                                                                                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`         | Login/logout, sesi DB-backed, CSRF double-submit, rate limit + lockout (`login_attempts`)                                                                                                                                                 |
| `rbac`         | `policy-engine.ts`, `effective-permissions.service.ts`, `escalation.service.ts`, `authz-cache.service.ts`, `rbac-diagnostics.controller.ts`                                                                                               |
| `admin`        | Controller admin: users, roles, permissions, departments, groups, policies, nav-admin, sessions, config, providers, audit, diagnostics                                                                                                    |
| `ai`           | AI Workspace: `ai.controller.ts` (chat, chat/stream SSE, conversations, tasks), `conversations.service.ts`, `tasks.service.ts`, `gateway.service.ts`, `provider-resolver.ts`, `prompts.ts`, `limits.ts`, adapter provider di `providers/` |
| `audit`        | `audit.interceptor.ts` + `audit.service.ts` — pencatatan AuditEvent                                                                                                                                                                       |
| `knowledge`    | Knowledge Center: sumber (`knowledge_sources`), dokumen (`knowledge_documents` + status indeks), koleksi dengan anggota sumber, pencarian FTS PostgreSQL dengan cuplikan `ts_headline` dan sitasi locator                                 |
| `agents`       | Agent Center: registry agen (`agents`) + alat, eksekusi tugas berbasis lifecycle AI Workspace, antrean persetujuan (`approvals`) untuk agen `requires_approval`                                                                           |
| `integrations` | Integration Center: MCP server (`mcp_servers`), REST connector + endpoint peralatan (`rest_connectors`), pemeriksaan kesehatan, status kredensial boolean saja (terkonfigurasi/belum — nilai rahasia tidak pernah keluar)                 |
| `health`       | `/api/health`                                                                                                                                                                                                                             |

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
- `1700000002000-ai-workspace.ts` — enum `task_status`, tabel AI Workspace (`conversations`, `conversation_messages`, `ai_tasks`, `ai_task_events`) + indeks parsial status terbuka.
- `1700000003000-knowledge-agents-integrations.ts` — tabel Fase 5: `knowledge_sources`, `knowledge_collections`, `knowledge_collection_sources`, `knowledge_documents`, `agents`, `approvals`, `mcp_servers`, `rest_connectors` + indeks FTS.

Tabel (31): `users`, `sessions`, `login_attempts`, `roles`, `permissions`, `role_permissions`, `user_roles`, `groups`, `user_groups`, `group_roles`, `departments`, `resource_policies`, `applications`, `modules`, `features`, `menu_items`, `app_config`, `rbac_meta`, `audit_events`, `conversations`, `conversation_messages`, `ai_tasks`, `ai_task_events`, `knowledge_sources`, `knowledge_collections`, `knowledge_collection_sources`, `knowledge_documents`, `agents`, `approvals`, `mcp_servers`, `rest_connectors`.

`rbac_meta.version` adalah **versi otorisasi global**: setiap mutasi RBAC menaikkannya; `AuthzCacheService` memakai versi ini sebagai kunci cache sehingga perubahan izin berlaku cepat tanpa restart.

### 3.4 Autentikasi & sesi

- Sesi **DB-backed** (`sessions`) dengan token acak; cookie `ca_session` **HttpOnly** (+ `Secure` di produksi).
- **CSRF double-submit**: cookie `ca_csrf` + header `x-csrf-token` untuk semua request mutasi.
- **Rate limit + lockout** login via tabel `login_attempts` (kombinasi email+IP).
- Sesi aktif = `revoked_at IS NULL AND expires_at > now()`; admin dapat mencabut sesi dari UI (menu Sesi).

### 3.5 AI Workspace (Fase 4)

Tiga mode interaksi AI, masing-masing dikunci permission tersendiri di bawah aplikasi `ai-workspace`:

| Mode                             | Permission               | Pengalaman                                                                                                        | Suhu |
| -------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------- | ---- |
| Otak Kedua (`second_brain`)      | `ai.secondbrain.query`   | Tanya-jawab pengetahuan; jawaban langsung tersimpan sebagai percakapan                                            | 0.3  |
| Mitra Berpikir (`counterpart`)   | `ai.counterpart.analyze` | Lawan bicara yang menantang gagasan; gaya lawan bicara dipilih dari `COUNTERPART_STYLES` di `@contributor/shared` | 0.7  |
| Asisten Eksekusi (`subordinate`) | `ai.subordinate.execute` | Tugas tertulis satu instruksi; pengguna memicu eksekusi dan memantau status                                       | 0.2  |

- **Gateway provider** (`gateway.service.ts`): adapter di-resolve sekali per proses dari konfigurasi env (`AI_PROVIDER`, `AI_MODEL`, `AI_BASE_URL`, `*_API_KEY`) lewat `provider-resolver.ts`. `OpenAiCompatibleProvider` melayani OpenAI/OpenRouter/Ollama dalam satu jalur kode; `AnthropicProvider` untuk Anthropic. System prompt disusun per mode (`prompts.ts`), pesan divalidasi dan dibatasi (`limits.ts`), timeout via `AbortSignal`. Kredensial hanya hidup di memori proses API — tidak pernah ke browser, log, atau respons.
- **Streaming SSE**: `POST /api/ai/chat/stream` mengirim event `ready` → `delta` (potongan jawaban) → `done` (pesan asisten tersimpan) / `error`. Klien web memakai `fetch` + `TextDecoderStream` karena `EventSource` tidak mendukung POST dan header CSRF.
- **Lifecycle tugas**: `created → validating → running → completed | failed`, plus `cancelled` (hanya dari status terbuka) dan `awaiting_approval` di enum untuk fase persetujuan manusia berikutnya. Klaim status bersifat atomik (`UPDATE … WHERE status = ANY(…) RETURNING`), sehingga dua permintaan run bersamaan tidak mengeksekusi dobel. Hasil, model, token, durasi, dan pesan error tercatat di `ai_tasks`; setiap transisi tercatat sebagai baris `ai_task_events` (jejak eksekusi yang tampil di UI Detail). Pembuatan, keberhasilan, kegagalan, dan pembatalan tugas tercatat di audit trail.
- **Ruang lingkup data**: percakapan dan tugas selalu milik-sendiri — query menyaring `user_id` pemilik, admin pun tidak dapat membaca percakapan orang lain.
- **Konvensi respons list** sama dengan modul admin: `paginated()` → `{data: [...], meta: {page, limit, total, totalPages}}`.
- **Frontend**: `ChatWorkspace.vue` dipakai ulang oleh kedua mode percakapan (sidebar riwayat hanya muncul bila pengguna punya `ai.workspace.history.read`); `SubordinateView.vue` memantau status terbuka dengan polling 2 dtk; `WorkspaceHistoryView.vue` menggabungkan riwayat percakapan dan tugas.

### 3.6 Tiga Pusat Fase 5

**Knowledge Center** (`knowledge/`). Sumber pengetahuan manual (kode unik, origin `manual`), dokumen dengan konten mentah + status indeks (`indexed|pending|failed`), dan koleksi sebagai himpunan sumber. Pencarian memakai kolom `tsvector` (`content_tsv`) dengan ranking `ts_rank`; cuplikan hasil dibungkus `ts_headline` (`<mark>…</mark>`) dan disajikan sebagai segmen `{text, highlighted}` di web — dirender elemen `<mark>` via `v-for`, **tanpa `v-html`**, sehingga aman dari XSS. Setiap hasil membawa sitasi locator (judul dokumen + sumber + lokasi) agar jawaban AI dapat dirujuk balik.

**Agent Center** (`agents/`). Registry agen: nama, instruksi sistem, daftar alat, `requires_approval`, status aktif. Eksekusi memakai lifecycle tugas yang sama dengan Asisten Eksekusi (`created → validating → awaiting_approval/running → completed|failed`): agen tanpa persetujuan langsung berjalan, agen `requires_approval` berhenti di `awaiting_approval` sampai pemutus (`agents.approve`) menyetujui atau menolak — keputusan dicatat di `approvals` (pemutus, catatan, waktu) dan audit trail. Daftar tugas per agen menampilkan nama agen + email peminta agar operasional mudah diaudit.

**Integration Center** (`integrations/`). Dua jenis konektor: **MCP server** (URL endpoint, jenis transport) dan **REST connector** (base URL + daftar endpoint peralatan `GET|POST` yang diparsing dari teks `METHOD /path`). Kesehatan dicek eksplisit lewat tombol "Periksa kesehatan" (bukan latar) dan hasilnya (`last_health_ok/at`) ditampilkan sebagai lencana. Status kredensial provider AI disajikan **boolean terkonfigurasi/belum** — nama variabel env boleh tampil, nilai rahasia tidak pernah keluar dari server.

Ketiga pusat mengikuti konvensi yang sama: guard permission per endpoint, amplop `paginated()` untuk daftar, audit event untuk mutasi, dan DTO query ketat (`whitelist + forbidNonWhitelisted`) — parameter filter baru harus dideklarasikan eksplisit di DTO turunan `PaginationQueryDto`.

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
└── views/        # halaman: admin/ (layar administrasi), knowledge/, agents/, integrations/, landing + 3 mode AI Workspace + riwayat
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

| Keputusan                                                        | Alasan                                                                                                                      |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Deny-by-default di semua endpoint admin                          | Permukaan serangan minimal; setiap endpoint menyatakan permission eksplisit                                                 |
| Versi RBAC global (`rbac_meta`) sebagai kunci cache              | Konsistensi: perubahan izin langsung terlihat, tanpa invalidasi per-pengguna                                                |
| Sesi DB-backed, bukan JWT                                        | Pencabutan seketika (revoke per sesi), audit lengkap, tanpa key rotation                                                    |
| Amplop respons seragam                                           | Klien web menangani sukses/error dengan satu jalur kode                                                                     |
| `packages/shared` build ganda CJS+ESM                            | Satu sumber kebenaran kontrak untuk dua ekosistem (Nest CJS, Vite ESM)                                                      |
| Migrasi SQL mentah, bukan `synchronize`                          | Terkontrol, dapat diaudit, aman untuk produksi                                                                              |
| Kredensial provider AI hanya di `.env` + memori proses API       | Kunci tidak pernah sampai ke bundle frontend, log, atau respons — permukaan bocor minimal                                   |
| Adapter OpenAI-compatible tunggal untuk OpenAI/OpenRouter/Ollama | Tiga provider sejenis (API chat completions) dilayani satu jalur kode; Anthropic tetap adapter sendiri                      |
| SSE via `fetch` + pembaca stream manual                          | `EventSource` tidak mendukung POST dan header CSRF; fetch menjaga pipeline keamanan yang sama dengan request lain           |
| Klaim status tugas atomik di SQL                                 | Dua klik "Jalankan" bersamaan aman; tidak ada eksekusi dobel yang memboroskan token                                         |
| Data percakapan/tugas selalu milik-sendiri                       | Privasi terjaga walau role lebih tinggi; konsisten dengan data scope RBAC                                                   |
| Cuplikan FTS dirender sebagai segmen, bukan `v-html`             | Teks sumber dokumen tidak pernah diinjeksikan sebagai HTML — XSS mustahil lewat jalur hasil pencarian                       |
| Status kredensial = boolean, nilai tidak pernah meninggalkan API | Operator bisa memverifikasi konfigurasi tanpa membuka rahasia; permukaan bocor minimal                                      |
| Persetujuan agen sebagai baris keputusan terpisah (`approvals`)  | Siapa memutus, kapan, dengan catatan apa — jejak audit lengkap untuk tindakan sensitif                                      |
| Kesehatan konektor dicek eksplisit, bukan latar                  | Host pelatihan sering offline; pemeriksaan latar akan membanjiri log dengan error — tombol menjadikannya keputusan operator |

## 7. Pedoman UI: Visualisasi Dulu, Form CRUD Kemudian

Sebelum membangun fitur input/CRUD apa pun, pertimbangkan dulu apakah ada pustaka visualisasi JS yang membuatnya lebih visual dan interaktif. Layar utama menampilkan visualisasi datanya; mode tambah/ubah/hapus tertanam di dalamnya, bukan layar form terpisah sebagai pintu utama.

- **Contoh rujukan**: organisasi/departemen → diagram struktur organisasi (org chart) dengan mode penambahan node di dalam diagram; katalog agen → kartu/grid interaktif; alur persetujuan → diagram alur.
- **Sudah diterapkan**: layar Departemen memakai `d3-org-chart` — kanvas org chart interaktif (zoom, seret, lipat cabang) dengan panel detail per node dan mode tambah/ubah/hapus tertanam (`DepartmentsAdminView.vue`).
- **Kandidat pustaka**: `d3-org-chart`, `echarts`, `vue-flow`, `vis-network` (d3/canvas/SVG) — pilih satu per kasus, jangan campur tanpa alasan.
- **Form tidak hilang**: mode sunting (panel/drawer/node inline) tetap ada, tapi sebagai pelengkap visualisasi, bukan pengganti.
- **Bahasa**: seluruh label tetap Bahasa Indonesia via `locales/id.ts`; visualisasi memakai token `--ca-*`.
