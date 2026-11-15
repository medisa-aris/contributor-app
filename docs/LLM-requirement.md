# LLM Requirement — Central Memory with Doors ("Memori Terpusat")

> Status: draft for implementation · Audience: engineers and coding agents (LLM) · Language: English (UI strings in Bahasa Indonesia)
>
> Items marked **NEW** do not exist in the codebase yet. Everything else refers to existing code.

---

## 1. Concept

### 1.1 The metaphor

A psychiatrist keeps **one big book**. Inside it, every patient has **their own case file**. The psychiatrist listens and writes down what matters: who the person is, what they prefer, what they decided, what happened. The psychiatrist doesn't keep the verbatim transcript.

| Metaphor | ContributorAI |
|---|---|
| Patient | Every **subject** working in the app: a person (user) or a personal agent |
| Psychiatrist | The **Memory Service**. It listens to conversations and tasks and writes distilled notes. |
| The big book | One central store (`memory_entries`), logically partitioned per subject |
| Case file | A subject's **Memory Book**, all entries where `subject_id = X` |
| A note | A **Memory Entry**: one atomic, distilled statement |
| Door | A gate on a case file that a **leader** can open to widen their own memory |

### 1.2 The leader scenario

A manager has two people (A, B) and one personal agent (C). By default, the manager's AI only remembers the manager. In the **"Pintu memori"** bar, the manager toggles doors:

- Open **B** → answers can now draw on B's shareable notes.
- Open **B + C** → the memory gets broader.
- Close **B** → the next answer no longer sees B.

The memory **gets broader door by door**, never by default.

### 1.3 Glossary

| Term | Definition |
|---|---|
| **Subject** | An owner of a memory book: `kind = user` or `kind = agent` |
| **Memory Entry** | One distilled statement (fact, preference, decision, episode…) belonging to one subject |
| **Door** | A subject's sharing settings: whether it can be opened, and which entry types are exposed |
| **Grant** | The subject (or, for an agent, its owner) allowing their door to be opened |
| **Open** | A leader switching a granted door on for a specific conversation or task |
| **Reach** | The set of subjects a leader is structurally allowed to open (their subordinates) |
| **Scope** | The final set of subjects a single retrieval is allowed to read |

---

## 2. Core principles (non-negotiable)

1. **Distilled, never raw.** Leaders read *memory entries*, never a subordinate's conversation transcripts, attachments or task logs. Source pointers are hidden from anyone except the owner.
2. **Consent first.**
   - A person's door is closed (`enabled = false`) until they grant it.
   - An agent's door is granted by the agent's owner.
3. **Private stays private.** Entries marked `sensitivity = 'private'` are never returned to anyone except the owner, even through an open door.
4. **Immediate revocation.** Scope is computed **per query**. If a grant is revoked, the next retrieval excludes it, even mid-conversation.
5. **Transparency.**
   - Every door opening and every retrieval that read another subject's entries is logged.
   - Subjects can see who opened their door ("Siapa yang membuka pintu saya").
6. **Server-side enforcement.**
   - Scope is resolved in SQL inside the API.
   - The client only sends *which doors it wants open*. It never sends which entries it may see.
7. **Guardrails apply.** Everything written to memory passes through the existing PII masker (`apps/api/src/modules/ai/guardrails/masker.ts`) first.

---

## 3. Data model

PostgreSQL, raw-SQL migration in `apps/api/src/database/migrations/` (**NEW** `1700000025000-central-memory.ts`), following the style of `1700000019000-mcp-tools-conversation-connectors.ts`.

### 3.1 Extension

```sql
CREATE EXTENSION IF NOT EXISTS vector;   -- pgvector (NEW dependency)
```

### 3.2 Department head (reporting line) — NEW column

There is no manager or head concept today: only `departments.parent_id` and `users.department_id`.

```sql
ALTER TABLE departments
  ADD COLUMN head_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX idx_departments_head ON departments (head_user_id) WHERE head_user_id IS NOT NULL;
```

