# Model RBAC — BeLead AI

> Sumber kebenaran: `packages/shared/src/permissions.ts` (katalog), `apps/api/src/modules/rbac/*` (mesin evaluasi), migrasi `1700000000000-initial-schema.ts` (skema).

## 1. Prinsip

1. **Deny-by-default** — tanpa grant eksplisit, akses ditolak. Setiap endpoint API menyatakan permission yang dibutuhkan lewat `@RequirePermission(PERMISSIONS.xxx)`.
2. **Satu katalog** — semua identifier permission didefinisikan di `@bara/shared` (`PERMISSION_CATALOG`, 38 entri, 5 aplikasi). Identifier adalah kontrak permanen: jangan pernah mengganti nama, hanya menambah/mendepresiasi.
3. **Perubahan seketika** — setiap mutasi RBAC menaikkan `rbac_meta.version`; cache otorisasi berkunci versi ini (TTL 60 dtk, versi di-cache 3 dtk) sehingga pencabutan izin berlaku dalam hitungan detik.
4. **Satu jalur evaluasi** — UI (tombol/nav), guard API, dan layar diagnostik memakai mesin evaluasi yang sama (`policy-engine.ts`), jadi apa yang ditampilkan "Permission efektif" persis yang ditegakkan server.

## 2. Entitas

| Entri | Tabel | Catatan |
| --- | --- | --- |
| Pengguna | `users` | `is_superadmin`, `is_active`, `department_id` |
| Departemen | `departments` | pohon (self-referencing `parent_id`) |
| Grup | `groups` | lintas departemen |
| Peran | `roles` | `is_system` untuk peran bawaan (administrator, manajer, staf) |
| Permission | `permissions` | cermin `PERMISSION_CATALOG` di DB; sinkronisasi lewat UI Katalog Permission |
| Penugasan peran | `user_roles`, `group_roles` | masing-masing membawa `data_scope` + `department_id` |
| Keanggotaan | `user_groups` | |
| Kebijakan | `resource_policies` | allow/deny eksplisit (lihat §5) |
| Jejak | `audit_events` | |
| Versi | `rbac_meta` | `version` global RBAC |

**Penugasan efektif pengguna** = penugasan langsung (`user_roles`) ∪ penugasan via grup (`user_groups` → `group_roles`).

## 3. Katalog Permission

38 identifier dengan pola `domain.area.action`, dikelompokkan per aplikasi:

| Aplikasi | Contoh identifier |
| --- | --- |
| `ai-workspace` | `ai.workspace.access`, `ai.secondbrain.query`, `ai.counterpart.analyze`, `ai.subordinate.execute` |
| `knowledge-center` | `knowledge.documents.read`, `knowledge.collections.read`, `knowledge.search.use` |
| `agent-center` | `agents.view`, `agents.create`, `agents.execute`, `agents.approve` |
| `integration-center` | `integrations.view`, `integrations.configure` |
| `administration` | `admin.access`, `rbac.users.read`/`.manage`, `rbac.roles.read`/`.manage`, `rbac.groups.read`/`.manage`, `rbac.departments.read`/`.manage`, `rbac.policies.read`/`.manage`, `rbac.permissions.read`, `rbac.permissions.assign`, `rbac.effective.inspect`, `rbac.authz.test`, `nav.manage`, `config.read`, `config.manage`, `security.sessions.manage`, `audit.logs.read`, `providers.health.read` |

Katalog di DB bisa menyimpang dari kode (mis. setelah upgrade); tombol **Sinkronkan katalog** menambahkan entri baru tanpa mengubah/menghapus yang lama.

## 4. Evaluasi Keputusan (`policy-engine.ts`)

```
evaluatePermission(input, permission, resourceContext?)
```

Urutan:

1. **Superadmin** → `allowed: true`, `scope: 'global'`, reason `superadmin`. Satu-satunya bypass policy.
2. **Grant dari peran** — kumpulkan assignment (langsung + grup) yang perannya memuat permission tersebut.
   - Tidak ada → **ditolak**, reason `no_role_grant`.
   - Ada → scope = **scope terluas** di antara assignment pemberi (urutan `own` < `department` < `global`, lihat `DATA_SCOPE_REACH`).
