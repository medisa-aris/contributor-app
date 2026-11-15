# LLM Requirement — Multi-Model per Provider ("Katalog Model & Kuota")

> Status: draft for implementation · Audience: engineers and coding agents (LLM) · Language: English (UI strings in Bahasa Indonesia)
>
> Items marked **NEW** do not exist in the codebase yet. Everything else refers to existing code.

---

## 1. Background and goal

### 1.1 Today

The API talks to four providers through two adapters:

| Provider | Adapter | Credential (env) |
|---|---|---|
| OpenRouter | `OpenAiCompatibleProvider` | `OPENROUTER_API_KEY` |
| OpenAI | `OpenAiCompatibleProvider` | `OPENAI_API_KEY` |
| Ollama | `OpenAiCompatibleProvider` | `OLLAMA_BASE_URL` (no key) |
| Anthropic | `AnthropicProvider` | `ANTHROPIC_API_KEY` |

But the whole deployment runs on **one provider and one model**:

- `AI_PROVIDER` + `AI_MODEL` + `AI_BASE_URL` (`apps/api/src/config/configuration.ts`) pick the only active pair.
- `AiGatewayService.resolveAdapter()` (`apps/api/src/modules/ai/gateway.service.ts`) caches **one** adapter per process.
- `buildRequest()` always sends `model: this.settings().aiModel`.
- `activeModel()` is read by `task-runner.service.ts` and by `GET /api/admin/providers`, which only shows the model on the default provider.
- Changing the model means editing `.env` and restarting the API.
- Token usage is stored per message (`conversation_messages.tokens_in/out`) and per task (`ai_tasks.tokens_in/out`). There is no limit and no aggregation per user or period.

### 1.2 Goal

1. **Provider configuration stays in `.env`.**
   - Credentials and endpoints for OpenRouter, OpenAI, Anthropic and Ollama are set by whoever deploys the app, never in the UI.
   - All four may be configured at the same time.
2. **Admin** can choose, test and enable **several models per configured provider** in an admin screen.
3. **Admin chooses one default model.** Every user may always use it without a grant. It is **unlimited by default**, but the admin may set an optional per-user limit (tokens per day/week and/or requests per minute) and set it back to unlimited at any time.
4. **Admin or the user's leader** grants each person (or a whole team) any **other** model, each with a **maximum token count per day or per week**. Users can't use a non-default model nobody granted them.
5. **Leaders can also limit the agents of their subordinates.** Leaders and their reach come from the **department structure with department heads**, exactly as in central memory (`docs/LLM-requirement.md` §4).
6. **Users** pick the default model or one of their granted models in **Multi Brain** and **Partner** conversations.
7. **Agents** (admin templates and personal agents) have a configurable model.
8. **Long-running work** ("Kerja panjang"): conversations and agent tasks can run for many minutes and many tool steps. They survive disconnects and restarts, manage their context instead of truncating it, and show live progress (§14).

### 1.3 Glossary

| Term | Definition |
|---|---|
| **Provider** | One of `openrouter`, `openai`, `anthropic`, `ollama`. Configured only through `.env`. |
| **Configured provider** | A provider whose credential is present in env (for Ollama: its base URL). Only configured providers can be used. |
| **Model** | One provider model id (e.g. `google/gemini-3.1-flash-lite`, `claude-sonnet-5-5`, `llama3.2`), registered in the catalog by the admin. |
| **Catalog** | All models the admin has added. Each has a status: `draft`, `enabled` or `disabled`. |
| **Default model** | The one model the admin marks as default. Every active user may use it without any grant. |
| **Default-model limit** | Optional per-user limit on the default model, set by the admin: a token limit per day or week and/or a request rate per minute. Each is unlimited (`NULL`) by default (§4.1a). |
| **Model test** | A short live call that checks the model answers, streams, and supports tools/vision. |
| **Grant** | A rule saying "this person / this team / this agent may use non-default model M, at most N tokens per day (or per week)". Created by an admin or a leader. |
| **Department head** | `departments.head_user_id`, the existing column introduced by central memory and set in the Departments admin screen. It is the only source of who leads whom. |
| **Leader** | A user holding `ai.models.grant.manage` who is the head of at least one active department (§4.5). |
| **Reach** | Everything a leader may grant to: (a) **departments** they head and all sub-departments; (b) **people** in those departments, including the heads of sub-departments, excluding the leader; (c) **subordinate agents**: personal agents owned by the leader or by anyone in (b). |
| **Team** | A department in reach as one grant target, optionally including its sub-departments. Admins can target any department or everyone. |
| **Subordinate agent** | A personal agent (`agents.owner_user_id`) inside a leader's reach. A grant on an agent narrows what that agent may use (§6.9). |
| **Quota** | The token limit (input + output) of a grant for one period. Always counted **per person** (and per agent for agent grants). A grant to a team gives every member their own counter, and there are no shared pools. |
| **Period** | `day` (00:00 → 23:59) or `week` (Monday 00:00 → Sunday 23:59), in `app.timezone` (default `Asia/Jakarta`). |
| **Usage ledger** | An append-only record of every LLM call: who, which model, how many tokens, for what. |

---

## 2. Core principles (non-negotiable)

1. **Provider config lives in `.env` only.**
   - No endpoint accepts or returns an API key or base URL.
   - The admin screen shows each provider's status read-only ("Terkonfigurasi" / "Belum dikonfigurasi").
2. **One default model, open to all, unlimited unless the admin says otherwise.**
   - The admin picks exactly one default model, and every active user may use it without a grant.
   - It is unlimited out of the box. The admin may add a per-user token limit and/or rate limit (§4.1a) and remove it again.
   - `AI_PROVIDER` + `AI_MODEL` become the default, so a deployment that changes nothing keeps working. *Implemented at runtime:* `ModelCatalogService.ensureDefault()` inserts them when the catalog has no default (first boot after the migration, or an emptied test DB), so the migration itself does not read env.
   - Grants on the default model are rejected because it is already open to all.
3. **Strict by default for everything else.**
   - The migration creates **no** grant rows.
   - A non-default model is usable only when it is `enabled` and a grant covers the user.
   - Adding or enabling a model in the catalog gives nobody access.
4. **Grants are per person.**
   - A team grant is a shortcut: each member gets the same model and the same limit, counted separately.
5. **Server-side enforcement.**
   - Every LLM call goes through one `ModelAccessService.authorize()` (§6.1).
   - The client sends only a `modelId`, and the server decides.
   - Greying out a model in the UI is a convenience, not the control.
6. **One ledger.**
   - Every call that consumes tokens writes one usage row: retries, tool-loop iterations, regenerations, agent sub-tasks and model tests included.
   - Quotas are computed from this ledger only.
7. **Guardrails apply to every model.** Each adapter built by the new adapter registry is wrapped by `GuardedProvider`, exactly like today.
8. **Audit.** Catalog changes, tests, grant changes and quota exhaustion are recorded through `AuditService.record()`.

---

## 3. Provider configuration (`.env`)

### 3.1 Variables

Existing variables keep their meaning. New per-provider base URLs replace the single `AI_BASE_URL`, so that several providers can run at once.

| Variable | Status | Meaning |
|---|---|---|
| `OPENROUTER_API_KEY` | existing | Enables OpenRouter |
| `OPENAI_API_KEY` | existing | Enables OpenAI |
| `ANTHROPIC_API_KEY` | existing | Enables Anthropic |
| `OLLAMA_BASE_URL` | existing | Enables Ollama (no key) |
| `OPENROUTER_BASE_URL` | **NEW**, optional | Default `https://openrouter.ai/api/v1` |
| `OPENAI_BASE_URL` | **NEW**, optional | Default `https://api.openai.com/v1` (also for Azure/compatible gateways) |
| `ANTHROPIC_BASE_URL` | **NEW**, optional | Default `https://api.anthropic.com` |
| `AI_TIMEOUT_MS` | existing | Timeout for every provider call |
| `AI_PROVIDER`, `AI_MODEL` | existing → **seed only** | Read by the migration to create the default model. Afterwards the default is changed in the admin screen. |
| `AI_BASE_URL` | existing → **deprecated** | Still honoured as the base URL of `AI_PROVIDER` when the provider-specific variable is unset. Logs a deprecation warning at boot. |

- Validate the new variables in `apps/api/src/config/env.validation.ts` and document them in `.env.example` and `docs/runbook.md`.
- Changing a key or URL still requires an API restart, as today.

### 3.2 Provider status

`ProviderRegistryService` (§6.1) computes, at boot, per provider:

- `configured` (credential present);
- `baseUrl` (shown to the admin);
- the result of the last connectivity check (in memory, refreshed by "Periksa koneksi").

Models of an **unconfigured** provider stay in the catalog but are unusable. The picker hides them, and calls fail with `AI_MODEL_UNAVAILABLE` (`provider_unconfigured`).

---

## 4. Data model

PostgreSQL, raw-SQL migration **NEW** `apps/api/src/database/migrations/1700000026000-multi-model.ts`, following the style of `1700000022000-guardrails.ts` (tables + permissions + menu items, idempotent inserts).

### 4.1 Model catalog — NEW

```sql
CREATE TYPE ai_provider_code AS ENUM ('openrouter', 'openai', 'anthropic', 'ollama');
CREATE TYPE ai_model_status  AS ENUM ('draft', 'enabled', 'disabled');

CREATE TABLE ai_models (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          ai_provider_code NOT NULL,
  model_key         varchar(200) NOT NULL,          -- exact id sent to the provider
  display_name      varchar(120) NOT NULL,          -- "Gemini 3.1 Flash Lite"
  description       text,                           -- shown in the picker
  status            ai_model_status NOT NULL DEFAULT 'draft',
  is_default        boolean NOT NULL DEFAULT false,
  leader_grantable  boolean NOT NULL DEFAULT true,  -- false = only admins may grant it
  supports_tools    boolean NOT NULL DEFAULT false,
  supports_vision   boolean NOT NULL DEFAULT false,
  supports_stream   boolean NOT NULL DEFAULT true,
  context_window    integer,
  max_output_tokens integer,                        -- cap applied on top of AI_LIMITS
  cost_tier         smallint CHECK (cost_tier BETWEEN 1 AND 3), -- 1 hemat · 2 standar · 3 premium
  last_test_at      timestamptz,
  last_test_ok      boolean,
  last_test_latency_ms integer,
  last_test_error   text,
  sort_order        integer NOT NULL DEFAULT 0,
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, model_key)
);
CREATE UNIQUE INDEX uq_ai_models_default ON ai_models (is_default) WHERE is_default;
```

**Rules:**

