# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.2.0] - 2026-07-08

### Added

- Added an `operations` profile for ITSM lifecycle work, with 64 tools: the
  default agent workflow plus change/release management, asset/CMDB lookup,
  procurement context, risk lookup, time tracking, and attachments.
- Added change and release read/write tools:
  `swsd_list_changes`, `swsd_get_change`, `swsd_create_change`,
  `swsd_update_change`, `swsd_list_releases`, `swsd_get_release`,
  `swsd_create_release`, and `swsd_update_release`.
- Added read-only asset, CMDB, procurement, and risk tools for hardware,
  mobile devices, printers, software, other assets, configuration items,
  contracts, purchase orders, vendors, and risks.
- Added time tracking tools for incidents, problems, changes, and releases:
  `swsd_list_time_tracks`, `swsd_log_time`, and
  `swsd_update_time_track`.
- Added `swsd_upload_attachment` with base64 input for hosted/HTTP clients
  and stdio-only local `file_path` support.
- Added `SWSD_WRITE_MODE=live|dry-run|disabled` and applied it to all write
  tools so operators can preview or block mutations without changing
  profiles.

### Changed

- The default `agent` profile now includes time tracking and attachment
  workflow tools, increasing from 33 to 37 tools.
- The `full` profile now exposes 66 tools across 15 categories.
- Copilot Studio Swagger artifacts now include the new `operations` profile.

## [2.1.1] - 2026-06-05

Patch release for public package metadata only. No API behavior changes.

### Fixed

- Refresh published npm and MCP Registry metadata after the repository rename/casing cleanup.
- Publish `server.json` to the MCP Registry from the trusted tag release workflow.
- Align the runtime MCP server version reported in banners, `User-Agent`, and `swsd_get_server_info` with `package.json`.

## [2.1.0] - 2026-05-08

The v2.1 release — strictly additive over v2.0.2. Closes the
"too-many-round-trips" UX gap surfaced in v2.0 user smoke testing
(every tool keyed on `id` only — agents had to call `swsd_list_*`
first to translate a human-facing `number` into an internal `id`)
and broadens the rich-UI surface from 4 widgets to 7. Adds two
entirely new tool families (Tasks, Problems) and a date-natural-language
alias on the two highest-traffic list tools.

### Added

- **Tools accept either id or human-facing number** on every id-keyed
  tool: `swsd_get_incident`, `swsd_update_incident`, `swsd_assign_incident`,
  `swsd_update_incident_state`, `swsd_link_solution_to_incident`,
  `swsd_list_incident_comments`, `swsd_add_incident_comment`,
  `swsd_update_comment`, `swsd_get_solution`, `swsd_update_solution`,
  `swsd_get_record_audits`. Eliminates the 4-round-trip "show me 60310"
  friction reported in v2.0.2 user smoke testing — agents can now pass
  the number visible in the SWSD UI directly. New shared utility
  `src/utils/idResolver.ts` disambiguates by digit count (≥7 digits =
  internal id, ≤6 digits = human-facing number) with a single targeted
  list lookup when ambiguous.
- **Date-natural-language alias** `updated_within: "7d" | "24h" | "1w" | "30d"`
  on `swsd_list_incidents` and `swsd_list_my_incidents`. Resolves to the
  same `updated_from` filter SWSD already accepts; lets agents say
  "incidents updated in the last 7 days" without computing ISO dates.
- **Tasks tools (3 new):** `swsd_list_incident_tasks`,
  `swsd_create_incident_task`, `swsd_update_task_state` for SWSD
  incident sub-task management. Inline-only (tasks are scoped to a parent
  incident, not first-class records).
- **Problems tools (3 new):** `swsd_list_problems`, `swsd_get_problem`,
  `swsd_create_problem` for ITIL problem-record management. Previously
  entirely unexposed — agents could not promote recurring incidents to a
  problem record without dropping back to the SWSD UI.