### 3.3 Subjects — NEW

```sql
CREATE TYPE memory_subject_kind AS ENUM ('user', 'agent');

CREATE TABLE memory_subjects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          memory_subject_kind NOT NULL,
  user_id       uuid REFERENCES users(id)  ON DELETE CASCADE,
  agent_id      uuid REFERENCES agents(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- = user_id for persons, agents.owner_user_id for agents
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'user'  AND user_id  IS NOT NULL AND agent_id IS NULL)
      OR (kind = 'agent' AND agent_id IS NOT NULL AND user_id  IS NULL))
);
CREATE UNIQUE INDEX uq_memory_subjects_user  ON memory_subjects (user_id)  WHERE user_id  IS NOT NULL;
CREATE UNIQUE INDEX uq_memory_subjects_agent ON memory_subjects (agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX idx_memory_subjects_owner ON memory_subjects (owner_user_id);
```

Subjects are created lazily the first time something is written. Template agents (`agents.is_template = true`) never get a subject.

### 3.4 Entries — NEW

```sql
CREATE TYPE memory_entry_type AS ENUM
  ('profile', 'preference', 'fact', 'decision', 'episode', 'skill');
CREATE TYPE memory_sensitivity AS ENUM ('shareable', 'private');
CREATE TYPE memory_entry_status AS ENUM ('active', 'superseded', 'archived');
CREATE TYPE memory_source_kind AS ENUM ('conversation', 'task', 'manual', 'agent_profile');

CREATE TABLE memory_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id      uuid NOT NULL REFERENCES memory_subjects(id) ON DELETE CASCADE,
  type            memory_entry_type NOT NULL,
  content         text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 1000),
  importance      smallint NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  confidence      real NOT NULL DEFAULT 0.7 CHECK (confidence BETWEEN 0 AND 1),
  sensitivity     memory_sensitivity NOT NULL DEFAULT 'shareable',
  status          memory_entry_status NOT NULL DEFAULT 'active',
  supersedes_id   uuid REFERENCES memory_entries(id) ON DELETE SET NULL,
  valid_from      timestamptz NOT NULL DEFAULT now(),
  valid_to        timestamptz,
  source_kind     memory_source_kind NOT NULL,
  source_id       uuid,          -- conversations.id or ai_tasks.id (owner-only)
  source_message_id bigint,      -- conversation_messages.id / ai_task_messages.id
  edited_by_owner boolean NOT NULL DEFAULT false,
  tsv             tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  embedding       vector(1536),  -- dimension fixed per deployment (see §6.3)
  embedding_model varchar(150),
  last_used_at    timestamptz,
  use_count       integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_memory_entries_subject ON memory_entries (subject_id, status, created_at DESC);
CREATE INDEX idx_memory_entries_tsv ON memory_entries USING gin (tsv);
CREATE INDEX idx_memory_entries_embedding ON memory_entries
  USING hnsw (embedding vector_cosine_ops) WHERE status = 'active';
CREATE INDEX idx_memory_entries_pending_embed ON memory_entries (created_at) WHERE embedding IS NULL;
```

**Entry types:**

| Type | Example (content) |
|---|---|
| `profile` | "Bertanggung jawab atas verifikasi klaim santunan wilayah Jawa Barat." |
| `preference` | "Lebih suka ringkasan dalam bentuk poin dan tabel." |
| `fact` | "SOP klaim terbaru mewajibkan surat keterangan polisi untuk kecelakaan lalu lintas." |
| `decision` | "Disepakati batas waktu verifikasi klaim menjadi 3 hari kerja (Okt 2026)." |
| `episode` | "Menangani keluhan pemohon terkait keterlambatan pembayaran klaim pada 12 Nov 2026." |
| `skill` | "Terbiasa menyusun laporan mingguan klaim dari data Excel." |

### 3.5 Doors (grants) — NEW