- **Status:** `draft` → `enabled` requires the latest test to be successful (`last_test_ok = true`). `enabled` → `disabled` is always allowed.
- **Default model:**
  - There is exactly one default, and it must be `enabled` on a configured provider.
  - The default can't be disabled until another model is made default.
  - The default is always allowed to every active user. No grant is needed, and no grant may be created for it. Its only limits are the **default-model limits** (§4.1a), which are unlimited unless the admin sets them.
  - **Changing the default** (`POST /admin/ai/models/:id/default`) moves that open access, with the current default-model limits, to the new model immediately. The dialog warns: "Semua pengguna akan dapat memakai model ini {tanpa batas token | dengan batas N token per hari}."
  - **Grants on the new default:** existing grants on the model that becomes default are kept but ignored while it is the default. They take effect again if it stops being default. The UI marks them "Tidak berlaku — model bawaan".
  - **Pick a cheap model:** because usage is unlimited by default, the admin should choose a low-cost model as the default. The UI shows the cost tier next to the "Jadikan default" action.

### 4.1a Default-model limits — NEW (app config)

Three keys are added to `APP_CONFIG_KEYS` / `APP_CONFIG_DEFINITIONS` in `packages/shared/src/config-keys.ts`. They are not public and are only editable through the "Model AI" admin screen, like the guardrails keys (`isGuardrailConfigKey`):

| Key | Type | Default | Meaning |
|---|---|---|---|
| `ai.default_model.token_limit` | integer or `null` | `null` (unlimited) | Max tokens (input + output) **per user** per period on the default model |
| `ai.default_model.period` | `'day'` \| `'week'` | `'day'` | Period of the token limit |
| `ai.default_model.requests_per_minute` | integer or `null` | `null` (unlimited) | Max provider calls **per user** per rolling 60 seconds on the default model. Each tool-loop iteration counts as one call. |

- **Scope:** the limits are attached to "whatever model is default", not to a model row. Changing the default keeps them.
- **Who is limited:** they apply equally to every user. Superadmins are exempt, as for grants. Calls that don't count toward quotas (`counts_toward_quota = false`, e.g. model tests, memory, attachment summaries) are not limited.
- **Agents:** agent runs on the default model consume the task owner's default-model limit. Agent grants (§6.9) never cover the default, so they don't narrow it.
- **Unlimited again:** setting a value back to `null` removes the limit on the next request. The setting is cached with the grant cache (§6.4) and bumps `ai_models_meta.version`.
- **Capability flags:** the test fills them (§6.4). The admin can override them.
- **`leader_grantable`:** lets the admin keep expensive models (e.g. premium tier) admin-only.

### 4.2 Grants — NEW

```sql
CREATE TYPE grant_target  AS ENUM ('user', 'department', 'agent', 'everyone');
CREATE TYPE quota_period  AS ENUM ('day', 'week');

CREATE TABLE ai_model_grants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type   grant_target NOT NULL,
  -- user → users.id · department → departments.id · agent → agents.id · everyone → NULL
  target_id     uuid,
  include_sub_departments boolean NOT NULL DEFAULT true, -- department only
  model_id      uuid NOT NULL REFERENCES ai_models(id) ON DELETE CASCADE,
  token_limit   bigint CHECK (token_limit IS NULL OR token_limit > 0), -- NULL = no limit
  period        quota_period NOT NULL DEFAULT 'day',
  granted_scope varchar(10) NOT NULL CHECK (granted_scope IN ('admin', 'leader')),
  note          varchar(300),
  created_by    uuid NOT NULL REFERENCES users(id),
  updated_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((target_type = 'everyone') = (target_id IS NULL)),
  -- leaders grant only to people, departments or agents in reach, never to everyone
  CHECK (granted_scope = 'admin' OR target_type <> 'everyone')
);
CREATE UNIQUE INDEX uq_ai_model_grants
  ON ai_model_grants (target_type, COALESCE(target_id, '00000000-0000-0000-0000-000000000000'::uuid),
                      model_id, period, granted_scope);
CREATE INDEX idx_ai_model_grants_target ON ai_model_grants (target_type, target_id);
```

- **One grant row** = one target, one model, one period, one limit.
- **Daily and weekly together:** a person can have a daily **and** a weekly limit on the same model (two rows, e.g. 20 000/day and 80 000/week). Both are enforced.
- **`granted_scope`:** records whether an admin or a leader made the grant, which controls who may edit it (§5).
- **Default model:** `GrantService` rejects any grant whose `model_id` is the current default (409 "Model bawaan sudah terbuka untuk semua tanpa batas").
- **No seed rows.** Production starts strict: only the default model is open.
- **Agent grants:** they target personal agents only (`agents.is_template = false`).

### 4.3 Usage ledger — NEW

```sql
CREATE TYPE ai_usage_source AS ENUM
  ('conversation', 'regenerate', 'task', 'agent_subtask', 'attachment_summary',
   'memory', 'model_test', 'system');

CREATE TABLE ai_usage_ledger (
  id          bigserial PRIMARY KEY,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL, -- NULL for system jobs
  model_id    uuid REFERENCES ai_models(id) ON DELETE SET NULL,
  provider    ai_provider_code NOT NULL,
  model_key   varchar(200) NOT NULL,          -- snapshot, survives catalog deletion
  source      ai_usage_source NOT NULL,
  source_id   uuid,                           -- conversation / task id
  agent_id    uuid REFERENCES agents(id) ON DELETE SET NULL, -- agent that made the call, if any
  tokens_in   integer NOT NULL DEFAULT 0,
  tokens_out  integer NOT NULL DEFAULT 0,
  estimated   boolean NOT NULL DEFAULT false, -- provider returned no usage → estimated
  counts_toward_quota boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_usage_user_model_time ON ai_usage_ledger (user_id, model_id, created_at)
  WHERE counts_toward_quota;
CREATE INDEX idx_ai_usage_agent_model_time ON ai_usage_ledger (agent_id, model_id, created_at)
  WHERE counts_toward_quota AND agent_id IS NOT NULL;
CREATE INDEX idx_ai_usage_time ON ai_usage_ledger (created_at);
```

- **Estimation:** when the provider returns no usage (some Ollama/OpenRouter paths), estimate `ceil(chars / 4)` for both directions and set `estimated = true`.
- **Not counted:** `counts_toward_quota = false` for `model_test`, `memory`, `attachment_summary` and `system`.
  - Attachment summaries are **not** charged to the uploader (decided, §13).
  - Calls on the **default model** are recorded with `counts_toward_quota = true`. They are limited only by the default-model limits (§4.1a), which are unlimited unless set.
- **No backfill:** quotas start counting from the migration.

### 4.4 Model selection columns — NEW

```sql
ALTER TABLE conversations         ADD COLUMN model_id uuid REFERENCES ai_models(id) ON DELETE SET NULL;
ALTER TABLE conversation_messages ADD COLUMN model_id uuid REFERENCES ai_models(id) ON DELETE SET NULL;
ALTER TABLE ai_tasks              ADD COLUMN model_id uuid REFERENCES ai_models(id) ON DELETE SET NULL;
ALTER TABLE agents                ADD COLUMN model_id uuid REFERENCES ai_models(id) ON DELETE SET NULL;
ALTER TABLE users                 ADD COLUMN preferred_model_id uuid REFERENCES ai_models(id) ON DELETE SET NULL;
```

- `conversation_messages.model` (varchar) stays and keeps the id **returned by the provider**. `model_id` is the catalog entry that was **requested**.
- A `NULL` `model_id` anywhere means "use the user's preferred model, else the default model, at call time".

### 4.5 Reach from department heads (existing, shared with central memory)

There is **no new table** here. Who leads whom comes from the department tree and `departments.head_user_id`. Central memory already uses these: migration `1700000025000-central-memory.ts`, the "Kepala departemen" picker in `apps/web/src/views/admin/DepartmentsAdminView.vue`, and `REACH_SQL` in `apps/api/src/modules/memory/memory-scope.service.ts`.

- **NEW `OrgReachService`** (`apps/api/src/modules/rbac/org-reach.service.ts` or a small shared module):
  - It moves `REACH_SQL` out of `MemoryScopeService` into one place.
  - Central memory and model grants both call it, so "leader" means the same thing in both features.
  - It returns `{ departments, users, agents }`.
- **Departments and people:** the existing CTE, unchanged:

```sql
-- $1 = leader user id
WITH RECURSIVE led AS (
  SELECT id FROM departments WHERE head_user_id = $1 AND is_active
  UNION
  SELECT d.id FROM departments d JOIN led ON d.parent_id = led.id WHERE d.is_active
)
SELECT id FROM led;                                          -- departments in reach
-- users in reach: status = 'active', id <> $1, and
--   department_id IN led  OR  id IN (heads of departments in led)   (same as memory-scope.service.ts)
```

- **Agents (D10):** personal agents (`NOT is_template`, `status = 'active'`) whose `owner_user_id` is the leader **or** any user in reach.
  - This is wider than central memory's P1 rule R6, which excludes subordinates' agents from memory doors. `OrgReachService` therefore takes an option `includeSubordinateAgents`: model grants pass `true`, memory keeps `false`.
- **Recomputed on every request:** a change of department head, a user moving department, or a deactivated user takes effect on the next request. The grant cache key (§6.4) also includes `rbac_meta.version`, which department edits already bump.
- **Cycles:** departments can't form cycles (admin validation), and `UNION` keeps the CTE terminating regardless.

---

## 5. Who can do what

| Actor | Permission | Capability |
|---|---|---|
| **Admin** | `ai.models.manage` | See provider status (read-only). Add, test, enable and disable models. Set the default model, capabilities, `leader_grantable`. |
| **Admin** | `ai.models.grant.manage`, **global** scope | Grant any enabled non-default model to **any user, any department, any personal agent or everyone**. Edit or delete **every** grant. See everyone's usage. Set department heads (existing `rbac.departments.manage`). |
| **Leader** | `ai.models.grant.manage` + head of ≥ 1 active department | Grant enabled non-default models with `leader_grantable = true` to **people, departments and subordinate agents in reach**. Edit or delete only `granted_scope = 'leader'` grants whose target is in reach. Admin grants are read-only. See the usage of their reach. |
| **User** | `ai.secondbrain.query` / `ai.counterpart.analyze` | Always use the default model without limit. Pick one of their granted models per conversation. Set a preferred model. See their own usage and remaining quota. |
| **Agent owner** | `ai.agents.manage` | Choose the model of their personal agent from **their own** granted models. |
| **Agent admin** | `agents.update` | Choose the default model of template agents from all **enabled** models. |

**Reach** (computed per request by `OrgReachService`, §4.5):

- **Departments:** the ones the leader heads, plus all their sub-departments.
- **People:** active members of those departments and the heads of the sub-departments, excluding the leader.
- **Subordinate agents:** personal agents owned by the leader **or** by any person in reach.
  - **Own agents:** a leader may grant to their own agents, because an agent grant only **narrows** (§6.9). The owner's own quota still applies, so it can't be used to bypass the leader's own limits.