- **3 new widgets:**
  - **comment-thread** for `swsd_list_incident_comments` — vertical
    conversation with author chips, timestamps, public/private badges,
    and sanitized HTML bodies.
  - **audit-timeline** for `swsd_get_record_audits` — vertical timeline
    grouped by day with action chips and field-level diffs.
  - **catalog-item-form** for `swsd_get_catalog_item` — first widget to
    call back into the server via `app.callServerTool`. Renders catalog
    item variables as a form; submits via `swsd_create_service_request`.
    Collapses the 4-round-trip service-request workflow to 2.
- **`swsd_list_my_incidents` now renders the incident-list widget** (was
  previously text-only despite returning the same shape as
  `swsd_list_incidents`).
- **incident-detail widget enriched** with description (sanitized HTML),
  due date (with Overdue badge), SLA violations count, resolution body,
  and created date — fields the `?layout=long` API already returned but
  the widget never surfaced.

### Fixed

- **`swsd_list_my_incidents` and `swsd_list_incidents` now actually filter by user.**
  SWSD's `/incidents.json` endpoint **silently ignores** the `assignee_email` and
  `requester_email` query parameters — verified live 2026-05-08 against an admin
  token (a fake email returns the entire 56,829-row tenant; a real user's email
  returns the same 56,829). Latent since v2.0.0 (PR #26 introduced
  `swsd_list_my_incidents` assuming the filter worked); previously masked because
  the `applied_filters` echo claimed success while the data didn't match. Both
  tools now apply the party filter **client-side** after the response lands —
  case-insensitive exact-match on `assignee.email` / `requester.email`. The
  server-side filters that DO narrow (state, priority, category, dates, sites,
  departments, `assigned_to=<group_id>`, query) are unchanged. Output adds a
  `scan` block with `candidates_scanned` / `matches_in_page` / `client_filter_applied`
  so consumers can reason about what was actually narrowed where. For users with
  `available_for_assignment=false` (administrators), `swsd_list_my_incidents`
  surfaces an explicit caveat in the summary pointing at `assigned_to=<group_id>`
  as the working alternative. Independent OSS prior-art crosscheck: the Python
  competitor `cptncoconut/samanage-mcp` arrived at the same client-side-filter
  conclusion (their `_client_filter` helper docstring: *"Apply filters that the
  Samanage API does not reliably honour server-side"*).
- **incident-list widget overflow on narrow viewports.** The 6-column
  table is now wrapped in an `overflow-x: auto` container; scrolls
  instead of clipping at <560px wide.
- **incident-list missing sort indicator.** Sortable headers now display
  ▲/▼ + `aria-sort` on the active column.
- **solution-detail widget excerpt-only rendering.** Solutions now render
  the full sanitized HTML body — the whole point of opening a KB article.
- **All 7 widgets handle `isError: true`.** Tool errors now show a clear
  error state instead of an infinite "Loading…" spinner.
- **`InputError` no longer surfaces with "Unexpected error:" prefix.**
  `mapSwsdError` now recognizes the class and forwards the user-friendly
  message verbatim.
- **Dead CSS rule removed** from `incident-list/styles.css`
  (`th:focus-visible` outline that never fired because `<th>` elements
  have no `tabindex` and no keyboard handler).

### Changed

- `swsd_get_record_audits`: when `object_type` is `incidents` or
  `solutions`, the `id` field accepts either form (internal id ≥7 digits
  or human-facing number ≤6 digits). Other object types (`problems`,
  `changes`, `releases`, `hardwares`, `other_assets`) remain id-only
  until those entities gain list APIs to disambiguate against.

### Dependencies

- **Added:** `dompurify@^3.4.2` (no peer-deps, npm audit clean) for HTML
  sanitization in solution-detail, incident-detail, comment-thread, and
  catalog-item-form widgets.
- **Added (devDep):** `jsdom@^29.1.1` for DOMPurify-using sanitizer
  tests.

### Internal

- New shared utilities: `src/utils/idResolver.ts` (id-vs-number
  resolver) and `src/utils/dateAliases.ts` (`updated_within` parser).
- New shared UI helpers: `src/ui/shared/sanitizeHtml.ts` (DOMPurify
  wrapper), `src/ui/shared/error.ts` (`renderError`), and the
  consolidated `tests/unit/tools/_helpers/mockClient.ts` (eliminated
  ~571 lines of test-fixture duplication across 8 tool tests).
- Tool count after v2.1: `triage` 14, `agent` 33 (default), `knowledge`
  15, `full` 35 across 10 categories (added Tasks and Problems
  categories). Per-profile Swagger specs regenerated.

## [2.0.2] - 2026-05-07

Defense-in-depth security release. Addresses 4 findings from the new
Aikido Security integration plus 2 CodeQL alerts. No public API
changes; no behavior changes for legitimate inputs.

### Security

- **HTTP security headers via Helmet** (Aikido finding). The Express
  HTTP transport now mounts `helmet()` first in the middleware chain,
  so every response (including `/healthz`, errors, and 404s) carries:
  HSTS (`Strict-Transport-Security: max-age=31536000; includeSubDomains`
  — 1 year, Helmet 8.1.0's default), CSP
  (`Content-Security-Policy: default-src 'self'; ...`), `X-Frame-Options:
  SAMEORIGIN` (Helmet 8 default; restricts iframe embedding to same-origin,
  fine for our JSON-only API endpoints since no legitimate client iframes
  our responses), `X-Content-Type-Options: nosniff`, `Referrer-Policy:
  no-referrer`, Cross-Origin-Opener-Policy + Cross-Origin-Resource-Policy
  (both `same-origin`), and several legacy hardening headers. Defaults
  are correct for our JSON-only endpoints (no HTML, no scripts, no
  inline styles); no customization needed.
- **IPv6-aware rate-limit keying** (transitive, surfaced by the
  `express-rate-limit` 8.5.x bump). The `keyGenerator` now passes
  `req.ip` through `ipKeyGenerator` from `express-rate-limit` before
  hashing it with the token. For IPv4 this is a no-op. For **IPv6**,
  this collapses each /56 prefix (the library default) to a single
  rate-limit quota — without it, clients in the same /56 would have
  received separate quotas and effectively bypassed the limit. The
  behavior change is invisible to IPv4-only deployments. The 8.5.x
  library throws `ERR_ERL_KEY_GEN_IPV6` at startup if a custom
  `keyGenerator` skips this step, so the fix was non-optional once
  the dep was bumped.
- **`auth.ts` ReDoS hardening** (CodeQL `js/polynomial-redos`). The
  HTTP transport's `extractToken()` previously matched the
  `Authorization` header with `/^Bearer\s+(.+)$/i`. The `\s+` and
  `(.+)` overlap (`.` matches whitespace) creates polynomial
  backtracking on adversarial input like `Bearer ` followed by tens of
  thousands of spaces, which could tie up a worker thread. Replaced
  with a linear-time `startsWith` + `slice` + `trim` parse. Behavior
  is identical for legitimate inputs (case-insensitive Bearer prefix,
  trims whitespace, preserves JWT internal characters); ReDoS payloads
  now finish in microseconds instead of minutes. New
  `tests/unit/transports/auth.test.ts` (14 cases) pins the fix and
  includes a 100k-space adversarial regression test that completes in
  &lt; 100ms.
- **`loadUiResource` path-traversal defense** (Aikido finding,
  CodeQL-equivalent file-inclusion). `src/mcp/uiResources.ts` now
  validates the `name` parameter against a closed allowlist of the
  four UI bundle slugs (`incident-detail`, `solution-detail`,
  `incident-list`, `custom-fields`) before any path resolution or
  filesystem call. Today every caller is hardcoded, but the function
  is exported and could be misused; the allowlist removes the
  path-traversal concern entirely. Tests in
  `tests/unit/mcp/uiResources.test.ts` exercise rejection of
  `../../etc/passwd`, `..\\..\\Windows\\System32\\...`,
  `/etc/passwd`, embedded traversals, empty strings, and case
  variants.
- **`ip-address` XSS patched via dependency bump** (GHSA-v2v4-37r5-5v8g,
  Aikido finding). Bumped `express-rate-limit` from `8.4.1` to
  `^8.5.1`, which transitively pulls `ip-address@10.2.0` (the patched
  version, up from the vulnerable `10.1.0`). Removed the matching
  `osv-scanner.toml` `IgnoredVulns` entry — the suppression is no
  longer needed since the vulnerability is patched at the source.

### Internal

- New `.github/codeql/codeql-config.yml` scopes CodeQL analysis to
  `src/` only, excluding `scripts/` (maintainer-only utilities not
  shipped in the npm tarball), `tests/` (synthetic fixtures), `dist/`
  (generated output), `.research/` (gitignored probes),
  `node_modules/`, and `copilot-studio/`. Closes the
  `js/http-to-file-access` finding on `scripts/dump-custom-fields.ts`
  for the right structural reason: maintainer scripts where the user
  controls both the SWSD response and the output path are
  out-of-scope for production-code analysis.
- Net dependencies: added `helmet@^8.1.0` (one prod dep, ~30 KB
  unpacked); bumped `express-rate-limit` patch version. No new
  transitive vulnerabilities introduced (`npm audit` clean).

## [2.0.1] - 2026-05-07

### Fixed

- **MCP Apps widget protocol.** The four UI-bearing tools
  (`swsd_get_incident`, `swsd_get_solution`, `swsd_list_incidents`,
  `swsd_describe_custom_fields`) now use the canonical `App` class from
  `@modelcontextprotocol/ext-apps` for view ↔ host communication. The
  prior hand-rolled `{type:'init'}/{type:'ready'}` postMessage shape was
  incompatible with spec-compliant hosts (VS Code Insiders Copilot Chat,
  Claude Desktop, etc.) — the SDK's `PostMessageTransport` silently
  drops messages without `jsonrpc: "2.0"`, which left widgets stuck in
  their initial empty state in every spec host. Widgets now perform the
  spec-mandated `ui/initialize` → `ui/notifications/initialized` →
  `ui/notifications/tool-result` handshake via `App.connect()` and
  `addEventListener('toolresult', ...)`. Tool handlers, output schemas,
  and the wire shape on the server side are unchanged — this is purely
  a fix to the iframe-side data channel.
- Replaced our hand-rolled `applyHostThemeVariables` `--`-prefix guard
  with the SDK's `applyHostStyleVariables` (the type signature
  `McpUiStyles = Record<McpUiStyleVariableKey, string | undefined>`
  enforces the prefix at the type level, so the runtime guard is
  delegated to the spec). Also wires `applyDocumentTheme` and
  `applyHostFonts` so widgets respond to host theme + font changes,
  not just CSS variables.

### Internal

- Bundle size budget for UI artifacts raised from 200 KB to 500 KB to
  accommodate the canonical SDK (`tests/unit/ui/build.test.ts`).
  Empirical bundle size is ~340 KB raw / ~82 KB gzipped per widget.
  The change is metadata-only; the npm tarball grows from ~97 KB to
  ~320 KB compressed.
- Removed `tests/unit/ui/host.test.ts` — its 4 tests pinned a runtime
  `--`-prefix guard on the deleted `applyHostThemeVariables` helper.
  The SDK's `applyHostStyleVariables` enforces the same constraint at
  the type level, so the runtime test no longer applies.

## [2.0.0] - 2026-05-07

The v2 release. Strictly additive over v1.0.1 — no existing tool's input or
output schema changed, no tool was removed, no breaking change in any wire
contract. The major-version bump is for scope (5 new tools, MCP Apps UI
capability, identity tools, audits, custom-field writes, and the Service
Catalog category) rather than for SemVer-compatibility breakage.

Highlights:

- **Identity** — `swsd_get_me` decodes the JWT, looks up the authenticated
  user via `/users/{id}.json`, and returns user_id + email + groups so
  agents can answer "my X" queries without manual entry. `swsd_list_my_incidents`
  is the Asana-style wrapper.
- **MCP Apps UI** — four read tools (`swsd_get_incident`, `swsd_get_solution`,
  `swsd_list_incidents`, `swsd_describe_custom_fields`) ship rich UI bundles
  for hosts that support [SEP-1865](https://modelcontextprotocol.io/specification/2025-11-25).
  Hosts without MCP Apps support are unaffected.
- **Service Catalog** — three new tools (`swsd_list_catalog_items`,
  `swsd_get_catalog_item`, `swsd_create_service_request`) so agents can
  fulfill requests through SWSD's catalog instead of always creating
  generic incidents.
- **Audits** — `swsd_get_record_audits` exposes the per-record change log.
- **Custom-field writes** — `swsd_create_incident`, `swsd_update_incident`,
  `swsd_create_solution`, `swsd_update_solution` accept a `custom_fields`
  parameter that maps to SWSD's nested-wrapper write convention.
- **Scope discriminator** — list tools now return `pagination.total_scope`
  (`filtered` / `tenant` / `unknown`) and `applied_filters` echo so agents
  can distinguish "narrowed to my filters" from "all tenant data".

### Added (Tier 2 — v2 Service Catalog support)

- Three new tools that surface SWSD's Service Catalog:
  - `swsd_list_catalog_items` — paginated browse of catalog items with
    `state`, `department`, `site`, and free-text `query` filters. Returns
    compact summaries (id, name, state, category/subcategory, request_count,
    updated_at, variable_count). Carries the same Plan B
    `applied_filters` echo + `pagination.total_scope` discriminator as
    `swsd_list_incidents`.
  - `swsd_get_catalog_item` — single-item lookup that exposes the full
    `variables` array (the request form schema). Each variable carries
    `id` (consume as `custom_field_id` when submitting), `name`, `kind`
    (`free_text` / `drop_down_menu` / `multi_select` / `date` / `user`),
    `field_type` (numeric SAManage code), `options` (newline-separated
    allowed values for dropdowns), `required`, and `helptext`.
  - `swsd_create_service_request` — submits a request via
    `POST /catalog_items/{id}/service_requests.json`. The endpoint
    auto-sets `is_service_request: true` and inherits the catalog item's
    category/subcategory. Variables are sent as
    `request_variables_attributes` (Rails-style nested-attributes shape
    discovered through live probe — the read-shape `request_variables`
    field name is silently dropped by SWSD on this endpoint). Requester
    defaults to the JWT-authenticated user; the tool resolves the user's
    email via `GET /users/{id}.json` because this endpoint rejects
    `requester: {id}` and requires `requester: {email}`.
- Server `instructions` augmented with catalog-first guidance: when the
  user asks to "request" something, agents should call
  `swsd_list_catalog_items` → `swsd_get_catalog_item` →
  `swsd_create_service_request`, falling back to `swsd_create_incident`
  only when no catalog item matches.
- Tool counts after Plan E: `triage` 12, `agent` 27 (default),
  `knowledge` 15, `full` 29 across 8 categories (added the
  Service Catalog category). Per-profile Swagger specs regenerated.
- e2e smoke test (`.research/v2/smoke-tests/mcp-e2e-smoke.mjs`) extended
  with Test 8 verifying catalog endpoint integration end-to-end.

**Not shipped (deferred to v2.5):** `swsd_list_my_service_requests`. The
SAManage REST API has no documented filter parameter that narrows the
`/incidents.json` collection to service-request rows. We probed 14
candidate filters (`is_service_request=true`, `sub_type=*`,
`request_type=*`, `incident_type=*`, etc.) and all were silently ignored
(returned the unfiltered set). A wrapper that paginated through tens of
thousands of incidents to find the few service-request rows would be a
bad tool. Will revisit once SWSD documents the correct filter mechanism
or exposes a top-level `/service_requests.json` collection (currently
404).

### Added (Tier 1 — v2 MCP Apps capability)

- MCP Apps support (SEP-1865, spec 2025-11-25) for `swsd_get_incident`,
  `swsd_get_solution`, `swsd_list_incidents`, and
  `swsd_describe_custom_fields`. Capable hosts render rich UI (single-record
  detail views, filterable/sortable tables, searchable explorers); text-only
  clients are unaffected — the `_meta.ui.resourceUri` advertisement is
  silently ignored and the tools return their normal text + structured
  output. UI bundles are single-file inlined HTML (`text/html;profile=mcp-app`)
  with no external network access. New build pipeline (Vite +
  vite-plugin-singlefile) emits the bundles under `dist/ui/`; the server
  registers them via `registerAppTool` / `registerAppResource` from
  `@modelcontextprotocol/ext-apps@^1.7.1`.

### Changed

- Migrated dependency-update automation from Dependabot to Renovate. The
  `renovate.json` extends `mikimatsub/.github:renovate-config` (a central
  config repo shared across mikimatsub's projects), which itself extends
  the upstream `config:best-practices` preset. Notable behavior changes:
  3-day minimum-release-age on npm packages (supply-chain attack defense),
  weekly lock-file maintenance, abandonment detection, and pinned-digest
  helpers for Docker and GitHub Actions.

### Added (Tier 1 — v2 identity & scope)

- New tool `swsd_get_me` — JWT-payload decode + `GET /users/{id}.json` + optional `GET /profile.json` enrichment. Returns the authenticated user's id, email, name, role, department, site, group_ids, and assignment status. **Call this first when the request mentions "me", "my", or "I"** — server INSTRUCTIONS now teach the model this pattern.
- New tool `swsd_list_my_incidents` — thin wrapper that internally calls `swsd_get_me` then `swsd_list_incidents` with `assignee_email = your email`. Same input shape as `swsd_list_incidents` minus the `assignee_email` parameter. Asana-style explicit-my-X pattern (Stream 4 research).
- `applied_filters` echo + `pagination.total_scope` discriminator (`filtered` | `tenant` | `unknown`) on `swsd_list_incidents` and `swsd_list_my_incidents` responses. Closes the brief's scope-ambiguity failure mode in-band: the model can now distinguish "25 of 87 matching your filters" from "25 of 56,800 tenant-wide" without guessing. **No comparable MCP server in the ecosystem ships this** as of May 2026 (Linear, GitHub, Atlassian, Asana, ServiceNow, Notion, Slack, Stripe — verified during v2 research).
- Server `INSTRUCTIONS` augmented with whoami-first guidance — model receives this in the MCP `initialize` response, mirroring GitHub's `serverInstructions` "Always call get_me first" pattern.
- New JWT decoder helper (`src/swsd/jwt.ts`) — extracts user_ic + any other JWT claims locally, no HTTP cost. Defensive parsing returns null on any malformed input.

### Tests (Tier 1 — v2 identity & scope)

- New `tests/unit/swsd/jwt.test.ts` — 8 edge cases (sample SWSD JWT, ESM extra claims, invalid base64, non-JSON payload, non-object payload, defensive null/undefined inputs).
- New `tests/unit/mappers/me.test.ts` — 8 edge cases on `toUserMeRecord` (full record projection, /profile.json enrichment, defensive null handling, non-numeric id rejection, group_ids filtering of non-numeric entries).

### Added (Tier 1 — v2 custom-field writes)

- `custom_fields` parameter on `swsd_create_incident`, `swsd_update_incident`, `swsd_create_solution`, and `swsd_update_solution`. Accepts `[{name, value}]` rows. Name-keyed for cross-entity portability (Solutions reject `custom_field_id`-only keying with HTTP 400; Incidents accept either). Validated field types: Text, Dropdown, Number, Checkbox, Date.

### Fixed / Retracted

- The v0.5 documented limitation that "SWSD returns 500 on every payload variant tested" for custom-field writes was **incorrect**. v1's investigation tested only the array-direct shape `{custom_fields_values: [{name, value}]}`. The actual shape SWSD requires is the SAManage-documented nested wrapper `{custom_fields_values: {custom_fields_value: [{name, value}]}}` — confirmed live against the live tenant on May 6, 2026 and against the official `SAManage/Samples` Ruby code (https://github.com/SAManage/Samples/blob/master/Sync%20Users/sync_users.rb). The `swsd_describe_custom_fields` tool description and the server-level INSTRUCTIONS string have been updated accordingly.

### Added (Tier 1 — v2 quick wins)

- `detail_level: 'short' | 'long'` parameter on `swsd_get_incident` and `swsd_get_solution`. Use `'long'` to fold SWSD's `?layout=long` extras (comments, attachments, audits, SLA data, tags, statistics, satisfaction, resolution for incidents; attachments, audits, tags, full statistics for solutions) into one call. Replaces the typical 2–3 round-trip pattern.
- New tool `swsd_get_record_audits` — wraps `GET /{type}/{id}/audits.json` for `incidents`, `problems`, `changes`, `releases`, `solutions`, `hardwares`, and `other_assets`. In the `agent` and `full` profiles. Lets the model answer "who changed this and when?" without parsing layout=long.
- Expanded `swsd_list_incidents` filters: `sites`, `departments`, `assigned_to_group`, `created_from`/`created_to`, `updated_to`, `state_is_not`, `sort_by`, `sort_order`, free-text `query`. All forward-only — no breaking changes.
- `outputSchema` declared on all 15 read tools — enables client-side response validation, particularly useful for Microsoft Copilot Studio response shape validation.
- `upstream_rate_limit` block added to `swsd_get_server_info` output. Documents SWSD's account-wide rate limits (1000 cpm Advanced / 1500 cpm Premier; signal: `429 + Retry-After` only — no `X-RateLimit-*` headers).
- New tool `swsd_get_record_audits` registered in `agent` and `full` profiles, raising tool count from 23 to 24 across 7 categories (added the Audits category).

### Changed (Tier 1 — v2 quick wins)

- `@modelcontextprotocol/sdk` floor relaxed from exact `1.29.0` to `^1.26.0`. Picks up `GHSA-345p-7cg4-v4c7` (cross-client response-leak) fix as defense-in-depth even though v1's per-request server construction was already safe.

### Tests (Tier 1 — v2 quick wins)

- New `tests/unit/mappers/audit.test.ts` — 8 edge-case tests for `toAuditSummary`.
- New `tests/unit/toolNames.test.ts` — 25 tests asserting every tool in `PROFILE_TOOLS` matches the SEP-986 name regex (`^[a-zA-Z][a-zA-Z0-9_-]{0,127}$`). Defense against future drift.

## [1.0.1] - 2026-05-03

Patch release. Mechanical version bump only (`package.json` and `package-lock.json`) — no source-code or behavior changes versus v1.0.0. Published to npm 2026-05-04.

## [1.0.0] — _pending first publish_

### Initial public release

First public release on npm and GitHub. The pre-release work happened
across 11 commits on the `main` branch — full git history captures
the development trajectory.

#### Tools (23 total across 6 categories)

**Utility (2)** — `swsd_get_server_info`, `swsd_health_check`

**Incidents (7)** — `swsd_list_incidents`, `swsd_get_incident`,
`swsd_create_incident`, `swsd_update_incident`, `swsd_assign_incident`,
`swsd_update_incident_state`, `swsd_link_solution_to_incident`

**Comments (3)** — `swsd_list_incident_comments`,
`swsd_add_incident_comment`, `swsd_update_comment`

**Solutions / KB (4)** — `swsd_search_solutions`, `swsd_get_solution`,
`swsd_create_solution`, `swsd_update_solution`

**Lookups (6)** — `swsd_list_categories`, `swsd_list_sites`,
`swsd_list_departments`, `swsd_list_users`, `swsd_list_groups`,
`swsd_list_roles`

**Custom fields (1)** — `swsd_describe_custom_fields` (read-only;
writes deferred per documented investigation)

#### Profiles

* `triage` (9 tools) — first-line support workflow
* `agent` (21 tools, default) — full ticket-handler workflow
* `knowledge` (11 tools) — KB-author workflow
* `full` (23 tools) — every non-destructive validated tool

#### Architecture

* Dual transport: stdio (local agents) and Streamable HTTP (Copilot
  Studio + hosted)
* Zero credentials at rest — server never persists or logs tokens
* Stateless HTTP transport (per-request token)
* Origin validation, rate limiting (per token+IP), request timeout,
  trust-proxy configurable
* SWSD_BASE_URL hostname allowlist (`*.samanage.com`) — SSRF defense
* Defensive parsing for unknown SWSD response shapes
* 146 unit tests, all hermetic (no live API)

#### Distribution

* npm: `swsd-mcp` (public, free)
* Docker: `ghcr.io/mikimatsub/swsd-mcp:latest`
* MIT license

#### Build & supply chain

* GitHub Actions pinned to commit SHAs
* Dockerfile base image pinned by digest
* npm OIDC trusted publishing — no long-lived NPM_TOKEN
* SLSA build provenance attestations on every release
* Dependabot for npm, GitHub Actions, Docker base
* Branch protection on `main`

#### Documentation

* `README.md` — install, configuration, transports, distribution
* `CONTRIBUTING.md` — bug reports, PR review criteria, local dev
* `SECURITY.md` — vulnerability disclosure process (GitHub Security
  Advisories), threat model summary
* `docs/SECURITY-POSTURE.md` — comprehensive security posture write-up
  (controls, supply chain hardening, standards alignment, verification
  methods)
* `copilot-studio/README.md` — per-profile Swagger 2.0 connector specs
  with import procedure for Microsoft Copilot Studio

#### Empirically validated against live tenant

* All 23 tools exercised end-to-end (read + write smoke tests)
* SWSD API behavior findings documented in tool descriptions:
  - `?query=` is the canonical search parameter for solutions
  - `solution_ids` (write) vs `solutions` (read) shape divergence
  - `/custom_fields.json` ignores `per_page` (handled client-side)
  - Custom-field values cannot be written via SWSD API in tested
    payload variants — documented as known limitation

#### Known limitations

* Custom-field WRITES via incident/solution write tools are not
  supported (SWSD returns 500 on every payload variant tested).
  See `swsd_describe_custom_fields` description.
* Independent third-party security audit not commissioned.
* Source-code SAST (CodeQL) and Docker image scanning (Trivy) not
  yet enabled — `npm audit` covers npm CVEs.

---

## Pre-1.0 development history

Prior to v1.0, all work happened on `main` without published releases.
Detailed history available via `git log`.

* **2026-05-03** — `0.5.0`: link_solution_to_incident, update_comment;
  custom-field writes investigated and reverted (SWSD API limitation)
* **2026-05-03** — `0.4.0`: describe_custom_fields tool +
  dump:custom-fields script
* **2026-05-03** — `0.3.0`: solution / KB tools (search, get, create,
  update); 20 tools total
* **2026-05-03** — `0.2.0` (commit-tagged): incident writes, comments,
  lookup readers; 16 tools total
* **2026-05-03** — `0.1.0`: initial dual-transport foundation +
  incident reads (4 tools)

[Unreleased]: https://github.com/mikimatsub/swsd-mcp/compare/v2.2.0...HEAD
[2.2.0]: https://github.com/mikimatsub/swsd-mcp/compare/v2.1.1...v2.2.0
[2.1.1]: https://github.com/mikimatsub/swsd-mcp/compare/v2.1.0...v2.1.1
[2.1.0]: https://github.com/mikimatsub/swsd-mcp/compare/v2.0.2...v2.1.0
[2.0.2]: https://github.com/mikimatsub/swsd-mcp/compare/v2.0.1...v2.0.2
[2.0.1]: https://github.com/mikimatsub/swsd-mcp/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/mikimatsub/swsd-mcp/compare/v1.0.1...v2.0.0
[1.0.1]: https://github.com/mikimatsub/swsd-mcp/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/mikimatsub/swsd-mcp/releases/tag/v1.0.0