```sql
CREATE TABLE memory_doors (
  subject_id     uuid PRIMARY KEY REFERENCES memory_subjects(id) ON DELETE CASCADE,
  enabled        boolean NOT NULL DEFAULT false,
  exposed_types  memory_entry_type[] NOT NULL
                 DEFAULT ARRAY['profile','fact','decision','skill']::memory_entry_type[],
  updated_by     uuid NOT NULL REFERENCES users(id),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
```

- **Default:** closed. `preference` and `episode` are not exposed by default because they are the most personal; the owner can add them.
- **Agent doors:** for agents, the door default is `enabled = true` (the owner is the leader in most cases), still editable by the owner.

### 3.6 Open doors per working context — NEW

This mirrors the existing `conversation_connectors` table (`1700000019000-mcp-tools-conversation-connectors.ts`).

```sql
CREATE TABLE conversation_memory_doors (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  subject_id      uuid NOT NULL REFERENCES memory_subjects(id) ON DELETE CASCADE,
  opened_by       uuid NOT NULL REFERENCES users(id),
  opened_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, subject_id)
);

CREATE TABLE task_memory_doors (
  task_id    uuid NOT NULL REFERENCES ai_tasks(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES memory_subjects(id) ON DELETE CASCADE,
  opened_by  uuid NOT NULL REFERENCES users(id),
  opened_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, subject_id)
);
```

A row here only expresses *intent*. Whether it is effective is re-checked per query (§6.1).

### 3.7 Access log — NEW

```sql
CREATE TYPE memory_access_action AS ENUM ('door_opened', 'door_closed', 'entries_read');

CREATE TABLE memory_access_log (
  id              bigserial PRIMARY KEY,
  subject_id      uuid NOT NULL REFERENCES memory_subjects(id) ON DELETE CASCADE, -- whose memory
  actor_user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,           -- who
  action          memory_access_action NOT NULL,
  context_kind    varchar(20) NOT NULL CHECK (context_kind IN ('conversation', 'task')),
  context_id      uuid NOT NULL,
  entry_count     integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_memory_access_subject ON memory_access_log (subject_id, created_at DESC);
```

Additionally, `door_opened` and `door_closed` are recorded through the existing `AuditService.record()` (`apps/api/src/modules/audit/audit.service.ts`) so they show up in the Audit admin.

### 3.8 Migrating agent memory

`agents.memory` (free text, added in `1700000020000-personal-agents.ts` and injected by `apps/api/src/modules/ai/agents/agent-prompt.ts`) is migrated one-off.

- Each non-empty `agents.memory` becomes one subject (`kind = 'agent'`) and one or more entries (`source_kind = 'agent_profile'`, split by line or paragraph, type `profile`).
- The column stays as the agent's "instructions memory" in the editor for now. Retrieval reads from `memory_entries`.

---

## 4. Reach — who is "my subordinate"

The reporting line is **derived from departments**. A user is a leader of department D if `departments.head_user_id = user`. Reach is transitive down the department tree.

```sql
-- $1 = leader user id
WITH RECURSIVE led AS (
  SELECT id FROM departments WHERE head_user_id = $1 AND is_active
  UNION
  SELECT d.id FROM departments d JOIN led ON d.parent_id = led.id WHERE d.is_active
)
SELECT ms.id AS subject_id
  FROM memory_subjects ms
  JOIN users u ON u.id = ms.user_id
 WHERE ms.kind = 'user'
   AND u.department_id IN (SELECT id FROM led)
   AND u.id <> $1
   AND u.status = 'active'
UNION
SELECT ms.id
  FROM memory_subjects ms
  JOIN agents a ON a.id = ms.agent_id
 WHERE ms.kind = 'agent'
   AND a.owner_user_id = $1
   AND a.status = 'active';
```

**Rules:**