- **Not themselves:** a leader **can't grant to themselves** (403). Their own models come from their own leader or an admin.
- **No department:** a user with `ai.models.grant.manage` who heads no department has an empty reach. They see "Anda belum ditetapkan sebagai kepala departemen. Hubungi admin."
- **When reach changes:** after a head change or a user moving department, grants whose target left the leader's reach **stay in force** but become read-only for that leader. They are listed under "Di luar jangkauan" so an admin can clean them up.

---

## 6. Resolution and enforcement

### 6.1 New services (`apps/api/src/modules/ai/models/`) — NEW

| Service | Responsibility |
|---|---|
| `ProviderRegistryService` | Reads provider settings from `ConfigService` (§3.1). Builds and caches **one adapter per configured provider**, each wrapped by `GuardedProvider`. Exposes status and `check(code)`. Replaces the single `adapter` field and `resolveProviderConfig()` usage in `AiGatewayService`. |
| `ModelCatalogService` | CRUD on `ai_models`, discovery (§6.5), test (§6.6), default handling. |
| `GrantService` | Validated CRUD for `ai_model_grants`. Enforces reach, `leader_grantable`, `granted_scope` and the no-self rule on write. |
| `ModelAccessService` | `allowedModels(userId)`, `effectiveQuotas(userId)`, `authorize(userId, modelId \| null, needs)`. `authorize` returns `{ model, adapter, maxTokens }` or throws `AI_MODEL_NOT_ALLOWED`, `AI_MODEL_UNAVAILABLE`, `AI_MODEL_CAPABILITY_MISSING` or `AI_QUOTA_EXCEEDED`. |
| `UsageLedgerService` | `record(...)` after each call. `summary(userId \| reach, period)` for UI and reports. |

### 6.2 Which models may a user use?

For user **U**, collect the grant rows whose target matches U:

- `everyone`;
- U's department, or an ancestor department when `include_sub_departments = true`;
- U directly.

**A leader's grant never applies to the leader who created it.** Rows with `granted_scope = 'leader'` and `created_by = U` are skipped for U, so a grant to a department the leader heads (and belongs to) doesn't reach the leader. This enforces the no-self rule for team grants too.

**Superadmin** may use every enabled model with no quota. Their usage is still recorded.

**Allowed models** = **the default model** (always; limited only by §4.1a) ∪ the distinct `model_id`s of those rows, kept only when the model is `enabled` and its provider is configured.

### 6.3 Which limit applies?

For each allowed model **M** and each period **P** (`day`, `week`) that has at least one matching row:

```
-- M is never the default model here: the default uses §4.1a instead of grants.
candidates(M, P) = matching rows for M and P, grouped by specificity:
                     user  >  department (nearest ancestor first)  >  everyone
limit(M, P)      = take the MOST SPECIFIC group;
                   inside that group take the LOWEST token_limit  (NULL = no limit, so any number beats NULL)
```

- **More specific wins.** A user grant overrides the team grant, which overrides "everyone". A leader can therefore give one person more (or less) than the rest of the team.
- **Same level, lowest wins.** An admin row and a leader row both targeting U directly for M/day → the lower limit applies.
- **Both periods enforced.** If M has both a `day` and a `week` limit, a call needs headroom in both.
- **Usage in a window:** `SUM(tokens_in + tokens_out)` from `ai_usage_ledger` for U and M with `counts_toward_quota` and `created_at` inside the current day or week (in `app.timezone`).

### 6.4 Enforcement timing

- **Before every provider call**, including each iteration of `runToolLoop` and each agent sub-task: if any applicable `remaining <= 0`, reject with `AI_QUOTA_EXCEEDED` (§7.3) and make no provider call.
- **Default model:**
  - Grants are never consulted. If `ai.default_model.token_limit` is set, the same remaining-token check runs against the user's default-model usage in the configured period.
  - If `ai.default_model.requests_per_minute` is set, the count of the user's default-model ledger rows in the last 60 s must be below it. Otherwise the call is rejected with `AI_RATE_LIMITED` (429, `retryAfterSeconds`).
  - Both checks are skipped while the values are `null`.
- **`maxTokens` clamp:** `maxTokens = min(AI_LIMITS…, model.max_output_tokens, smallest remaining)`. The last answer before the limit can't overshoot by much.
- **No reservation (P1).** Two parallel requests can both pass the check, so a quota may be exceeded by at most one response. Reservation is P3 (§11).
- **After the call**, `UsageLedgerService.record()` stores the real usage, including partial usage when a stream is stopped by the user.
- **Cache:**
  - Allowed models and limits are cached per user for 30 s. The key includes a new `ai_models_meta.version`, bumped on any catalog or grant write, so changes apply almost immediately.
  - Usage sums are **never** cached.

### 6.5 Discovery ("Cari model") — NEW

`GET /api/admin/ai/providers/:code/discover` calls the provider's list endpoint with the env credential:

| Provider | Endpoint | Fields used |
|---|---|---|
| OpenRouter | `GET {base}/models` | `id`, `name`, `context_length`, `top_provider.max_completion_tokens`, `architecture.input_modalities` (vision), `supported_parameters` contains `tools` |
| OpenAI | `GET {base}/models` | `id` only. Capabilities are left for the test. |
| Anthropic | `GET {base}/v1/models` (with `anthropic-version` header) | `id`, `display_name` |
| Ollama | `GET {base}/models` (OpenAI-compatible) or native `GET /api/tags` | `id`/`name` |

- **Read-only:** discovery never writes and marks items already in the catalog.
- **Adding:** the admin ticks models and posts them to `POST /api/admin/ai/models` (bulk), which creates them as `draft`. Manual entry of any `model_key` is also possible.
- **Limits:** results are cached 10 minutes per provider, with a 15 s timeout.

### 6.6 Model test ("Uji model") — NEW

`POST /api/admin/ai/models/:id/test` runs short probes (each `max_tokens ≤ 64`):

1. **Basic + streaming:** stream "Balas tepat dengan kata: OK". It records time to first token and total latency, and passes if any text returns.
2. **Tools:** offer one dummy tool `ping({ value: string })` and ask the model to call it. `supports_tools = true` if a tool call comes back.
3. **Vision** (only if "Uji gambar" is ticked): send a 2×2 PNG and ask its colour. `supports_vision = true` on a non-error answer.

**Results:**

- The `last_test_*` columns and capability flags are updated.
- The result of each probe is returned to the UI: ok/error, latency, provider error text truncated to 300 chars and redacted with `common/utils/redact.ts`.
- **Usage:** test tokens go to the ledger with `source = 'model_test'` and `counts_toward_quota = false`.
- **Rate limit:** 10 tests per admin per minute.

### 6.7 Gateway changes

`AiGatewayService` (`apps/api/src/modules/ai/gateway.service.ts`):

- **New options:** `GatewayChatOptions` gains `actor: { userId: string | null; source: AiUsageSource; sourceId?: string }` and `modelId?: string | null`.
- **`buildRequest()`:**
  - calls `ModelAccessService.authorize()`;
  - uses the returned `model.model_key` instead of `settings().aiModel`;
  - uses the returned adapter instead of `resolveAdapter()`.
- **Capability needs:** `needs.tools` when `documents` or `tools` are present; `needs.vision` when `images` are present.
  - A model **without tools** is rejected with `AI_MODEL_CAPABILITY_MISSING`. Tools are never dropped silently.
  - A model **without vision** gets its images dropped, plus a system note (same as guardrails `blockImages`).
- **Usage:** `chat()`, `stream()` and each `runToolLoop` iteration call `UsageLedgerService.record()`.
- **`activeModel()`** becomes `defaultModel()`. `task-runner.service.ts:788` and `integrations.service.ts` `providerStatus()` switch to the model actually resolved for the call.

**Callers to update** so they pass `actor` + `modelId`:

| Caller | `source` | Model used |
|---|---|---|
| `ai.controller.ts` chat / stream | `conversation` | conversation's model (§6.8) |
| `ai.controller.ts` regenerate | `regenerate` | conversation's model |
| `tasks.service.ts` | `task` | `ai_tasks.model_id` |
| `task-runner.service.ts` (agent loop, group delegation) | `task` / `agent_subtask` | agent's model (§6.9) |
| `attachments.service.ts` (`summarizeSource`) | `attachment_summary` | conversation model, else default |
| Memory extractor (`ai.memory_extractor_model`) | `memory` | config value matched to a catalog model by `model_key`. `counts_toward_quota = false`. |

### 6.8 Conversations (Multi Brain, Partner)

- **Requests:** `ChatRequestDto` and `CreateConversationDto` (`apps/api/src/modules/ai/dto/ai.dto.ts`) gain optional `modelId` (UUID). `PATCH /api/ai/conversations/:id` accepts `modelId`.
- **Model for a turn:**
  1. `dto.modelId`;
  2. `conversations.model_id`;
  3. `users.preferred_model_id`;
  4. the default model.

  The first one that is **allowed** for the user wins. An explicit `dto.modelId` that is not allowed is rejected (`AI_MODEL_NOT_ALLOWED`), never silently replaced.
- **Persistence:** after a successful turn, `conversations.model_id` = the model used, and the assistant message stores `model_id`.
- **Switching mid-conversation:**
  - It is allowed. The full history goes to the new model, and each message keeps the model that produced it.
  - Regenerate uses the current model.
- **Unavailable model:** if a conversation's saved model is no longer allowed or enabled, the conversation opens with "Model sebelumnya tidak tersedia" and the first allowed model selected.

### 6.9 Agents

- **Template agents** (`agents.is_template = true`, Agent Center):
  - `CreateAgentDto` / `UpdateAgentDto` (`apps/api/src/modules/agents/dto`) gain `modelId?: string | null`.
  - The value must be an `enabled` model. `NULL` = default model.
- **Personal agents** (`apps/api/src/modules/ai/agents/dto/agents.dto.ts`):
  - `PersonalAgentDto` / `UpdatePersonalAgentDto` gain `modelId`. On write it must be one of the **owner's** allowed models.
  - `from-template` copies the template's model only if the owner may use it, else `NULL`.
- **Run time** (`task-runner.service.ts`):
  - **Model order:** `ai_tasks.model_id` (when the run overrides it), then `agents.model_id`, then the owner's preferred model, then the default.
  - **Authorisation:** `authorize()` runs for the **task owner**, the user who started the task. Their quota is consumed.
- **Subordinate agent grants** (`target_type = 'agent'`, decision D10 in §13):
  - **No grants on the agent:** the agent may use whatever its task owner may use. This is today's behaviour.
  - **One or more grants on the agent:** the agent may use only **the default model + the models granted to the agent**, and each must **also** be allowed for the task owner.
  - **Two counters:** a call is checked against the agent's own counter (`ai_usage_ledger.agent_id`) **and** the task owner's counter. Both must have headroom, and one ledger row serves both.
  - **Effect:** a leader can say "the agents of my team may only use model S, at most 20 000 tokens/day each". They can't give an agent more than its owner has.
  - **Saving the agent:** when the agent has grants, its selected model must be among the default + granted models. Otherwise the editor rejects it with "Model ini tidak diizinkan untuk agent ini oleh atasan".
  - **Model no longer allowed:** the task fails fast with "Model agent tidak lagi diizinkan untuk Anda. Ubah model di konfigurasi agent."
