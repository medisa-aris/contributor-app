# Rebrand Guidance — Contributor AI → BARA for PT Berau Coal

> **Pembaruan:** nama produk final adalah **BeLead AI — Berau Coal Leadership AI Companion** (menggantikan usulan BARA di dokumen ini). Yang berubah hanya nama tampilan, prompt, dan konfigurasi `app.name`; identifier teknis (`@bara/*`, `*@bara.local`, `BARA_INFRA_*`, nama container Docker) sengaja tidak diganti.

> Status: **proposal / guidance**. No code has been changed. The recommended name is **BARA**; if leadership picks another name, substitute it everywhere below (`BARA` / `bara`).
> Facts about PT Berau Coal (values, brand assets, policies) must be confirmed with the company's Corporate Communications and HR before publishing. Nothing here is taken from official Berau material.

---

## 1. Name

| Option                 | Meaning                                                                        | Notes                                                                      |
| ---------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| **BARA** (recommended) | _Bara_ = ember; also a nod to coal. Tagline: _"Nyalakan potensi manajer."_    | Short, memorable, clearly Berau. Check ESG sensitivity of the coal link.   |
| Pandu                  | Guide / pathfinder.                                                            | Warm, mentoring tone. Common word, harder to own.                          |
| Nakhoda                | Ship's captain.                                                                | Strong leadership image, heavier tone.                                     |

**Product name:** `BARA — Berau Leadership AI Companion`
**Tagline:** _Nyalakan potensi manajer._ (Ignite manager potential.)

### Mode names (user-facing)

> Decision: English labels are used instead of the Bahasa proposals (Pustaka, Mitra Pikir, Asisten Eksekusi).

| Today (code / README) | New label (Bahasa)  | Role                                          |
| --------------------- | ------------------- | --------------------------------------------- |
| Second Brain          | **Multi Brain**     | Knowledge keeper, answers with citations      |
| Counterpart           | **Partner**         | Challenges assumptions, root-cause, trade-offs |
| Subordinate           | **Subordinate**     | Executes tasks; human approval for sensitive actions |

Keep the internal identifiers (`second_brain`, `counterpart`, `subordinate`, permission keys, DB enums) unchanged. Only labels change, so no data migration and no RBAC breakage.

---

## 2. Background and why it matters

- Managers sit between strategy and operations and lose time to reporting, coordination, and searching SOPs and past decisions.
- Coal is cyclical and cost-sensitive; decision speed and quality affect unit cost, safety, and compliance.
- Sites are distributed; knowledge lives in individuals and local files and leaves when people do.
- Unmanaged "shadow AI" is likely already in use. A governed, company-owned tool lowers data-leak risk and supports UU PDP (Law 27/2022) compliance.
- The platform already provides RBAC with audit, human approval for sensitive actions, cited answers, and no credential leakage, which is a sound base for a controlled rollout.

**Outcomes:** manager productivity, better decisions, retained knowledge, safer/compliant AI use, and AI-ready leadership capability.

---

## 3. Brand identity

- **Voice:** professional, respectful, plain Bahasa Indonesia. Supportive, never "replacing you". Avoid hype.
- **Positioning line:** _"BARA membantu manajer berpikir lebih tajam dan bekerja lebih cepat — keputusan tetap di tangan Anda."_
- **Visuals (to be supplied by Berau Corporate Communications):** official logo usage rules, color palette, typography. Do not invent or imitate Berau Coal's logo or marks; use only assets they provide.
- **Suggested starting palette** (replace with official brand colors): warm ember orange accent on a dark neutral, with WCAG AA contrast checked in light and dark themes.
- **Co-branding:** "BARA" product mark plus "PT Berau Coal" lockup in header, login page, and exports, per brand guidelines.

---

## 4. Rebrand change list (this repository)

Scope found by searching the repo for the current name. Approximate counts are from a search at the time of writing.

### 4.1 Display strings (low risk, do first)