- **R1 — Transitive.** The head of a parent department reaches everyone in child departments, including the child departments' heads.
- **R2 — Own agents.** A user always reaches their own personal agents, even without being a department head.
- **R3 — No self.** The leader's own book is always in scope (§6.1) and is not a "door".
- **R4 — Disabled things drop out.** Disabled users, inactive departments and inactive agents are excluded.
- **R5 — Cycles.** Departments already prevent cycles via the admin. `UNION` (not `UNION ALL`) keeps the CTE terminating regardless.
- **R6 — Subordinates' agents.** Agents owned by a subordinate are **not** in reach in P1. In P2 they are reachable when the subordinate's own door is granted and `exposed_types` includes agents (see §11).
- **R7 — Superadmin.** `isSuperadmin` gets **no** special reach. Memory is about the reporting line, not admin power.

---

## 5. Write path — the psychiatrist takes notes

### 5.1 Triggers

| Event | Where it happens today | Memory job |
|---|---|---|
| Assistant turn completed in Multi Brain / Partner | `apps/api/src/modules/ai/conversations.service.ts` (after message persisted) | `extract(conversation, lastTurn)` for the **user's** subject |
| Task finished (`status` → completed) | `apps/api/src/modules/ai/agents/task-runner.service.ts` | `extract(task)` for the **user's** subject and each participating **agent's** subject |
| Owner adds a note manually | NEW endpoint (§7) | Insert directly, `source_kind = 'manual'` |

Jobs run **asynchronously**, outside the request and the SSE stream. They:
- use a Postgres-backed queue table or the existing in-process scheduling pattern;
- must not slow chat;
- debounce each conversation (at most one extraction per 60 s, batching the turns since the last run).

### 5.2 Pipeline

```
turn/task text
  → guardrails masker (existing)                    -- PII removed before any LLM call or storage
  → LLM extractor (structured JSON)                 -- candidate entries
  → for each candidate:
       retrieve top-5 similar active entries of the same subject (hybrid, §6.2)
       LLM/heuristic reconcile → ADD | UPDATE(id) | SUPERSEDE(id) | IGNORE
  → write entries (+ embedding)                     -- embedding failure ⇒ NULL, re-queued
  → bump subject's "last updated"
```

### 5.3 Extractor contract

**System prompt (summary):** "You are a clinical note-taker. From the dialogue, extract durable facts about the USER (not about the world in general and not about the AI). Prefer few, precise notes. Never record secrets, credentials, health, religion, or other special-category personal data. Write in the language of the dialogue."

**Output JSON schema:**

```json
{
  "entries": [
    {
      "type": "profile | preference | fact | decision | episode | skill",
      "content": "string, ≤ 300 chars, third person, self-contained",
      "importance": 1,
      "confidence": 0.0,
      "sensitivity": "shareable | private"
    }
  ]
}
```

**Rules:**

- At most 5 entries per extraction.
- Drop anything with `confidence < 0.5`.
- If the extractor marks something `private`, it is stored as private. The owner can change it later.
- Content must be self-contained. Write "Dina menyetujui…", not "dia menyetujui…".

### 5.4 Reconciliation

| Decision | Effect |
|---|---|
| `ADD` | Insert new entry |
| `UPDATE(id)` | Same meaning, better wording or detail: update content, re-embed, keep id |
| `SUPERSEDE(id)` | Contradicts an older entry: old → `status = 'superseded'`, `valid_to = now()`; new row has `supersedes_id = id` |
| `IGNORE` | Duplicate or not durable |

**Never touch** an entry where `edited_by_owner = true`; at most `ADD` alongside it.

### 5.5 Importance decay

There is no physical deletion by the system. At retrieval time the effective score decays with age:

`recency = exp(-age_days / 180)`

`decision` and `profile` entries use a half-life of 365 days.

### 5.6 Cost controls

- **Model:** the extractor uses the cheapest model configured in the AI provider settings (new config key `memory.extractorModel`).
- **Daily budget:** a per-user cap (`memory.maxExtractionsPerUserPerDay`, default 50). Over budget, jobs are skipped and logged.
- **Token accounting:** token usage is recorded like existing AI calls.

---

## 6. Read path — opening doors