- **Agent groups:**
  - Each member runs on its own model, and every sub-task is charged to the task owner (`source = 'agent_subtask'`).
  - A group run is rejected up front if any member's model is not allowed for the owner.
- **Capabilities:** agents with connectors, `create_document` or delegation need `supports_tools`. The editor lists only tool-capable models for them, and the API rejects others.

---

## 7. API

All routes are under `/api`, use the standard envelope and follow `docs/api-conventions.md`.

### 7.1 Admin — providers (read-only) and catalog — NEW

| Method & path | Permission | Notes |
|---|---|---|
| `GET /admin/ai/providers` | `providers.health.read` | Replaces `GET /admin/providers`, which stays as an alias for one release. Per provider: `configured`, `baseUrl`, `lastCheck` (ok/error/latency), `modelCount`, `enabledModelCount`. Never returns a key. **No write route exists.** |
| `POST /admin/ai/providers/:code/check` | `ai.models.manage` | Connectivity check against the list endpoint |
| `GET /admin/ai/providers/:code/discover` | `ai.models.manage` | §6.5 |
| `GET /admin/ai/models` | `ai.models.manage` | Filters: `provider`, `status`, `search` |
| `POST /admin/ai/models` | `ai.models.manage` | Single or bulk `{ items: [{ provider, modelKey, displayName?, … }] }`. Creates as `draft`. |
| `PATCH /admin/ai/models/:id` | `ai.models.manage` | Metadata, capability overrides, `leaderGrantable`, `costTier` |
| `POST /admin/ai/models/:id/test` | `ai.models.manage` | §6.6 |
| `POST /admin/ai/models/:id/enable` · `/disable` | `ai.models.manage` | `enable` requires `last_test_ok`. `disable` on the default → 409. |
| `POST /admin/ai/models/:id/default` | `ai.models.manage` | Model must be enabled on a configured provider. Opens it to every user under the current default-model limits (§4.1). Requires `{ confirm: true }`. |
| `GET /admin/ai/default-model-limits` | `ai.models.manage` | `{ tokenLimit: number \| null, period: 'day' \| 'week', requestsPerMinute: number \| null }` |
| `PUT /admin/ai/default-model-limits` | `ai.models.manage` | Same body. `null` = unlimited. Positive integers only. Audited as `ai.default_model.limits_updated`. |
| `DELETE /admin/ai/models/:id` | `ai.models.manage` | Only for `draft`/`disabled`. Its grants are deleted (cascade) after confirmation. The ledger keeps `model_key`. |

### 7.2 Grants and usage — NEW

| Method & path | Permission | Notes |
|---|---|---|
| `GET /ai/model-grants` | `ai.models.grant.manage` | Admins see all. Leaders see grants targeting their reach; admin rows and rows outside the current reach are marked `editable: false`. Filters: `targetType`, `targetId`, `modelId`. |
| `POST /ai/model-grants` | `ai.models.grant.manage` | `{ targetType, targetId, includeSubDepartments, modelId, tokenLimit, period, note }`. The model being the **default** → 409. **Leaders** get 403 `AUTHORIZATION_ESCALATION_BLOCKED` when: the target (person, department or agent) is outside reach; the target is themselves; `targetType = 'everyone'`; or the model is not `leader_grantable`. `granted_scope` is set by the server. |
| `GET /ai/model-grants/reach` | `ai.models.grant.manage` | The caller's reach for pickers, from `OrgReachService`: departments (tree), people (name, job title, department) and subordinate agents (name, owner). Admins get searchable lists of everything. |
| `PATCH /ai/model-grants/:id` · `DELETE …/:id` | `ai.models.grant.manage` | Leaders: only `granted_scope = 'leader'` rows in reach. |
| `GET /ai/model-grants/effective?userId=` | `ai.models.grant.manage` (target in reach) | Computed result of §6.2–§6.3 for one person. For each model: the daily and weekly limit, used, remaining and `resetsAt`, and **which grant row** produced each limit. |
| `GET /ai/usage/team?period=day\|week&groupBy=user\|model` | `ai.models.grant.manage` | Aggregates over reach (global = everyone). CSV with `?format=csv`. |
| `GET /ai/models` | `ai.workspace.access` | **Picker list** for the caller: the default model (`isDefault: true`; `unlimited: true` when no default-model limit is set, else its `{ limit, used, remaining, resetsAt }` and `requestsPerMinute`) plus granted models, with `displayName`, `provider`, `description`, `costTier`, capability flags, and per period `{ limit, used, remaining, resetsAt }`. |
| `GET /ai/usage/me` | `ai.workspace.access` | Own usage per model for today and this week, with limits |
| `PUT /ai/preferences/model` | `ai.workspace.access` | `{ modelId \| null }`. The model must be allowed. |

### 7.3 Error codes — NEW (add to `ERROR_CODES` in `apps/api/src/common/errors/app-error.ts`)

| Code | HTTP | `details` |
|---|---|---|
| `AI_MODEL_NOT_ALLOWED` | 403 | `{ modelId }` |
| `AI_MODEL_UNAVAILABLE` | 409 | `{ modelId, reason: 'disabled' \| 'provider_unconfigured' }` |
| `AI_MODEL_CAPABILITY_MISSING` | 422 | `{ modelId, missing: ['tools' \| 'vision'] }` |
| `AI_QUOTA_EXCEEDED` | 429 | `{ modelId, period, limit, used, resetsAt }` |
| `AI_RATE_LIMITED` | 429 | `{ modelId, requestsPerMinute, retryAfterSeconds }`. Default model only. Also sent as the `Retry-After` header on non-stream routes. |

On `POST /ai/chat/stream` they arrive as the existing SSE `error` event. Messages are in Bahasa Indonesia, e.g.:

- "Kuota harian Anda untuk Claude Sonnet sudah habis (50.000 token). Kuota direset besok pukul 00:00."
- "Kuota mingguan Anda untuk GPT-5 sudah habis. Kuota direset Senin, 17 Nov 2026 00:00."
- "Anda belum diizinkan memakai model ini. Hubungi atasan atau admin."
- "Terlalu banyak permintaan ke model bawaan (maks. 10 per menit). Coba lagi dalam 20 detik."

---

## 8. Permissions

Add to `PERMISSION_CATALOG` in `packages/shared/src/permissions.ts`:

| Id | Meaning | Default roles |
|---|---|---|
| `ai.models.manage` | Add, test, enable and disable models; set the default model. Provider settings remain in `.env`. | `administrator` |
| `ai.models.grant.manage` | Grant non-default models and token quotas; view usage. `global` data scope = admin (everyone). Any other scope = leader, whose reach comes from the departments they **head** (§4.5), not from the scope's department. | `administrator` (global), `manager` |

Setting department heads reuses the existing `rbac.departments.manage`.

- The migration seeds role grants and menu items with idempotent inserts, as in `1700000015000-mind-map.ts`:
  - **"Model AI"** under Administrasi → Platform;
  - **"Izin Model Tim"** under Ruang Kerja AI.
- Tests asserting the permission count (`admin-rbac`, `rbac-guard`, `admin-platform` e2e specs) must be updated.

---

## 9. UI requirements (Vue 3, Ca* components, Fluent Green tokens)

All strings go in `apps/web/src/i18n/locales/id.ts` under a new `models` block. No CDN libraries; everything is bundled through Vite.

### 9.1 Admin → "Model AI" (rework `apps/web/src/views/admin/ProvidersAdminView.vue`)

- **Provider cards** (four, **read-only**), each with:
  - status badge "Terkonfigurasi" / "Belum dikonfigurasi";
  - base URL and the number of enabled models;
  - last connectivity check;
  - one button, **"Periksa koneksi"**.
- **Unconfigured providers** show the hint "Atur `OPENAI_API_KEY` di .env lalu mulai ulang API". The variable name matches the provider.
- **Model catalog** (`CaTable`):
  - **Columns:** Nama, Penyedia, ID model, Status ("Draf" / "Aktif" / "Nonaktif"), Kemampuan (chips "Tools", "Gambar", "Streaming"), Tier biaya, Bisa diberikan leader (✓/—), Uji terakhir (ok/error + latency), Default (star).
  - **Row menu (`CaRowMenu`):** Uji model, Aktifkan, Nonaktifkan, Jadikan default, Ubah, Hapus.
  - **Default row:** carries a badge "Bawaan · tanpa batas untuk semua pengguna", or "Bawaan · maks. {N} token/{hari|minggu}, {R} permintaan/menit" when limits are set.
  - **"Jadikan default" confirmation:** "Model ini akan dapat dipakai semua pengguna {tanpa batas token | dengan batas yang berlaku}. Pilih model yang hemat biaya." It also shows the model's cost tier.
- **"Batas model bawaan" card** above the catalog:
  - **Batas token per pengguna:** number + period (Harian / Mingguan), with a **"Tanpa batas"** switch that is **on by default**.
  - **Batas permintaan per menit per pengguna:** number, with a **"Tanpa batas"** switch that is **on by default**.
  - **"Simpan"** shows the note "Berlaku untuk semua pengguna pada permintaan berikutnya."
  - **Header buttons:**
    - **"Cari model"**: discovery dialog. Provider select (configured providers only) → searchable checklist; models already in the catalog are disabled with "Sudah ada" → "Tambahkan terpilih".
    - **"Tambah manual"**.
- **"Uji model" dialog:**
  - shows each probe live (spinner → ✓/✗, latency, error text);
  - after success it offers **"Aktifkan sekarang"**;
  - enabling an untested model shows "Uji model ini dulu sebelum diaktifkan."

### 9.2 Admin & leader → "Izin Model Tim" (NEW view `apps/web/src/views/ModelGrantsView.vue`, route `/workspace/model-grants`)

**Tab "Izin"**: a table of grants. A banner at the top reads "Model bawaan: {nama} — tanpa batas untuk semua pengguna" (or its current limits).

- **Columns:** Untuk (person or team, with icon), Model, Batas ("50.000 token / hari", "200.000 token / minggu" or "Tanpa batas"), Diberikan oleh (name + "Admin"/"Leader" badge), Catatan.
- **Admin rows** are read-only for leaders (lock icon, tooltip "Diatur admin").
- **Out-of-reach rows** (after a head change or a user moving department) are grouped under "Di luar jangkauan".
- **Tab "Struktur tim"** (read-only): the departments the leader heads as a tree, each with its members, sub-department heads and their agents. Each node shows its granted models and today's usage. A note reads "Sumber: struktur departemen (Administrasi → Departemen)".