3. **Policy deny** — policy match yang berlaku bagi subjek (user/grup/role) + pola permission + resource. **Satu saja policy deny yang cocok menimpa semua allow** → ditolak, reason `policy_deny`. `priority` hanya mengurutkan tampilan rantai (deny berprioritas tertinggi tampil lebih dulu).
4. **Policy allow** — policy allow yang cocok menganotasi rantai. Bila `conditions.ownership = true` dan `resourceOwnerId ≠ userId` → ditolak, reason `ownership_required`.
5. Selain itu → **diizinkan**, reason `role_grant`.

Setiap keputusan membawa **chain** (jejak): entri `role` / `policy` / `superadmin` dengan `label`, `effect` (allow/deny/info), dan `detail` berbahasa manusia — inilah yang dirender dialog "Jejak evaluasi" di UI.

Reason code: `superadmin`, `role_grant`, `no_role_grant`, `policy_deny`, `ownership_required`.

### Data scope

`global` (semua data) ⊃ `department` (departemen penugasan) ⊃ `own` (data sendiri). Ditegakkan di service/query, bukan hanya di UI.

## 5. Kebijakan (`resource_policies`)

| Kolom | Arti |
| --- | --- |
| `effect` | `allow` / `deny` |
| `subject_type` + `subject_id` | `user` / `group` / `role` (UUID) |
| `permission_pattern` | identifier penuh (`ai.workspace.access`) atau awalan dengan `*` (`knowledge.*`) |
| `resource_type` + `resource_id` | opsional; `NULL` = berlaku untuk semua resource; `resource_id = '*'` = semua resource bertipe tersebut. Policy bertipe hanya match bila request membawa konteks resource |
| `priority` | urutan tampil/rantai (bukan penentu allow vs deny) |
| `conditions` | mis. `{"ownership": true}` |
| `is_active` | policy nonaktif diabaikan |

## 6. Anti-Eskalasi (`escalation.service.ts`)

Aturan yang ditegakkan saat pemberian/pencabutan assignment:

| Kode | Aturan |
| --- | --- |
| `self_modification` | Siapa pun (termasuk superadmin) tidak boleh mengubah assignment role miliknya sendiri |
| `system_role_requires_superadmin` | Role sistem `administrator` hanya boleh diberikan superadmin; role sistem lain tidak bisa diubah/dihapus non-superadmin |
| `permission_subset` | Pemberi non-superadmin hanya boleh memberikan role yang **seluruh** permission-nya ia miliki |
| `scope_exceeded` | Scope assignment tidak boleh melebihi scope pemberi untuk permission tersebut |
| `last_superadmin` | Superadmin aktif terakhir tidak dapat dinonaktifkan/dicabut haknya |

## 7. Diagnostik (UI + API)

| Alat | Endpoint | Guna |
| --- | --- | --- |
| Permission efektif | `GET /api/admin/diagnostics/users/:id/effective-permissions` | 38 keputusan + alasan + scope + rantai untuk satu pengguna |
| Uji otorisasi | `POST /api/admin/diagnostics/authz-test` | Uji hipotetis `{userId, permission, resourceType?, resourceId?, resourceOwnerId?}` tanpa mengubah data |
| Log audit | `GET /api/admin/audit-events` | Riwayat aksi dengan filter severity/event/aktor |

Setiap uji otorisasi juga tercatat sebagai event audit (`admin.authz_test.performed`).

## 8. Navigasi Dinamis

Pohon navigasi (`applications → modules → features → menu_items`) disimpan di DB dan difilter per pengguna oleh server: menu tampil bila permission yang dibutuhkan termasuk keputusan efektif. Item dengan `is_future = true` dirender dengan lencana "segera" (fitur fase berikutnya). Perubahan di layar **Navigasi** langsung memengaruhi sidebar.

## 9. Alur Mutasi (contoh: mencabut izin)

1. Admin mengubah permission role lewat matriks → `PUT /api/admin/roles/:id/permissions` (butuh `rbac.permissions.assign`).
2. Guard menjalankan `EscalationService` (subset permission + scope + sistem role).
3. Transaksi DB memperbarui `role_permissions` + menaikkan `rbac_meta.version`.
4. `AuditEvent` tercatat (`rbac.role.permissions.updated`).
5. HTTP berikutnya dari pengguna terdampak mengevaluasi ulang (cache miss karena versi berubah) → akses dicabut dalam ≤ 3–60 dtk, tanpa restart.