| Location                                                      | Change                                                                                              |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `apps/web/index.html` (`<title>`, meta description)           | New product name and description                                                                    |
| `apps/web/src/i18n/locales/id.ts` (`appName`, login subtitle, showcase text, `exportMeta`) | New name; add mode labels (Multi Brain, Partner, Subordinate) |
| `apps/web/src/stores/config.store.ts` (default `appName`)     | New default                                                                                         |
| `apps/web/src/views/ShowcaseView.vue` (breadcrumb)            | Use i18n/app name instead of a literal                                                              |
| `apps/web/src/views/HomeView.vue`, `layouts/AppShell.vue`      | Review hero copy, header logo, tagline                                                              |
| `apps/api/src/common/swagger/setup-swagger.ts`                | Swagger title                                                                                       |
| `apps/api/src/modules/admin/config.controller.ts`             | Fallback `appName`                                                                                  |
| `packages/shared/src/config-keys.ts` (`app.name` default)     | New default                                                                                         |
| `apps/api/src/modules/ai/prompts.ts`                          | Assistant persona/system prompts: new product name, Berau-appropriate tone, Bahasa-first behaviour  |
| `README.md`, `docs/*.md`                                      | Product name and descriptions                                                                       |

Prefer reading the name from config (`app.name`) over literals so a future rename is a data change.

### 4.2 Database config (needs a migration)

- `app.name` is seeded in migration `1700000001000-seed-rbac-meta-and-app-config.ts` and duplicated in `apps/api/test/integration/helpers/reset-db.ts`.
- **Do not edit the old migration** (it has already run on existing databases). Add a new migration that updates the `app.name` row, and update the test helper and `admin-platform.e2e-spec.ts` expectation (`toBe('Contributor AI')`).
- Add optional new config keys if wanted: `app.tagline`, `app.org_name`.

### 4.3 Technical identifiers (medium risk, do as one coordinated change)

| Item                                                                 | Current                                             | Suggested                                         |
| -------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------- |
| Root package name                                                    | `contributor-ai`                                    | `bara`                                            |
| Workspace scope (about 64 files import `@bara/*`)             | `@bara/shared`, `/api`, `/web`               | `@bara/shared`, `@bara/api`, `@bara/web`          |
| Outbound User-Agents                                                 | `ContributorAI-SourceFetcher/1.0`, `contributor-ai-healthcheck/1.0` | `BARA-SourceFetcher/1.0`, `bara-healthcheck/1.0` |
| Demo emails (`seed.ts`, README)                                      | `*@bara.local`                               | `*@bara.local`                                    |
| Script env vars (`scripts/infra.sh`)                                 | `CONTRIBUTOR_INFRA_HOST`, `CONTRIBUTOR_INFRA_DIR`   | `BARA_INFRA_HOST`, `BARA_INFRA_DIR` (accept old as fallback for a release) |
| Docker project / containers (`infra/docker-compose.yml`, `infra.sh`) | `contributor-ai`, `contributor-ai-postgres/redis`   | `bara`, `bara-postgres/redis`                     |

Scope rename tips: use a single commit; run `npm install` to refresh the lockfile; `npm run typecheck`, `npm run lint`, `npm test` must pass. Search both `@bara/` and relative path references (`jest.config.js`, `tsconfig.base.json`, Vite aliases).

### 4.4 Do NOT rename in the first pass (high risk)

- **Database names and users** (`contributor_ai`, `contributor_ai_test`, role `ca`) and `DATABASE_URL` values. Renaming needs a data migration and downtime coordination. Keep them and only rename later in a planned maintenance window.
- **CSS class prefix `Ca*` / `ca-`** (design-system components such as `CaBreadcrumb`). It is an internal prefix, invisible to users. Rename only if the team wants a clean break.
- **Permission keys, enums, audit event names, table names.** These are stored data; changing them breaks RBAC and audit history.
- **Existing accounts.** Do not change real users' emails when demo emails change.

### 4.5 Visual assets

- Add logo/favicon files (the web app has no `public/` folder yet; create one) and reference them from `index.html` and `AppShell.vue`.
- Update design tokens in `apps/web/src/styles/tokens.css` (brand/accent colors, light and dark), then check `base.css` and `admin.css` for hard-coded colors.
- Update export headers and any report templates (the chat export uses `exportMeta`).

### 4.6 Suggested order

1. Branch `rebrand/bara`.
2. Display strings and i18n (4.1) plus a new migration for `app.name` (4.2).
3. Visual tokens and logo (4.5).
4. Identifier rename in one commit (4.3).
5. Docs/README. Run typecheck, lint, tests; verify login, home, the three modes, and an export in the browser.
6. Hold DB/prefix renames (4.4) for a later, planned change.

---

## 5. Implementation — technology

**Identity and access:** SSO with Berau's directory (Entra ID / AD via OIDC or SAML), mapped to the existing RBAC roles; scope by site, department, and manager level.

**Hosting and data:** run in Berau's infrastructure or tenant; private LLM endpoint with no training on company data; classify data (public / internal / confidential); move from the dev Docker Compose host to a production setup with HA, backup, and monitoring.