### 6.1 Scope resolution (per query, server-side)

```
scope(user, context) =
    { self_subject(user) }
  ∪ ( open_doors(context)                 -- conversation_memory_doors / task_memory_doors
      ∩ reach(user)                       -- §4, computed now
      ∩ { s | memory_doors(s).enabled } )  -- granted now
```

Entry filter for non-self subjects:
- `status = 'active'`
- `sensitivity = 'shareable'`
- `type = ANY(memory_doors.exposed_types)`

Self subject: all active entries, including private ones.

If an open-door row is no longer effective (revoked, out of reach), it stays in the table but is ignored. The UI shows it as "Pintu ditutup oleh pemilik".

### 6.2 Hybrid retrieval

All in one Postgres query, with the scope filter applied **before** ranking:

1. **Vector top-k:** `ORDER BY embedding <=> $queryEmbedding LIMIT 40`, restricted to scope.
2. **Full-text top-k:** `ts_rank(tsv, websearch_to_tsquery('simple', $q)) LIMIT 40`, restricted to scope. Same approach as `knowledge.service.ts` (~line 533).
3. **Reciprocal Rank Fusion:** `rrf = Σ 1 / (60 + rank_i)`.
4. **Final score:** `rrf × (0.6 + 0.4 × recency) × (0.8 + 0.05 × importance)`.
5. **Diversity cap:** at most 8 entries per subject, 20 in total.
6. **Usage tracking:** update `last_used_at` and `use_count`. Write one `memory_access_log` row (`entries_read`) per non-self subject that contributed.

**Why hybrid:**
- Memories are short and paraphrased. "Siapa yang mengeluh soal klaim lambat?" should match "Pemohon frustrasi karena pembayaran tertunda", and only embeddings catch that.
- Names, codes and numbers (SOP-HSE-003, nomor klaim) are matched exactly, and only full-text guarantees that.
- RRF needs no score calibration between the two.

### 6.3 Embeddings — NEW provider capability

- Add `embed(texts: string[]): Promise<number[][]>` to the provider layer (`apps/api/src/modules/ai/providers/types.ts`). Implement it in `openai-compatible.provider.ts` against the standard `/embeddings` endpoint.
- New config keys:
  - `memory.embeddingProvider`
  - `memory.embeddingModel`
  - `memory.embeddingDimensions` (default 1536; the migration uses this dimension)
- Changing the model requires a re-embed job. Entries whose `embedding_model` doesn't match the current one are treated as `embedding IS NULL`. Full-text still finds them meanwhile.
- **Failure:** if embedding fails at query time, run full-text only and log a warning.

### 6.4 Injection into the prompt

Retrieved entries are injected as a separate system block, grouped and attributed by subject:

```
## Memori yang relevan
### Dari memori Anda
- [m1] Lebih suka ringkasan dalam bentuk poin.
### Dari memori Budi Santoso (dibuka melalui pintu)
- [m2] Disepakati batas verifikasi klaim 3 hari kerja (Okt 2026).
### Dari memori Agen Notifikasi Klaim (dibuka melalui pintu)
- [m3] Template SMS pemohon klaim menggunakan nomor tiket di awal pesan.

Gunakan memori hanya jika relevan. Sebutkan sumbernya, mis. "menurut memori Budi".
Jangan menyimpulkan hal pribadi di luar yang tertulis.
```

- **Budget:** at most `memory.maxContextTokens` (default 1,500 tokens). Drop the lowest-ranked entries first.
- The assistant message stores which `[mN]` ids were provided (new `conversation_messages.memory_refs jsonb`, **NEW** column). The UI can then show "Memori yang digunakan" citations, similar to `ToolTraceList.vue`.

---

## 7. API contract (NestJS, new module `apps/api/src/modules/memory/`)

DTOs live in `packages/shared/src/dto/memory.dto.ts` (**NEW**), following `dashboard.dto.ts`. All mutating routes require the CSRF header like the rest of the API.