**"Beri izin model" dialog:**

| Field | Behaviour |
|---|---|
| Untuk | **Orang** (people in reach) · **Departemen** (tree of departments in reach, with a "Termasuk sub-departemen" switch) · **Agent bawahan** (subordinate agents, grouped by owner). Admins see every department and person, plus **Semua orang**. |
| Model | Multi-select of enabled models, **without the default** (shown as an info line "Model bawaan selalu tersedia tanpa batas"). Leaders only see `leader_grantable` ones. Creates one row per model. |
| Batas token | Number + "Tanpa batas" checkbox |
| Periode | Segmented control: **Harian** / **Mingguan** |
| Tambah batas kedua | Optional second limit for the other period (e.g. harian + mingguan) |
| Catatan | Free text |

**"Lihat efektif"** on any person opens a side panel with the §7.2 effective result. Every number explains its source, e.g. "Dari izin Departemen Klaim (oleh Budi, Leader)" or "Dari izin pribadi (oleh Admin)". A user grant overriding a team grant is shown with "menggantikan izin tim".

**Tab "Pemakaian":**

- period switch (Hari ini / Minggu ini), grouping (per orang / per model);
- a bar per person of used vs limit (≥ 80 % amber, 100 % red);
- CSV export;
- the existing dashboard chart components (no new chart library).

### 9.3 Conversation model picker (Multi Brain & Partner)

- **Placement:** a compact dropdown in the composer bar of `apps/web/src/components/ai/ChatWorkspace.vue`, next to `WebSearchToggle`. The label shows the display name.
- **Each item shows:**
  - display name, provider, description;
  - cost tier (`●○○` hemat · `●●○` standar · `●●●` premium);
  - capability icons;
  - remaining quota ("Sisa 32 rb token hari ini · 140 rb minggu ini").
- **Default:** always listed first, marked **"Bawaan · tanpa batas"** with no quota line. When the admin has set a default-model limit, it shows the remaining quota like other models.
- **Disabled items:**
  - Exhausted models: "Kuota habis · reset {waktu}".
  - When the conversation needs tools (documents/connectors on) or has images, models lacking that capability get a tooltip: "Tidak mendukung dokumen & konektor" / "Tidak mendukung gambar".
- **Saving:** the choice is saved on the conversation. The link **"Jadikan pilihan bawaan saya"** calls `PUT /ai/preferences/model`.
- **Usage meter:**
  - a small meter under the picker ("Pemakaian hari ini: 62 %"), shown when the selected model has a limit;
  - clicking it opens a popover with the per-model breakdown (`GET /ai/usage/me`).
- **Quota errors:** on `AI_QUOTA_EXCEEDED` for a granted model, the error banner offers **"Pakai model bawaan"** (one click switches the conversation to the default) and **"Ganti model"**.
- **Rate limit on the default:** on `AI_RATE_LIMITED` the banner shows a countdown ("Coba lagi dalam 20 detik"), and the send button is disabled until it ends.
- **Default only:** when the user has only the default model, the picker is hidden and the UI looks like today.

### 9.4 Agent configuration

- **Template agents:** `apps/web/src/views/agents/AgentDefinitionsView.vue` gets a **"Model"** field (enabled models + "Bawaan sistem").
- **Personal agents:** `apps/web/src/components/subordinate/AgentEditorDialog.vue` gets the same field with the owner's allowed models.
  - **Tool-capable only:** agents with connectors, documents or delegation only see tool-capable models ("Hanya model yang mendukung tools").
  - **Not allowed:** if the saved model is no longer allowed, the field shows "Model tidak lagi diizinkan — agent akan gagal dijalankan".
- **Model chip:** agent cards in `apps/web/src/components/subordinate/AgentsPanel.vue` show the model.

### 9.5 "Pemakaian AI saya"

NEW route `/workspace/usage`, linked from the user menu in `apps/web/src/components/shell/AppHeader.vue` and from the usage meter popover. It lists:

- per-model usage today and this week;
- limits and reset times;
- who granted each model;
- the preferred model selector.

### 9.6 Docs

Add a chapter "Memilih model dan kuota token" to `apps/web/src/docs/chapters.ts` once shipped.

---

## 10. Non-functional requirements

| Area | Requirement |
|---|---|
| Security | Credentials only in env, never returned, logged or included in audit payloads. Discovery and test errors pass through `redact.ts`. Only `ai.models.manage` can trigger calls to provider list endpoints. |
| Isolation | Every LLM call goes through `ModelAccessService.authorize()`. A unit test asserts that no code outside `ai/models/` constructs a provider adapter. |
| Correctness | Windows are computed in `app.timezone`. The day starts at 00:00 and the week starts Monday 00:00. A call is counted in the window of its `created_at` (completion time). |
| Performance | `authorize()` p95 < 15 ms. Usage sums use `idx_ai_usage_user_model_time` and read only the current window. |
| Availability | If the ledger insert fails after a successful provider call, the answer is still returned. The failure is logged and retried once. |
| Ollama | Local models often lack usage numbers, so estimates are used and flagged `estimated`. The UI shows "≈" next to estimated totals. |
| Audit | `AuditService.record()` events (add to `packages/shared/src/audit-events.ts`): `ai.model.created`, `ai.model.tested`, `ai.model.enabled`, `ai.model.disabled`, `ai.model.default_changed`, `ai.model.deleted`, `ai.grant.created`, `ai.grant.updated`, `ai.grant.deleted`, `ai.default_model.limits_updated`, `ai.quota.exceeded`, `ai.rate.limited`. `ai.quota.exceeded` and `ai.rate.limited` are recorded once per user/model/window, not per request. |
| Retention | `ai_usage_ledger` is kept 400 days. A nightly job deletes older rows. |

---

## 11. Phasing

| Phase | Scope |
|---|---|
| **P1** | Env variables (§3.1) and `ProviderRegistryService` with one adapter per configured provider. Migration (catalog, grants, ledger, selection columns; default model from `AI_PROVIDER`/`AI_MODEL`; **no grant rows**). Catalog: manual add, test, enable/disable, default (open to all; optional default-model limits, unlimited by default). Ledger on every call. `OrgReachService` extracted from central memory. Grants by **admin and leader** (people, departments, subordinate agents) with daily/weekly limits and enforcement. "Izin Model Tim" view with "Lihat efektif" and "Struktur tim". Conversation model picker and `GET /ai/models`. Agent model field (template + personal). Error codes, permissions, "Model AI" admin view. |
| **P2** | Discovery ("Cari model") for all four providers. Usage tab + CSV. "Pemakaian AI saya" and usage meter. |
| **LR1** (with P2) | Long runs, provider-neutral (§14): `ai_runs` + events + checkpoints + tool-call idempotency; `RunWorkerService` replacing the in-process task queue (lease, heartbeat, resume, graceful shutdown); SSE with `Last-Event-ID`; streaming idle timeout and per-call ceiling; budgets (iterations, deadline, tokens) with "Lanjutkan"; token-based context budget with neutral tool-result clearing and compaction; `providerContent` round trip; omit sampling params where rejected; run view, "Proses berjalan", notifications; auto-promotion of long chat turns. |
| **LR2** | Provider-native long-run features where the catalog flags allow: Anthropic server-side context editing and compaction, effort, adaptive thinking with summarized/updates display, task budgets, prompt-cache breakpoints and mid-conversation system notes, allowed-model refusal fallbacks; OpenAI reasoning effort; `kirim_pembaruan` tool; admin runs table. |
| **P3** | Token **reservation** to stop parallel overshoot. Notification at 80 % and 100 % of a quota (existing notifications menu). Opt-in automatic fallback to the default model when a granted model is exhausted. |

---

## 12. Acceptance criteria and test scenarios

Integration tests go in `apps/api/test/integration/ai-models.e2e-spec.ts`, mocking at the **adapter** level (the gateway must be real to test enforcement). Long-run scenarios AC35–AC51 are in §14.11.

**Seed:**

- **Env:** `OPENROUTER_API_KEY` and `ANTHROPIC_API_KEY` set; Ollama not configured.
- **Models:** **D** (default, openrouter), **S** (anthropic, tools + vision, `leader_grantable = true`), **P** (anthropic, premium, `leader_grantable = false`), **L** (ollama).
- **Departments:** **Klaim** (head **M**, members **A**, **B**) with sub-department **Klaim Jabar** (head **A**, member **A2**); **Umum** (member **X**).
  - **M** holds `ai.models.grant.manage` with a non-global scope.
  - Admin **AD**.
- **Personal agents:** **AgA** owned by A, **AgM** owned by M.

