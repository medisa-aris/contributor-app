# Konvensi API — BeLead AI

> Semua endpoint di bawah prefix **`/api`**. OpenAPI interaktif: `GET /api/docs` (UI Swagger), `GET /api/docs-json` (dokumen). Pemasangan pipeline identik produksi/test ada di `apps/api/src/configure-app.ts`.

## 1. Amplop Respons

### Sukses

```json
{ "data": { ... } }
```

- Interceptor `ResponseEnvelopeInterceptor` membungkus otomatis menjadi `{ data }`; objek yang sudah memiliki `data`/`error` diteruskan apa adanya.
- Respons berpaginasi membawa `meta`:

```json
{
  "data": [ ... ],
  "meta": { "total": 42, "page": 2, "pageSize": 25, "totalPages": 2 }
}
```

Klien web (`usePagedList`) membaca `meta.total/page/pageSize/totalPages` dengan fallback aman bila meta tidak ada.

### Error

```json
{
  "error": {
    "code": "AUTHORIZATION_FORBIDDEN",
    "message": "Anda tidak memiliki izin untuk mengakses sumber daya ini.",
    "details": { "required": ["rbac.users.read"], "mode": "all", "missing": ["rbac.users.read"] },
    "requestId": "5b9f230c-33ba-40b0-8fc6-35c28122db81",
    "timestamp": "2026-10-16T14:55:42.335Z",
    "path": "/api/admin/users"
  }
}
```

- `message` dalam Bahasa Indonesia (ditampilkan ke pengguna); `code` stabil dalam Inggris (untuk percabangan kode klien).
- `requestId` berasal dari header/middleware `X-Request-Id` dan selalu dicatat di log.

## 2. Kode Error

| HTTP | Code | Kapan |
| --- | --- | --- |
| 400 | `BAD_REQUEST` / `VALIDATION_ERROR` | Body/query tidak valid. `details` memuat daftar `{ message }` |
| 401 | `AUTHENTICATION_REQUIRED` | Tidak ada/kedaluwarsa sesi |
| 401 | `AUTH_INVALID_CREDENTIALS` | Email/kata sandi salah |
| 401 | `CSRF_TOKEN_INVALID` | Header `x-csrf-token` hilang/tidak cocok |
| 403 | `AUTHORIZATION_FORBIDDEN` | Permission kurang; `details` memuat `required`/`missing` |
| 403 | `AUTHORIZATION_ESCALATION_BLOCKED` | Aturan anti-escalation dilanggar |
| 404 | `NOT_FOUND` | Resource tidak ada |
| 409 | `CONFLICT` | Duplikat kode, resource masih dipakai (mis. hapus departemen berisi pengguna) |
| 423 | `AUTH_ACCOUNT_LOCKED` | Lockout sementara karena percobaan login berulang |
| 429 | `RATE_LIMITED` | Melebihi batas laju |

Pemetaan status → code dilakukan `AllExceptionsFilter`; service melempar `AppError(code, message, status, details)` untuk presisi.

## 3. Autentikasi & CSRF

| Aspek | Detail |
| --- | --- |
| Sesi | Cookie `ca_session` **HttpOnly** (nama dapat dioverride `SESSION_COOKIE_NAME`); sesi tercatat di tabel `sessions` |
| CSRF | Double-submit: baca cookie `ca_csrf`, kirim sebagai header `x-csrf-token` **pada semua request mutasi** |
| Pengecualian | Hanya endpoint publik (`@CsrfExempt`, mis. login) yang bebas CSRF |
| Rate limit login | Tabel `login_attempts` (per email+IP); ambang dari konfigurasi `security.lockout_threshold`, `security.lockout_minutes` |
| Sesi absolut | Durasi maksimum dari konfigurasi `security.session_absolute_hours` |
| Produksi | Set `SESSION_COOKIE_SECURE=true`; reverse proxy wajib meneruskan `X-Forwarded-*` |

Endpoint terkait: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.

## 4. Validasi Input

- `ValidationPipe` global: `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`.
- **Field asing ditolak 400** — DTO adalah kontrak ketat; menambah properti yang tidak dikenal tidak diabaikan.
- DTO dibagi antara API dan klien melalui `@bara/shared` (`dto/*.dto.ts`).

## 5. Konvensi Query & Penamaan

| Hal | Konvensi |
| --- | --- |
| Paginasi | `?page=1&pageSize=25` (parameter camelCase) |
| Filter | nama kolom spesifik per endpoint (mis. `severity`, `eventKey`, `search`, `userId`) |
| Field JSON | **snake_case** (langsung dari baris SQL untuk endpoint admin; alias camelCase hanya untuk bentuk turunan seperti `dataScope`, `roleCode`, `totalPages`) |
| Waktu | ISO-8601 UTC |
| ID | UUID v4 |

## 6. Audit

- Aksi sensitif mencatat `AuditEvent` dengan `event_key` dari konvensi `domain.subjek.aksi` (lihat `packages/shared/src/audit-events.ts`), mis.: `auth.login.success`, `rbac.role.permissions.updated`, `rbac.assignment.granted`, `nav.menu_item.updated`, `security.privilege_escalation_blocked`, `admin.authz_test.performed`.
- Severity: `info` | `warn` | `critical`.
- Dibaca admin via `GET /api/admin/audit-events` (filter `eventKey` prefix, `severity`, `actorUserId`, `entityType`, `entityId`, `search`).

## 7. Otorisasi per Endpoint

- Setiap handler admin diberi `@RequirePermission(PERMISSIONS.xxx)` (identifier dari katalog — lihat [`rbac.md`](rbac.md)).
- Guard mengevaluasi lewat mesin RBAC yang sama dengan UI: superadmin bypass; selain itu deny-by-default.
- Contoh endpoint: `GET /api/admin/users` (butuh `rbac.users.read`), `PUT /api/admin/roles/:id/permissions` (butuh `rbac.permissions.assign`), `POST /api/admin/nav/menu-items` (butuh `nav.manage`), `GET /api/admin/diagnostics/users/:id/effective-permissions` (butuh `rbac.effective.inspect`).

## 8. Header yang Dipasang Server

| Header | Sumber |
| --- | --- |
| `X-Request-Id` | middleware requestId (echo atau generate) |
| Helmet | `X-Content-Type-Options`, `X-Frame-Options`, dll (CSP diserahkan ke proxy) |
| CORS | `Access-Control-Allow-Credentials: true` dengan allowlist origin dari env (`app.corsOrigins`) |

## 9. Contoh Alur Klien (web)

1. `POST /api/auth/login` → cookies terpasang; klien simpan status via `GET /api/auth/me`.
2. Setiap mutasi: sisipkan `x-csrf-token` dari cookie `ca_csrf`.
3. `GET /api/nav` → bangun sidebar sesuai permission efektif.
4. Error: periksa `error.code` (bukan string pesan) untuk percabangan; tampilkan `error.message` ke pengguna.