| Method & path | Permission | Purpose |
|---|---|---|
| `GET /api/memory/me/entries?type&status&search&page&pageSize` | `ai.memory.self.manage` | My book (includes private) |
| `POST /api/memory/me/entries` | `ai.memory.self.manage` | Add a manual note |
| `PATCH /api/memory/me/entries/:id` | `ai.memory.self.manage` | Edit content, type or sensitivity (sets `edited_by_owner`) |
| `DELETE /api/memory/me/entries/:id` | `ai.memory.self.manage` | Hard delete (owner's right) |
| `GET /api/memory/me/door` | `ai.memory.self.manage` | My door settings |
| `PUT /api/memory/me/door` | `ai.memory.self.manage` | `{ enabled, exposedTypes }` |
| `GET /api/memory/me/access-log` | `ai.memory.self.manage` | "Siapa yang membuka pintu saya" |
| `GET /api/memory/agents/:agentId/entries` / `PUT …/door` | owner of agent + `ai.agents.manage` | Agent's book and door |
| `GET /api/memory/reach` | `ai.memory.doors.open` | Reachable subjects with their door state (granted/closed) and entry counts per exposed type. No content. |
| `GET /api/memory/contexts/:kind/:id/doors` | owner of context | Open doors for a conversation/task |
| `PUT /api/memory/contexts/:kind/:id/doors` | `ai.memory.doors.open` + owner of context | `{ subjectIds: string[] }`. Rejects any id that is not reachable and granted (403 with the offending ids). |

Leaders **never** get an endpoint that lists a subordinate's entries. Entries only reach the leader inside AI answers, attributed and audited.

---

## 8. Permissions

Add to `PERMISSION_CATALOG` in `packages/shared/src/permissions.ts`, using the existing `ai.<feature>.<verb>` pattern:

| Id | Meaning | Default roles |
|---|---|---|
| `ai.memory.self.manage` | View and manage my own memory book and door | Everyone with `ai.workspace.access` |
| `ai.memory.doors.open` | Open granted doors of subjects in my reach | Manager/leader roles |

Setting `departments.head_user_id` reuses the existing `rbac.departments.manage`.

---

## 9. UI requirements (Vue 3, Ca* components, Fluent Green tokens)

1. **"Memori Saya"** (new route under Ruang Kerja AI, e.g. `/workspace/memory`):
   - The book is shown as a `CaTable` with type chips (`CaSegmented` filter), search, and sensitivity toggle per row ("Pribadi" / "Dapat dibagikan").
   - Row actions use `CaRowMenu`: Ubah, Jadikan pribadi, Hapus.
   - "Tambah catatan" dialog.
   - Each row has a source link to the original conversation/task (owner only).
2. **"Pintu saya"** panel on the same page:
   - Switch "Izinkan atasan membuka pintu memori saya".
   - Checkboxes for exposed types.
   - The "Siapa yang membuka pintu saya" table, from the access log.
3. **"Pintu memori" bar** in Multi Brain, Partner and the Subordinate task composer:
   - Same placement and interaction as `apps/web/src/components/ai/ConversationConnectorsBar.vue`.
   - One chip per reachable subject: avatar, name, a person/agent icon.
   - Chip states:
     - **Terbuka** (green, `--ca-color-brand` fill).
     - **Tertutup** (neutral).
     - **Tidak diizinkan** (disabled, tooltip "Pemilik belum membuka izin").
   - Only rendered when `auth.can('ai.memory.doors.open')` and reach is non-empty.
4. **Citations:** under an assistant message, a collapsible "Memori yang digunakan (n)" list showing the content and the owner's name.
5. **Departments admin:** a "Kepala departemen" user picker in the department form (`apps/web/src/views/admin/DepartmentsAdminView.vue`). The org chart shows the head.
6. **Agent editor:** a "Memori" tab in `AgentEditorDialog.vue` listing the agent's entries and its door switch.
7. **Docs:** add a chapter to `apps/web/src/docs/chapters.ts` ("Memori dan pintu memori") once shipped.

All strings go in `apps/web/src/i18n/locales/id.ts` under a new `memory` block.

---

## 10. Non-functional requirements

| Area | Requirement |
|---|---|
| Privacy | PII masker runs before extraction and before storage. Special-category data must never be stored (extractor rule + guardrail terms). |
| Isolation | Every query against `memory_entries` goes through a single `MemoryScopeService.resolve(userId, context)`. A unit test asserts no other code path selects from `memory_entries` without it. |
| Deletion | User disabled → their door is treated as closed (R4). User deleted → `ON DELETE CASCADE` removes the subject and entries. Agent deleted → same. Owner can delete any entry instantly (hard delete). |
| Retention | Configurable `memory.retentionDays` (default: none). `episode` entries older than the retention are archived by a nightly job. |
| Performance | Retrieval p95 < 300 ms with 1M entries and 20 subjects in scope. Extraction off the request path. Chat latency increases by < 150 ms (retrieval + embedding of the query). |
| Cost | Extraction and embedding token usage is recorded per user and visible in existing token usage reporting. |
| Observability | Log extraction counts (added/updated/superseded/ignored), embedding failures and queue depth. Health check reports `pgvector` availability. |
| Audit | Door open/close goes to `AuditService.record()` and `memory_access_log`. Entry reads go to `memory_access_log` only (high volume). |

---

## 11. Phasing

| Phase | Scope |
|---|---|
| **P1** | Migration (pgvector, subjects, entries, doors, context doors, access log, `head_user_id`); Memory Service with write path (conversations + tasks); hybrid retrieval; "Memori Saya" + "Pintu saya"; "Pintu memori" bar in Multi Brain/Partner/Subordinate; citations; department head picker; permissions; agent memory migration |
| **P2** | Subordinates' agents in reach (R6); agent-to-agent doors inside agent groups (`agent_groups`); "Kotak tinjauan memori" inbox where users approve new entries before they become shareable |
| **P3** | Consolidation: periodic per-subject summary entries ("ringkasan profil"); team-level digest for leaders built only from open doors; Mind Map (`ai.mindmap.team.read`) integration showing memory themes |

---

## 12. Acceptance criteria and test scenarios

Integration tests go in `apps/api/test/integration/memory.e2e-spec.ts`, following `dashboard.e2e-spec.ts`. Seed: department **Klaim** (head = Manager M), users **A** and **B** in Klaim, agent **C** owned by M, user **X** in another department.

| # | Scenario | Expected |
|---|---|---|
| AC1 | M opens no doors and asks a question | Only M's own entries are retrieved |
| AC2 | A and B have granted; M opens **B only** | Retrieved entries come from M and B; **none** from A |
| AC3 | M opens B and C | Entries from M, B and C, attributed by name in the prompt block |
| AC4 | M tries to open **X**'s door (not in reach) | `PUT …/doors` → 403 listing X |
| AC5 | A has not granted (door disabled); M tries to open A | 403; the chip shows "Tidak diizinkan" |
| AC6 | B revokes the grant while M's conversation has B open | The next retrieval excludes B; a `door_closed` effect is visible in the UI |
| AC7 | B marks an entry private | It is never returned to M, even with B's door open |
| AC8 | B's door exposes only `fact` | M never receives B's `decision`, `episode`… entries |
| AC9 | User without `ai.memory.doors.open` calls `/api/memory/reach` | 403 |
| AC10 | Any retrieval that reads B's entries | One `memory_access_log` row (subject B, actor M, `entries_read`) and B sees it in "Siapa yang membuka pintu saya" |
| AC11 | Conversation text contains a phone number / NIK | The stored entry contains the masked token, never the raw value |
| AC12 | Contradicting decision extracted later | Old entry `superseded`, new entry has `supersedes_id`; only the new one is retrieved |
| AC13 | Owner edits an entry | `edited_by_owner = true`; later extractions never overwrite it |
| AC14 | Embedding provider down | Write succeeds with `embedding = NULL`; retrieval falls back to full-text; the re-embed job fills it later |
| AC15 | Head of the parent department of Klaim | Reaches A, B and M (R1) |
| AC16 | B is disabled | B disappears from M's reach, and open doors to B are ignored |

Web unit tests (Vitest) cover:
- the door chip states;
- that the "Pintu memori" bar is hidden without permission or reach.

---

## 12a. Implementation notes (P1, as built)

Where the build differs from or adds to the sections above:

- **pgvector is optional.**
  - Migration `1700000025000-central-memory.ts` creates the `embedding` column and HNSW index only when the server offers the `vector` extension (the current `postgres:16-alpine` host does not).
  - Without it, retrieval is full-text only, and "Pencarian semantik" shows "Teks penuh".
  - After switching to a pgvector-enabled Postgres 16 image, run `npm run db:memory-vector`. The API then back-fills embeddings every 5 minutes.
- **One-call extraction.** Extraction and reconciliation (§5.2–5.4) happen in a single LLM call.
  - The model receives up to 30 relevant existing entries, picked by full-text search plus the 10 most important.
  - It returns `add` / `update` / `supersede` operations. Unknown or owner-edited targets fall back to `add`.
  - The parser accepts a bare array, a single object, or an `entries` key, because small local models (e.g. qwen2.5:3b) rarely follow the exact wrapper.
- **Restart-safe scheduling.**
  - `conversations.memory_watermark` (last processed message id) and `ai_tasks.memory_extracted_at` record progress.
  - On boot, conversations and tasks from the last 24 h that were not yet processed are re-queued.
  - `memory_extraction_runs` holds the per-user daily quota and run statistics.
- **Redaction.** Memory always redacts structured personal data (NIK, phone, email, address, account numbers, …) with permanent `[label]` text, independent of the Guardrails toggle. Names are kept because notes depend on them.
  - When Guardrails is on, names are also masked before embedding.
  - Chat prompts go through Guardrails as usual: the memory block is part of the system prompt.
- **Working agent.** In a task, the working agent reads its own book automatically. Entries imported from `agents.memory` are skipped there, since that text is already in the agent prompt.
- **UI.**
  - The agent editor has a "Memori" section, not a tab.
  - The "Pintu memori" selector appears in the New Task dialog for agent and group tasks only. The general-assistant task path does not use memory yet.
  - The Docs chapter (§9.7) is not written yet.
- **Configuration.** `app_config` keys:
  - `ai.memory_enabled`
  - `ai.memory_embedding_model`
  - `ai.memory_extractor_model` (empty = the active chat model)
  - `ai.memory_max_context_tokens`
  - `ai.memory_max_extractions_per_day`
  - `ai.memory_retention_days`
- **Tests.**
  - `apps/api/test/integration/memory.e2e-spec.ts` covers AC1–AC13 and AC16, plus task doors.
  - `apps/api/test/unit/memory.spec.ts` covers ranking, prompt block, tsquery, parsing and redaction.
  - `apps/web/src/components/ai/MemoryDoorsBar.spec.ts` covers the chip states.
  - AC14 (embedding provider down) and AC15 (parent-department head) are exercised only manually.

## 13. Open questions

1. **Matrix organisations.** A leader who leads people across departments without being head (project leads) isn't covered by department-derived reach. Would an optional `memory_reach_overrides` table (admin-managed) be acceptable?
2. **Retention.** Is there a regulatory retention period for distilled notes about employees (UU PDP)? This determines the `memory.retentionDays` default.
3. **Embedding provider.** Which provider and model are allowed for embeddings (data residency)? This fixes `memory.embeddingDimensions` before the migration runs.
4. **Notification.** Should a subordinate get a notification (via the existing notifications menu) the first time a leader opens their door, or is the access log enough?
5. **Review gate.** Should new extracted entries be `private` until the owner reviews them (P2 inbox), or `shareable` immediately as specified for P1?