**Knowledge Center:** load SOPs, HSE, regulations, and policies first. Give every source an owner and review/expiry date so answers stay current.

**Integration Center (MCP/REST):** start read-only (ERP, HSE incidents, production/fleet reports, HRIS). Add write actions later, only through the approval queue.

**Agent Center:** launch with 5–10 high-value agents, such as weekly performance report, meeting minutes with actions, SOP Q&A, and site-visit prep.

**Controls and quality:** token budgets per department and a cost dashboard, audit review, prompt-injection defence for URL attachments, PII redaction, a real-question evaluation set, and a feedback control on every answer.

---

## 6. Implementation — soft skills

| Mode             | Skill built                                   | Training focus                                                          |
| ---------------- | --------------------------------------------- | ----------------------------------------------------------------------- |
| Multi Brain      | Knowledge stewardship, source verification    | "Trust, but cite and verify"                                            |
| Partner          | Critical thinking, openness to challenge      | Better questions, devil's-advocate drills, bias awareness               |
| Subordinate      | Delegation and accountability                 | Writing precise briefs, reviewing output, what never to delegate        |

Also: ethical judgment (when not to use AI, data handling), data-informed decisions, coaching teams to use AI, learning agility, and psychological safety.

**Format:** 4–6 weeks; a short workshop, one real work challenge per week, and peer sharing. Each manager brings one real problem and solves it with BARA.

---

## 7. Change management (ADKAR for individuals, Kotter for the organization)

| Phase              | Timing        | Key actions                                                                                                                                          |
| ------------------ | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Prepare         | Weeks 0–4     | Executive sponsor; steering group (HR, IT, Legal, HSE, Operations); AI usage policy; choose pilot sites/managers; baseline time on reports and decision cycle |
| 2. Pilot           | Weeks 5–12    | 30–50 managers across 2–3 functions/sites; BARA Champions (respected peers); weekly feedback and quick fixes                                          |
| 3. Scale           | Months 4–9    | Wave rollout, train-the-trainer; add integrations/agents from pilot demand; leaders model usage in meetings                                           |
| 4. Sustain         | Month 9+      | Embed in manager expectations, onboarding, and leadership curriculum; quarterly review of value, risk, cost                                            |

**Communication:** sponsor-led message — _"AI augments managers, it does not replace them."_ Share concrete pilot wins in plain Bahasa. Address fears openly (job loss, monitoring, mistakes) and state what the audit log is and is not used for.

**Resistance:** tie value to each group (time for field managers, decision quality for senior leaders, controls for Legal/IT); give a safe place to practice and an easy first use case.

**Rebrand-specific comms:** announce the new name with a short "what changes / what does not" note (same login, same data, same permissions; new look and name). Keep a redirect or notice at the old address and name for one release cycle.

---

## 8. KPIs

| Type       | Examples                                                         |
| ---------- | ---------------------------------------------------------------- |
| Adoption   | Weekly active managers, repeat usage, agents used                |
| Value      | Hours saved per manager per week, report turnaround, decision cycle time |
| Quality    | Helpfulness rating, citation accuracy, escalations               |
| Risk       | Policy violations, sensitive-data incidents, approval-queue turnaround |
| Capability | Training completion, self-assessed confidence, manager survey    |
| Cost       | Cost per active user, token use vs. budget                       |

---

## 9. Risks and mitigations

| Risk                                   | Mitigation                                                          |
| -------------------------------------- | ------------------------------------------------------------------- |
| Trust lost after a wrong answer        | Citations, feedback loops, honest limits shown in the UI            |
| Stale or weak content                  | Document owners, expiry dates, freshness review                     |
| Leaders not using it                   | Sponsor and leaders visibly use it; include in meeting routines     |
| Uncontrolled cost                      | Budgets per department, dashboard, alerts                           |
| Rebrand breaks something               | Keep identifiers/DB names stable (4.4); one coordinated rename; full test run |
| Brand/IP misuse                        | Use only assets supplied by Berau Corporate Communications         |

---

## 10. Decisions needed

1. Final product name (BARA / Pandu / Nakhoda / other).
2. Official logo, palette, and typography from Berau Corporate Communications.
3. Executive sponsor and pilot sites.
4. Hosting model (Berau infrastructure vs. tenant) and approved LLM provider.
5. Whether to rename technical identifiers now (4.3) or only user-facing text (4.1, 4.2).