| # | Scenario | Expected |
|---|---|---|
| AC1 | Fresh migration with `AI_PROVIDER=openrouter`, `AI_MODEL=m1` | Catalog has `m1` enabled + default; **zero** grant rows; existing chat tests pass unchanged |
| AC2 | Any user with no grants chats 10× on D | All succeed; ledger rows recorded; never 429 |
| AC3 | AD creates a grant on D | 409 "Model bawaan sudah terbuka untuk semua tanpa batas" |
| AC4 | AD makes S the default (with `confirm`) | S becomes open to everyone under the default-model limits; D needs a grant from now on; existing grants on S are marked not applicable |
| AC4a | Fresh install: `GET /admin/ai/default-model-limits` | `{ tokenLimit: null, period: 'day', requestsPerMinute: null }`; AC2 holds |
| AC4b | AD sets `tokenLimit = 1 000`, `period = 'day'`; A uses 1 000 tokens on D today | Next call on D → 429 `AI_QUOTA_EXCEEDED` with `resetsAt` tomorrow 00:00; picker shows D's remaining quota |
| AC4c | AD sets `requestsPerMinute = 2`; A sends 3 calls on D within 60 s | Third → 429 `AI_RATE_LIMITED` with `retryAfterSeconds`; no provider call |
| AC4d | AD sets both values back to `null` | Next calls on D succeed regardless of earlier usage |
| AC4e | Limits set; AD makes S the default | The same limits now apply to S; D is governed by grants |
| AC5 | `GET /admin/ai/providers` | Anthropic and OpenRouter `configured: true`, Ollama `false`; no key in any field; no PATCH route |
| AC6 | AD adds S and enables it without testing | 409 "Uji model ini dulu" |
| AC7 | AD tests S (mock answers + tool call) | `last_test_ok = true`, `supports_tools = true`; ledger row `model_test`, `counts_toward_quota = false`; enable succeeds |
| AC8 | S enabled, nobody granted; A chats with `modelId = S` | 403 `AI_MODEL_NOT_ALLOWED`; A's `GET /ai/models` lists only D |
| AC9 | M grants department **Klaim** (`includeSubDepartments = false`) → S, 1 000 / **day** | A and B see S; A2 (Klaim Jabar) and X do not |
| AC10 | M sets `includeSubDepartments = true` on that grant | A2 sees S as well |
| AC11 | A uses 1 000 tokens on S today, sends again | 429 `AI_QUOTA_EXCEEDED`, `period: 'day'`, `resetsAt` = tomorrow 00:00 Asia/Jakarta; no provider call; banner offers "Pakai model bawaan" |
| AC12 | Next day, A sends on S | Allowed (daily window reset) |
| AC13 | M also grants A → S 5 000 / **week**; A has used 4 900 this week | Blocked once the week reaches 5 000 even if today < 1 000 |
| AC14 | M grants B personally → S 3 000 / day (team grant 1 000 / day) | B's daily limit = 3 000 (person beats team); A stays at 1 000 |
| AC15 | AD grants B → S 2 000 / day while M's grant to B is 3 000 / day | B's daily limit = 2 000 (same level, lowest wins) |
| AC16 | M grants S to X, or to department Umum | 403 `AUTHORIZATION_ESCALATION_BLOCKED` (outside reach) |
| AC17 | M grants P (`leader_grantable = false`) to A | 403 |
| AC18 | M grants to everyone or to themselves | 403 |
| AC18b | M (member of Klaim) grants department Klaim → S | A and B get S; **M does not** (a leader's grant never applies to its creator) |
| AC19 | M edits AD's grant on B | 403; row returned with `editable: false` |
| AC20 | AD moves B to department Umum | B leaves M's reach on the next request; M's grant on B still applies but is read-only for M and listed "Di luar jangkauan" |
| AC21 | AD makes X head of Klaim instead of M | M's reach becomes empty ("Anda belum ditetapkan sebagai kepala departemen"); X can now manage grants in Klaim |
| AC22 | A (head of Klaim Jabar, holds `ai.models.grant.manage`) grants S to A2 | Allowed: A is a leader for the sub-department while still in M's reach |
| AC23 | Upload attachment in a conversation on S | Summary call recorded as `attachment_summary`, `counts_toward_quota = false`; A's S quota unchanged |
| AC24 | M grants agent **AgA** → S 200 / day; A (granted S 1 000 / day) runs AgA on S | Each call is checked against AgA's counter (200) **and** A's counter (1 000); one ledger row with `agent_id = AgA`; at 200, AgA gets 429 while A can still chat on S |
| AC25 | AgA has a grant for S only; A sets AgA's model to L | 422 "Model ini tidak diizinkan untuk agent ini oleh atasan" |
| AC26 | M grants own agent AgM → S, but M has no grant on S | Grant accepted; running AgM on S → 403 `AI_MODEL_NOT_ALLOWED` (owner not allowed) |
| AC27 | Agent without grants (e.g. agent of B) | Uses what its task owner may use (today's behaviour) |
| AC28 | Tool loop with 3 iterations on S | 3 ledger rows; quota checked before each iteration; stops with 429 once exhausted |
| AC29 | Documents on; user picks a model without tools | 422 `AI_MODEL_CAPABILITY_MISSING` (`missing: ['tools']`) |
| AC30 | A's personal agent set to S; M deletes the team grant; A runs the agent | Task `failed` with "Model agent tidak lagi diizinkan…"; no provider call |
| AC31 | Switch model mid-conversation D → S | Second assistant message `model_id = S`; `conversations.model_id = S`; regenerate uses S |
| AC32 | Model L granted to A, but Ollama not configured | L absent from the picker; explicit request → 409 `AI_MODEL_UNAVAILABLE` (`provider_unconfigured`) |
| AC33 | Provider returns no usage | Ledger row `estimated = true`, tokens > 0 |
| AC34 | Superadmin with no grant | Can use every enabled model; usage recorded |

**Unit tests** (`apps/api/test/unit/model-access.spec.ts`) cover the pure functions of §6.2–§6.3 and §4.5:

- default model always allowed; default-model limits `null` = unlimited, set = enforced (tokens per period, requests per rolling minute);
- specificity (person > team of nearest manager > department > everyone);
- lowest-wins inside a level;
- `NULL` = no limit;
- day and week together;
- agent + owner double counter;
- window boundaries around midnight and Monday in `Asia/Jakarta`;
- `OrgReachService` (departments, people incl. sub-department heads, subordinate agents) and memory still excluding subordinates' agents.

**Web unit tests** (Vitest) cover:

- the picker listing the default first as "tanpa batas" (or with its quota when limited);
- the "Batas model bawaan" card defaulting both "Tanpa batas" switches to on;
- picker disabled states and hiding when only the default exists;
- usage meter thresholds;
- the grant form hiding Departemen / Semua orang and non-grantable models for leaders, and never listing the default model.

---

## 13. Decisions and open questions

### 13.1 Decided (14 Nov 2026)

| # | Topic | Decision |
|---|---|---|
| D1 | Provider configuration | Stays in `.env`. The UI is read-only (§3). |
| D2 | Quota period | Daily or weekly, both allowed on the same model (§4.2). |
| D3 | Who grants | Admin or the user's leader, directly per person or per team. No envelope/allocation layers. |
| D4 | Counting | Per person (and per agent for agent grants). No shared pools. |
| D5 | Attachment summaries | Do **not** count against the uploader's quota (§4.3). |
| D6 | Unit of limit | Tokens only. No currency limits. |
| D7 | Who leads whom | The **department structure with department heads** (`departments.head_user_id`), shared with central memory through `OrgReachService` (§4.5), plus the **subordinate agents** of the people in reach (§5, §6.9). No external HR import. |
| D8 | Production start | Strict: the migration creates no grants. |
| D9 | Default model | The admin picks one default model. Every user may always use it without a grant (§4.1). |
| D10 | Meaning of "subordinate agent" | Confirmed: personal agents owned by the people in a leader's reach (and by the leader) are in reach. Leaders may **narrow** their models and quotas, and the owner's quota still applies (§6.9). |
| D11 | Default-model limits | Allowed but optional: a per-user token limit (day/week) and a per-user requests-per-minute limit, each settable to **unlimited**. Both are **unlimited by default** (§4.1a). |
| D12 | Long-running execution | Long work runs as durable, resumable runs in workers, independent of the browser connection (§14). Quota counts all input tokens, cached or not. Anthropic-specific features (compaction, context editing, effort, task budgets, caching) are used through catalog capability flags, with neutral fallbacks for other providers. Beta header names in §14 must be re-verified against Anthropic's docs at implementation time. |

### 13.2 Open questions

None at the moment.

---

## 14. Long-running execution ("Kerja panjang")

### 14.1 Why

Current models can work for a long time on one task, much like Claude Opus works through a large job: many tool calls, minutes-long turns, and a context that grows past what fits in one request. Anthropic's guidance for its newest models is to expect single requests on hard tasks to run **many minutes**, and to "plan timeouts, streaming, and user-facing progress indicators; structure work so callers check in on runs asynchronously rather than blocking inside one request".

The current code can't do this:

| Today | Where | Problem for long work |
|---|---|---|
| Each provider call is aborted after `AI_TIMEOUT_MS` (60 s) | `gateway.service.ts` `buildRequest()` | A legitimate 5-minute turn is killed |
| Tool loop stops after 12 iterations | `AI_LIMITS.maxToolIterations` | Long tasks end with `max_iterations` |
| History is capped by **message count** (40 / 160) | `validateChatMessages()` | A long run fails instead of managing context |
| Output capped at 2 048 / 8 192 tokens | `AI_LIMITS.maxOutputTokens*` | Long documents are cut off |
| The chat stream is aborted when the browser disconnects | `ai.controller.ts` (`res.on('close')`) | Closing the tab or a network blip throws the work away |
| Agent tasks run in an **in-process** queue (concurrency 3) | `task-runner.service.ts` | A restart marks running tasks `failed`; no horizontal scaling |
| Neutral `ChatMessage` keeps only text and tool calls | `providers/types.ts` | Provider-native blocks (Claude thinking and compaction blocks) are lost between turns |

### 14.2 Principles

1. **A run outlives the request.**
   - Long work runs as a durable **run** in a worker. The browser only watches it.
   - Disconnecting never cancels a run. Only the explicit **"Hentikan"** action (`POST …/cancel`) does.
2. **Checkpoint every step.**
   - After every model turn and every tool result, the run's messages are persisted.
   - A crash or deploy resumes from the last checkpoint instead of failing.
3. **Manage context, don't truncate it.** Context is measured in **tokens** against the model's `context_window`, and kept in budget by context editing and compaction (§14.6). History is never silently dropped.
4. **Bounded by budgets, not by fixed small limits.** Every run has:
   - a wall-clock deadline;
   - an iteration cap;
   - a token budget.

   All three are configurable, and the user's quota (§6.3–§6.4) still applies on every call.
5. **Use the provider's native features when the model has them, and a neutral fallback otherwise.** Capabilities come from the catalog (§14.4), so the same run works on OpenRouter, OpenAI, Ollama and Anthropic models.
6. **Visible progress.** The user can always see what the run is doing, how much budget it used, and its result. Progress claims must be grounded in tool results (§14.8).

### 14.3 Data model — NEW (same migration `1700000026000-multi-model.ts`)

```sql
CREATE TYPE ai_run_kind   AS ENUM ('conversation_turn', 'task');
CREATE TYPE ai_run_status AS ENUM
  ('queued', 'running', 'waiting_input', 'waiting_approval',
   'completed', 'failed', 'cancelled', 'budget_exhausted', 'deadline_exceeded');

CREATE TABLE ai_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             ai_run_kind NOT NULL,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- quota owner
  conversation_id  uuid REFERENCES conversations(id) ON DELETE CASCADE,
  task_id          uuid REFERENCES ai_tasks(id) ON DELETE CASCADE,
  agent_id         uuid REFERENCES agents(id) ON DELETE SET NULL,
  model_id         uuid REFERENCES ai_models(id) ON DELETE SET NULL,
  status           ai_run_status NOT NULL DEFAULT 'queued',
  effort           varchar(10),                     -- low|medium|high|xhigh|max, NULL = model default
  iterations       integer NOT NULL DEFAULT 0,
  max_iterations   integer NOT NULL,
  token_budget     bigint,                          -- NULL = only the quota limits it
  tokens_in        bigint NOT NULL DEFAULT 0,
  tokens_out       bigint NOT NULL DEFAULT 0,
  deadline_at      timestamptz NOT NULL,
  lease_owner      varchar(100),                    -- worker id
  lease_expires_at timestamptz,
  heartbeat_at     timestamptz,
  attempt          smallint NOT NULL DEFAULT 0,     -- resumes after a crash
  checkpoint_seq   integer NOT NULL DEFAULT 0,
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  started_at       timestamptz,
  finished_at      timestamptz,
  CHECK ((kind = 'conversation_turn') = (conversation_id IS NOT NULL AND task_id IS NULL))
);
CREATE INDEX idx_ai_runs_claim ON ai_runs (created_at) WHERE status = 'queued';
CREATE INDEX idx_ai_runs_lease ON ai_runs (lease_expires_at) WHERE status = 'running';
CREATE INDEX idx_ai_runs_user_active ON ai_runs (user_id)
  WHERE status IN ('queued', 'running', 'waiting_input', 'waiting_approval');

-- Checkpointed transcript of the run, append-only, in the provider's native shape.
CREATE TABLE ai_run_messages (
  run_id      uuid NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
  seq         integer NOT NULL,
  message     jsonb NOT NULL,      -- neutral ChatMessage + `providerContent` (raw blocks, see §14.6)
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, seq)
);

-- Tool executions, for idempotent resume.
CREATE TABLE ai_run_tool_calls (
  run_id       uuid NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
  tool_call_id varchar(100) NOT NULL,
  name         varchar(150) NOT NULL,
  status       varchar(20) NOT NULL CHECK (status IN ('started', 'succeeded', 'failed', 'pending_approval')),
  result       jsonb,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  PRIMARY KEY (run_id, tool_call_id)
);

-- Event log the UI streams from; also the replay source for reconnects.
CREATE TABLE ai_run_events (
  id         bigserial PRIMARY KEY,
  run_id     uuid NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
  type       varchar(30) NOT NULL,   -- status | delta | progress | tool_call | tool_result | compaction | usage | document | error | done
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_run_events_run ON ai_run_events (run_id, id);

ALTER TABLE conversation_messages ADD COLUMN provider_content jsonb; -- raw assistant blocks (thinking, compaction)
ALTER TABLE conversation_messages ADD COLUMN run_id uuid REFERENCES ai_runs(id) ON DELETE SET NULL;
ALTER TABLE ai_tasks ADD COLUMN current_run_id uuid REFERENCES ai_runs(id) ON DELETE SET NULL;
ALTER TABLE ai_usage_ledger
  ADD COLUMN run_id uuid REFERENCES ai_runs(id) ON DELETE SET NULL,
  ADD COLUMN cache_read_tokens  integer NOT NULL DEFAULT 0,
  ADD COLUMN cache_write_tokens integer NOT NULL DEFAULT 0;
```

**How existing tables relate:**

- `ai_task_messages` (agent task state) is migrated into `ai_run_messages`, then dropped in a later release.
- Delta events are coalesced, at most one `delta` row per 250 ms per run, so the event table stays small.
- `ai_run_events` older than 7 days are deleted nightly. The final transcript lives in `conversation_messages` / `ai_tasks.result`.

### 14.4 Model capabilities for long work — NEW columns on `ai_models`

```sql
ALTER TABLE ai_models
  ADD COLUMN long_run_allowed        boolean NOT NULL DEFAULT false, -- admin opt-in per model
  ADD COLUMN supports_effort         boolean NOT NULL DEFAULT false,
  ADD COLUMN default_effort          varchar(10),
  ADD COLUMN supports_thinking       boolean NOT NULL DEFAULT false,
  ADD COLUMN supports_compaction     boolean NOT NULL DEFAULT false, -- server-side compaction
  ADD COLUMN supports_context_editing boolean NOT NULL DEFAULT false,
  ADD COLUMN supports_task_budget    boolean NOT NULL DEFAULT false,
  ADD COLUMN supports_prompt_cache   boolean NOT NULL DEFAULT false,
  ADD COLUMN accepts_sampling_params boolean NOT NULL DEFAULT true;  -- false = never send temperature/top_p
```

**How the flags are filled:**

- Discovery and the model test (§6.5–§6.6) fill them where the provider exposes them. The Anthropic `GET /v1/models` response includes `max_input_tokens`, `max_tokens` and `capabilities`. The admin can override.
- **Sampling params:** today the gateway always sends `temperature` (`MODE_TEMPERATURE`). Recent Claude models reject `temperature` / `top_p` / `top_k` with a 400 (on the `2026-10-21` API version, every model). The adapter must omit them when `accepts_sampling_params = false`, and the Anthropic test probe sets the flag from the response.
- **Long-run use:** only models with `long_run_allowed = true` and `supports_tools = true` may be used for long runs. The picker shows the badge **"Kerja panjang"** on them.

### 14.5 Run lifecycle

**Starting a run.**

- **Agent tasks** always run as runs. `TaskRunnerService.enqueue()` creates an `ai_runs` row instead of pushing to the in-memory queue.
- **Conversation turns** stay synchronous-streamed by default, as today. A turn becomes a run when either:
  - the user turns on **"Kerja panjang"** in the composer; or
  - the turn crosses an automatic threshold: more than 3 tool iterations, or more than 90 s elapsed. The turn is then **promoted** into a run in place, with no user action, and the UI switches to the run view (§14.9).
- **Admission checks** before queueing:
  - the model is allowed (§6.2) and `long_run_allowed`;
  - the user has fewer than `ai.long_run.max_concurrent_per_user` active runs (default 2);
  - the quota has some headroom.

  A failed check returns 409/429 with a clear message.

**Workers.**

- **Who runs them:** `RunWorkerService` (NEW, replaces the in-process queue) runs in every API instance, or in a separate `worker` process started with the same image. It is enabled by env `AI_WORKER_ENABLED`, and its concurrency comes from `AI_WORKER_CONCURRENCY` (default 3).
- **Claiming:** a worker claims runs with `SELECT … FROM ai_runs WHERE status = 'queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`. It sets `status = 'running'`, `lease_owner`, `lease_expires_at = now() + 60 s`.
- **Heartbeat:** every 20 s the worker extends the lease. A run whose lease expires (worker crashed, deploy) is re-queued by any worker with `attempt + 1`. After 3 attempts it is `failed` with "Proses terhenti berulang kali".
- **Resume:**
  - A resumed run rebuilds its messages from `ai_run_messages` and continues.
  - Tool calls whose `ai_run_tool_calls.status = 'succeeded'` are **not** re-executed; their stored result is reused.
  - A call left in `started` is re-executed only for read-only tools. Write tools are marked failed with "Status tidak diketahui setelah gangguan — periksa sistem tujuan", so side effects are never doubled.
- **Shutdown:** on `SIGTERM` the worker stops claiming, finishes the current provider call, checkpoints, releases its leases (`status = 'queued'`), and exits. Deploys don't lose work.

**Stopping conditions.** Each is stored as the final `status`, with a `done` event:

| Condition | Status | User sees |
|---|---|---|
| Model ends without tool calls | `completed` | Final answer |
| Asks the user a question / needs approval | `waiting_input` / `waiting_approval` | Existing needs_input / approval flows, now generic for runs |
| `iterations ≥ max_iterations` (default `ai.long_run.max_iterations` = 60) | `budget_exhausted` | "Batas langkah tercapai" + **"Lanjutkan"** (adds another block of iterations, re-checking quota) |
| Run token budget used up | `budget_exhausted` | Same, with token figures |
| User quota exhausted mid-run (§6.4) | `budget_exhausted` | The quota error, with **"Lanjutkan dengan model bawaan"** |
| `now() > deadline_at` (default `ai.long_run.max_minutes` = 60) | `deadline_exceeded` | "Waktu kerja habis" + **"Lanjutkan"** |
| User presses Hentikan | `cancelled` | Partial work kept |

When a run is resumed with "Lanjutkan", the model first gets a mid-conversation system note (§14.7): "Lanjutkan dari titik terakhir; jangan mengulang pekerjaan yang sudah selesai."

### 14.6 Per-call behaviour and context management

**Streaming and timeouts (all providers).**

- Long runs **always stream**, so a minutes-long turn doesn't hit an HTTP timeout.
- The 60 s total timeout is replaced, for runs, by:
  - an **idle timeout** (`AI_STREAM_IDLE_TIMEOUT_MS`, default 120 s, with no bytes received);
  - a **per-call ceiling** (`AI_CALL_MAX_MS`, default 15 min).
- Interactive chat keeps `AI_TIMEOUT_MS`.
- `max_tokens` for a run call is `min(model.max_output_tokens, 64 000, remaining quota/budget)`.
- **Stop reasons:**
  - `max_tokens` → the next iteration asks the model to continue;
  - `pause_turn` (Anthropic server tools) → the same request is resent with the paused content appended;
  - `refusal` → §14.7.

**Context budget (all providers).**

- Before each call the gateway estimates the request size in tokens. It uses the provider's token-count endpoint when available (Anthropic `POST /v1/messages/count_tokens`), else `ceil(chars / 4)`.
- The message-count limits in `AI_LIMITS` no longer apply to runs.
- The gateway keeps the request under `model.context_window` with three layers, applied in order:

| Layer | When | Anthropic models with the capability | Other providers (neutral fallback) |
|---|---|---|---|
| 1. **Context editing**: clear old tool results | estimated input > 50 % of `context_window` | Server-side `context_management.edits: [{type: "clear_tool_uses_20250919"}]` (beta `context-management-2025-06-27`). The harness stays append-only. | Replace the content of tool results older than the last 8 with `"[hasil tool lama dihapus untuk menghemat konteks]"` |
| 2. **Compaction**: summarize earlier context | estimated input > 75 % of `context_window` (Anthropic default trigger: 150K tokens) | Server-side compaction: `context_management.edits: [{type: "compact_20260112"}]`, beta `compact-2026-01-12`. **The full `response.content`, including the `compaction` block, must be stored and sent back**, never just the text. | A summarizing call on the same model (or the default model) produces a "ringkasan kerja" (goal, decisions, files/documents produced, open items). Older messages are replaced by it in the **request**, and the full transcript stays in `ai_run_messages`. Recorded as a `compaction` event. |
| 3. **Memory**: persist across runs | at the end of every run | Central memory (`docs/LLM-requirement.md`) extracts durable notes, as today | Same |

**Provider-native blocks must survive the round trip.**

- **Why:** on recent Claude models (Claude Opus 5.5, Claude Sonnet 5.5, Claude Fable 5.x), thinking blocks are tied to the model and the conversation ("preserved thinking"). Anthropic validates that the replayed history was not edited. Accounts created on or after 2026-08-31 are enforced.
- **Storing:** `ChatMessage` (`providers/types.ts`) gains `providerContent?: unknown[]`. The Anthropic adapter stores the raw assistant `content` array there, with thinking, compaction and tool_use blocks, in `ai_run_messages` / `conversation_messages.provider_content`.
- **Replaying:** the blocks are sent back **unchanged** on the next request to the same provider. When the conversation switches to another model, they are still sent: the API silently drops blocks the new model can't read. Adapters for other providers ignore `providerContent`.
- **Append-only:** for these models the harness must not trim, reorder or rewrite earlier turns. Context is reduced only through the server-side layers above, so the neutral-fallback layers 1–2 are **disabled** for Anthropic models that support them.

**Effort and thinking.**

- **Run effort:** a run carries `effort`, sent only when `supports_effort`. Defaults:
  - the model's `default_effort` for chat;
  - `high` for agent tasks and long runs, because long-horizon agentic work benefits from higher effort.

  The user can choose **Cepat / Seimbang / Teliti** (low / medium / high) in the "Kerja panjang" dialog.
- **Anthropic:** effort is `output_config.effort`. Thinking is adaptive on current Claude models: omit `thinking` or send `{type: "adaptive"}`. **Never** send `budget_tokens` or `{type: "disabled"}`, which return 400 on Claude Opus 5.5.
  - **Showing reasoning:** to show reasoning progress, request `thinking.display: "summarized"`. On models that support it, `"updates"` (beta `thinking-display-updates-2026-08-18`) returns short between-tool progress notes, rendered as `progress` events.
  - **Note on Claude Opus 5.5:** its effort default is `medium`, so always send effort explicitly.
- **Other providers:** use their equivalent (`reasoning_effort` for OpenAI reasoning models) when the catalog flag is set. Otherwise effort is ignored.

**Token budget awareness.**

- **When the model supports task budgets:** the run's remaining budget is passed as `output_config.task_budget: {type: "tokens", total}` (beta `task-budgets-2026-03-13`, minimum 20 000). The model then paces itself and finishes gracefully instead of being cut off.
  - Leave `remaining` unset during a normal loop.
  - Pass `remaining` only after neutral compaction rewrote history.
- **Other models:** a short mid-run system note every 10 iterations ("Sisa anggaran: ~N token, M langkah") serves the same purpose.

**Prompt caching** (cost and latency of long runs).

- **Stable prefix:** keep the system prompt and tool list byte-stable for the whole run. Volatile data (time, budget notes, reminders) goes in later messages, never in `system`.
- **Anthropic** (`supports_prompt_cache`): one explicit `cache_control` breakpoint on the system prompt, plus top-level automatic caching for the conversation tail. On models that support mid-conversation system messages, operator notes (budget reminders, "Lanjutkan") are appended as `{role: "system"}` messages instead of editing `system`, which would invalidate the cache.
- **Model switching:** changing models mid-run invalidates the cache, so a run keeps one model. Switching models applies from the next run.
- **Usage:** `cache_read_input_tokens` / `cache_creation_input_tokens` are stored in the ledger (§14.3). **Quota counts all input tokens, cached or not** (§13 D12).

### 14.7 Safety, refusals and fallbacks

- **Refusals:** a `stop_reason: "refusal"` from an Anthropic model (with `stop_details.category`) ends the run as `failed` with "Model menolak melanjutkan permintaan ini". It is audited with the category.
- **Fallback to another model** is allowed **only to a model the user may use** (§6.2). Anthropic's server-side `fallbacks` parameter (beta `server-side-fallback-2026-07-01`) is used in its **array form** naming the user's allowed Anthropic fallback model, never `"default"`, because `"default"` could route to a model nobody granted. If no allowed fallback exists, there is no fallback.
- **Ledger for fallbacks:** the ledger records the model that actually served (`response.model` / `usage.iterations`), so quotas are charged to the right model.
- **Guardrails** (`GuardedProvider`) wrap every call of the run, including compaction and summarizing calls.
- **Write tools** still go through the existing approval flow. A run waiting for approval releases its worker (`waiting_approval`) and costs nothing while it waits.

### 14.8 Prompting for long runs

The long-run system prompt (`prompts.ts`, NEW `LONG_RUN_RULES`) adds three instructions, adapted from Anthropic's long-running agent recommendations:

1. **Act, don't over-plan:** "Bila informasi sudah cukup untuk bertindak, bertindaklah. Jangan mengulang fakta yang sudah ditetapkan atau memperdebatkan ulang keputusan pengguna."
2. **Grounded progress:** "Sebelum melaporkan kemajuan, cocokkan setiap klaim dengan hasil tool di sesi ini. Laporkan hanya pekerjaan yang ada buktinya; jika belum terverifikasi, katakan terus terang."
3. **Self-check on a cadence:** "Tetapkan cara memeriksa hasil kerja Anda sendiri dan jalankan secara berkala terhadap spesifikasi tugas."

A client-side tool **`kirim_pembaruan({ pesan })`** lets the model send a verbatim progress update or partial result mid-run. Its input is rendered as-is in the run view, and the tool result is a plain acknowledgement. Routine narration doesn't need it.

### 14.9 API — NEW

| Method & path | Permission | Notes |
|---|---|---|
| `POST /ai/runs` | mode permission (`ai.secondbrain.query` / `ai.counterpart.analyze`) | `{ conversationId?, prompt, modelId?, effort?, tokenBudget?, maxMinutes? }`. Starts a long conversation turn and returns `{ runId }`. `maxMinutes` ≤ `ai.long_run.max_minutes`. |
| `GET /ai/runs/:id` | owner (or task owner) | Status, iterations, tokens, budget, deadline, model, last error |
| `GET /ai/runs/:id/events` | owner | **SSE** with `Last-Event-ID` support: replays events after that id, then tails live. Uses Postgres `LISTEN/NOTIFY` (channel `ai_run_<id>`), with polling every 2 s as a fallback. Disconnecting never affects the run. |
| `POST /ai/runs/:id/cancel` | owner | Sets `cancelled`. The worker aborts the in-flight call within a few seconds (it checks the status on every heartbeat and between stream chunks). |
| `POST /ai/runs/:id/continue` | owner | Only for `budget_exhausted` / `deadline_exceeded`. Optional `{ extraIterations, extraMinutes, modelId }`. Re-checks quota and admission. |
| `GET /ai/runs?status=active` | `ai.workspace.access` | The caller's active and recent runs, for the "Proses berjalan" list |
| `GET /admin/ai/runs` | `ai.models.manage` | All active runs with worker, lease and attempt. Admins can cancel any run. |

`POST /ai/chat/stream` keeps working for short turns. When a turn is promoted to a run (§14.5), the stream sends a final event `run_started { runId }` and closes, and the client switches to `GET /ai/runs/:id/events`.

**Config keys** (admin "Model AI" screen, card **"Kerja panjang"**):

| Key | Default | Meaning |
|---|---|---|
| `ai.long_run.max_minutes` | `60` | Wall-clock deadline per run |
| `ai.long_run.max_iterations` | `60` | Tool-loop iterations per run (per "Lanjutkan" block) |
| `ai.long_run.max_concurrent_per_user` | `2` | Active runs per user |
| `ai.long_run.auto_promote` | `true` | Promote long chat turns to runs automatically |
| `ai.long_run.default_token_budget` | `null` | Optional per-run token budget; quotas apply regardless |

**Env:** `AI_WORKER_ENABLED`, `AI_WORKER_CONCURRENCY`, `AI_STREAM_IDLE_TIMEOUT_MS`, `AI_CALL_MAX_MS`.

### 14.10 UI

- **Composer (Multi Brain & Partner):**
  - a **"Kerja panjang"** toggle next to the model picker, shown only when the selected model has `long_run_allowed`;
  - when on, a small dialog sets effort (Cepat / Seimbang / Teliti) and the time limit.
- **Run view** inside the conversation, replacing the typing indicator for runs:
  - **Header:** status chip, elapsed / limit time, step counter ("Langkah 14 / 60"), tokens used vs budget and quota, **Hentikan** button.
  - **Live timeline:** progress notes, tool calls (existing `ToolTraceList.vue`), "Konteks diringkas" markers for compaction events, documents created.
  - **Live answer:** streamed text in the existing `ChatMessage` rendering.
  - **When stopped by a budget/deadline:** the reason and **"Lanjutkan"**.
- **Reconnect:** reopening the conversation (another tab, after closing the browser, on another device) reattaches to the run through `Last-Event-ID` and shows the full timeline.
- **"Proses berjalan"** indicator in `AppHeader.vue` with the count of the user's active runs. Clicking it lists them with links.
- **Notification** (existing notifications menu) when a run finishes, fails, or waits for input/approval, if the user isn't viewing it.
- **Agent tasks** (`AgentsPanel.vue` / task detail) use the same run view component.
- **Admin:** "Model AI" gets a **"Kerja panjang"** switch per model, the capability chips of §14.4, the "Kerja panjang" config card, and a table of active runs (worker, attempt, lease).

### 14.11 Acceptance criteria (long runs)

Add to `apps/api/test/integration/ai-runs.e2e-spec.ts`. The adapter mock streams scripted turns with configurable delays.

| # | Scenario | Expected |
|---|---|---|
| AC35 | Start a run, then close the SSE connection after the first event | Run continues to `completed`; reconnecting with `Last-Event-ID` replays the missed events in order |
| AC36 | Worker process killed mid-run (lease expires) | Another worker resumes with `attempt = 1` from the last checkpoint; completed tool calls are not re-executed; final answer identical to an uninterrupted run |
| AC37 | Crash while a **write** tool is `started` | On resume that call is marked failed with the "status tidak diketahui" message; it is not executed twice |
| AC38 | A single model turn streams for 5 minutes with steady chunks | Not aborted (idle timeout not reached); `AI_TIMEOUT_MS = 60 s` does not apply to runs |
| AC39 | Stream stalls 130 s with no bytes | Call aborted by the idle timeout; the iteration is retried once, then the run fails with a clear message |
| AC40 | Run reaches `max_iterations` | `budget_exhausted`; "Lanjutkan" adds another block; the model receives the continuation system note |
| AC41 | Deadline passes mid-run | `deadline_exceeded` after the current call; partial work kept |
| AC42 | User quota exhausted at iteration 7 | `budget_exhausted` with the quota error; "Lanjutkan dengan model bawaan" switches the run to the default model |
| AC43 | Neutral model, context grows past 75 % of `context_window` | One compaction call; next request contains the summary instead of the older messages; full transcript still in `ai_run_messages`; `compaction` event emitted |
| AC44 | Anthropic model with `supports_compaction` | Request carries the `compact-2026-01-12` beta and `compact_20260112` edit; returned `compaction` block is stored in `provider_content` and sent back verbatim next turn; no client-side trimming happens |
| AC45 | Anthropic model, two turns with thinking blocks | Second request replays the first turn's raw blocks unchanged (byte-equal JSON) |
| AC46 | Anthropic model with `accepts_sampling_params = false` | Request contains no `temperature` / `top_p` / `top_k` |
| AC47 | Chat turn exceeds 3 tool iterations with auto-promote on | The stream emits `run_started` and closes; the run finishes in the worker; the conversation shows the result |
| AC48 | User starts a third concurrent run (limit 2) | 409 "Masih ada 2 proses berjalan" |
| AC49 | Refusal on an Anthropic model, user allowed another Anthropic model | Request used `fallbacks` array naming only that model; ledger charged to the serving model; never `fallbacks: "default"` |
| AC50 | `SIGTERM` during a run | Worker finishes the current call, checkpoints, sets the run back to `queued`; another worker completes it |
| AC51 | Cancel while a call streams | The call is aborted within 5 s; status `cancelled`; usage up to that point recorded |
