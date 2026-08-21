# swsd-mcp v2: Research-Backed Proposal

**Status:** Research → Proposal phase. This is not an implementation plan with phases or timelines; that comes after agreement on the proposal.

**Date:** May 6, 2026.

**Scope:** Targets v1.0.1 → v2.x of `swsd-mcp` (https://github.com/mikimatsub/MCP-SWSD).

**Source artifacts:** `.research/v2/` (gitignored). Six completed research streams + a focused custom-field-writes investigation. Live tests against the user's tenant (US, `api.samanage.com`, 56,800 incidents at time of research). All test sentinels created and deleted; no production data altered.

---

## Executive summary

Seven findings shape this proposal:

1. **v1's "custom-field writes don't work" claim is wrong.** Live testing confirms writes work for Incidents and Solutions across Text, Dropdown, Number, Checkbox, and Date field types, on both CREATE and UPDATE. v1 missed the Rails-XML-fossilized-into-JSON nesting pattern. **v2 should ship custom-field writes.** (Detailed findings: `.research/v2/03-swsd-custom-field-writes.md`.)

2. **The identity gap has a 5-minute fix.** SWSD already exposes `GET /profile.json` (full authenticated-user record including `id`, `email`, `name`, `role`, `department`, `site`, `group_ids`, `disabled`, `available_for_assignment`, `reports_to`). Additionally, the JWT payload contains `user_id` directly: knowable with zero HTTP cost. Both v1 and the brief assumed identity discovery would require inventing something. It doesn't. **v2 ships `swsd_get_me` and uses the result to enable a `swsd_list_my_incidents` thin wrapper.**

3. **Scope ambiguity is fixable in two complementary layers, and v2 can lead the field on this.** SWSD already returns reliable totals (`X-Total-Count`, `X-Total-Pages`, RFC 5988 `Link` header: verified populated on the live tenant). v1 already extracts them. The actual gap is that **no production MCP server in adjacent domains echoes applied-filter context back in the response** (Stream 4 reviewed Linear, GitHub, Atlassian, Asana, ServiceNow, Notion, Slack, Stripe). v2 can introduce an `applied_filters` echo field plus a `total_scope: "filtered" | "tenant" | "unknown"` discriminator and become the reference design.

4. **MCP Apps belongs in v2.** Strictly additive (text fallback mandatory in spec). Seven of eight reviewed hosts render UI in production today (Claude Web/Desktop, VS Code Copilot, ChatGPT, Goose, Postman, MCPJam, M365 Copilot Chat). The single exception (Copilot Studio's authoring chat) is unaffected because it gracefully gets the existing structured payload. Per-tool cost is ~30 LOC TypeScript + 1 HTML file. Right tools to add UI to: incident detail, solution detail, incident list/queue, custom-field schema explorer (and optionally comment thread + KB search).

5. **The MCP ecosystem is stable and v1 is on-version.** Latest spec is `2025-11-25`; latest TS SDK is `1.29.0` (published 2026-03-30). v1's hardcoded `SUPPORTED_PROTOCOL_VERSIONS` set is complete. v2 should pin `@modelcontextprotocol/sdk@^1.29.0 <2.0.0` (avoid the 2.0.0-alpha rewrite). Bump SDK floor to **1.26.0+** to pick up the GHSA-345p-7cg4-v4c7 cross-client response-leak fix even though v1's per-request server construction is already safe by accident.

6. **Competitive context shifted.** A real OSS competitor exists: `cptncoconut/samanage-mcp` (Python, MIT, **41 tools**, April 22, 2026, which was 12 days before swsd-mcp 1.0). swsd-mcp's "self-hostable + MIT + zero-creds-at-rest" is now parity, not unique. The defensible angles are (a) TypeScript + Streamable HTTP + Copilot Studio remote-MCP path (Microsoft has no native connector), (b) MCP Apps UI quality (Python competitor cannot easily match), and (c) registry + aggregator listings (currently empty for SWSD/Samanage and therefore unclaimed). v2 should aim at *at least feature parity* on the read/write surface plus push hard on the differentiation lanes.

7. **The single biggest under-utilized SWSD feature: `?layout=long`.** v1 never uses it. Live test on the user's tenant confirms `GET /incidents/{id}.json?layout=long` adds 12 top-level fields over the default: including `comments[]` (already populated), `attachments[]`, `audits[]`, `statistics`, `tags`, `associated_sla_names`, `is_customer_satisfied`, `customer_satisfaction_response`, `request_variables`, `resolution`, `resolution_type`, `total_time_spent`. **Today the model needs 2–3 round-trips to assemble this data; with one parameter it's one call.** The v2 implementation is ~10 LOC. Same pattern applies to `/solutions`, `/hardwares`, `/problems`, `/changes`, `/contracts`, `/other_assets`. Probably the single highest-leverage micro-improvement in v2.

---

## Where v1's assumptions still hold and where they need updating

### Still correct

- **Architecture is sound.** Stateless per-request token, zero credentials at rest, dual transport (stdio + Streamable HTTP), defensive parsing of unknown SWSD shapes, structured + text dual output via `structuredResult()`. Every research stream confirmed these are best-in-class for this niche; nothing in the v2 work needs to disturb the architectural spine.
- **The first-party MCP gap holds.** SolarWinds announced an "MCP Framework" in October 2025 and rebranded to "SW1" in April 2026, but what shipped is internal to the Observability product, not a self-hostable MCP a customer can deploy against their SWSD tenant. SW1 for Service Desk lists "AI Incident Correlation, KB Generation, Automated Runbook Execution" as 2026-roadmap items not yet shipped (per SWSD 2026 release notes through April 14). Microsoft has no Copilot Studio built-in MCP for SWSD and no Power Platform connector beyond Power BI reporting.
- **SaaS bridges are unchanged on the sovereignty axis.** Zapier, Pipedream, Truto, AgenticFlow all still per-call route through their infrastructure. Free → enterprise pricing across the four. Net read: the per-call routing trade-off is *more* relevant in May 2026, not less.
- **Pagination header extraction is correctly designed.** SWSD's `X-Total-Count`, `X-Total-Pages`, `X-Per-Page`, `X-Current-Page` and RFC 5988 `Link` headers are reliably populated (verified on the live tenant: 56,800 incidents, headers returned correctly with `rel="first"`, `"next"`, `"last"`). v1's `extractPagination()` is correct; the gap is the *interpretation* layer (see "Identity & scope" below).

### Needs updating

- **Custom-field writes documentation is wrong.** The "SWSD returns 500 on every payload variant tested" finding in v0.5 commit `06e9cf6` and the `swsd_describe_custom_fields` tool description should be retracted.
- **The "no first-party SWSD MCP" framing is intact, but the "no OSS competitor" framing is not.** `cptncoconut/samanage-mcp` exists. v2 README positioning should acknowledge it neutrally and lean into the differentiation angles.
- **The `swsd_get_server_info` tool's role.** Currently returns server identity. It should not be repurposed for user identity because that's the separate `swsd_get_me` tool. Its description should explicitly note this so the model doesn't try to substitute one for the other.

---

## Proposal: identity & scope

This is the brief's primary v2 problem. Both halves are fully addressable with concrete, low-risk additions.

### Part 1: Identity (`swsd_get_me`)

#### What's available: three paths, varying durability

There are three independent ways to identify the authenticated user. v2 should use them in combination:

**Path A: JWT payload decode (zero-cost, always works).** The SWSD bearer token is a JWT; the payload claims are base64-decodable client-side without an HTTP call. A live verification on May 6, 2026 returned `{"user_ic": 11643235, "generated_at": "2026-03-11 20:34:59"}`. The official API docs `info.description` confirms this format. The `user_ic` field (the name appears to be a typo for `user_id`) is the authenticated user's numeric ID. This is **always available** and costs nothing, but tells us only the ID + token issuance time.

**Path B: `GET /users/{user_ic}.json` (documented, durable).** The official OpenAPI spec at `apidoc.samanage.com/redoc/schema/resolved_schema.json` documents this endpoint. It returns the full user record: `id, name, email, title, phone, mobile_phone, role{id, name, description, portal}, site{id, name, location, timezone}, department{id, name, description, default_assignee_id, default_group_assignee_id}, custom_fields_values[], avatar, reports_to, group_ids[], created_at`. **Recommended primary enrichment path**: it's documented, won't be surprised by a deprecation.

**Path C: `GET /profile.json` (undocumented, currently functional).** Verified live to return 200 with the same fields as Path B plus a few extras (`disabled`, `available_for_assignment`, `can_be_available_for_assignment`, `last_login`, `provider`, `language`, `time_zone`, `updated_at`). NOT in the OpenAPI spec: confirmed by Stream 3's exhaustive grep against the official 66-path spec, plus the Stitchflow user-management API guide which states explicitly: "**No** – The documentation makes no mention of a `/users/me`, `/me`, or endpoint to retrieve the currently authenticated user's details." So this path works empirically but could change without warning. Useful as a probe-fallback or as an enrichment for the few extra fields, but not as the primary contract.

**Recommended composition for v2:** Path A first (instant), then Path B (documented enrichment). Optionally probe Path C for the extra fields like `available_for_assignment` (handle 404 silently: those fields just become undefined).

**ESM caveat:** the SolarWinds Success Center docs note that ESM tenants encode additional info in the JWT (likely `service_provider_id` or similar). v2's JWT decoder should surface ALL claims found, not just the two known ones: defensive against tenant variation.

#### Tool design

Add `swsd_get_me` (also known as `swsd_whoami`: name TBD by user):

```
Description: "Get the SWSD user record for the token's owner: id, email,
name, role, department, site, group_ids, and assignment status. Use this
when a request mentions 'me', 'my', or 'I' (e.g. 'my tickets', 'tickets
in my group', 'tickets assigned to me'), and pass the returned id/email
to assignee_email or requester_email filters on swsd_list_incidents."

Annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true }

Output (structured):
  {
    user: { id, email, name, title, role: {id, name}, department: {id, name},
            site: {id, name}, group_ids: number[],
            disabled?, available_for_assignment?, reports_to? },
    sources: ["jwt", "users-endpoint", "profile-fallback"?]
                  // which paths populated the response, for transparency
    jwt_claims: { user_ic, generated_at, ...all_other_claims }
                  // all JWT payload claims found, for ESM tenant compatibility
  }
```

Implementation:
1. **Always** decode the JWT payload locally (Path A). This is zero-cost and gives `user_ic`. Surface ALL claims found.
2. Call `GET /users/{user_ic}.json` (Path B) for the full record. Cache for the lifetime of the request; optionally short-TTL across requests for the same token hash (5-minute LRU).
3. Optionally call `GET /profile.json` (Path C) for the bonus fields (`available_for_assignment`, `last_login`, etc.). Treat 404 as "those fields are unavailable": do not fail the tool.
4. Optionally enrich `group_ids` with names by zipping against a single cached `GET /groups.json?per_page=100` lookup.

Caching note: in stdio transport, one process per token means a process-lifetime cache is safe. In HTTP transport (multi-token shared process), key any cache by `sha256(token)` and apply a short TTL: never persist to disk, never log the token-derived key beyond what's already done in v1's per-request rate limiting.

#### Server instruction (highest leverage, lowest cost)

GitHub's MCP server emits a `serverInstructions` field at the `initialize` response that tells the model `"Always call 'get_me' first to understand current user permissions and context"` (`pkg/github/toolset_instructions.go` line 9). Stream 4 found this is more reliable than hoping the model derives the instruction from tool descriptions.

In v1's `createMcpServer()` (`src/mcp/server.ts`), the `INSTRUCTIONS` constant is presently 4 sentences about API behavior. Augment with:

> When a request mentions "me", "my", "I", or "my team", call `swsd_get_me` first to learn the authenticated user's id, email, and group memberships. Then pass those to filter parameters (e.g. `assignee_email`) on list and search tools. Without this step, "my tickets" queries cannot be answered correctly.

This is the single highest-leverage v2 change. Less than 100 LOC including tests.

#### Companion thin-wrapper tool: `swsd_list_my_incidents`

Stream 4 surfaced two architectural choices: GitHub teaches `assignee:@me` syntax via instructions; Asana ships a dedicated `get_my_tasks` tool. Asana's shipping experience is that the dedicated tool is friendlier to weaker models and removes one round-trip per query.

Add `swsd_list_my_incidents` as a thin wrapper that internally calls `swsd_get_me` (cached) then `swsd_list_incidents` with `assignee_email = profile.email`. Same input shape as `swsd_list_incidents` minus the `assignee_email` parameter. Tool description explicitly directs the model to prefer this tool for first-person queries.

Optional sibling: `swsd_list_my_open_incidents` (combines the above with default `states = ["New - Unassigned", "Assigned", "In Progress", "Awaiting Input"]`). Useful but probably v2.5: start with the base "my incidents" tool.

#### Group-membership question

The brief raised "list tickets for groups I'm in." The `group_ids` field on `/profile.json` returns a flat array of integer IDs (verified: `[12990074]` on the test profile). Stream 4 found `swsd_list_incidents` already supports a group filter via the underlying `/incidents.json?group=...` parameter (or similar: needs verification in Stream 3's broader API survey). v2 implementation note: extend `ListIncidentsInput` with an optional `group_ids: number[]` filter. Combined with the cached `swsd_get_me` result, "tickets in my groups" becomes a single round-trip after the initial whoami.

### Part 2: Scope (signaling what was filtered, what the totals mean)

#### What's already there

v1's `extractPagination()` (`src/swsd/pagination.ts`) already returns `{ page, per_page, total?, has_more, next_page? }`. The text summary in `listIncidents.ts` line 43 includes this: `"Returned 25 incidents (page 1 of ~56800, more available)"`. So the data is present; what's missing is *legibility*:

1. The `~` prefix in "of ~56800" suggests uncertainty when in fact the header value is exact when present.
2. The summary doesn't tell the model whether the 25 is from a tenant-wide query or a filtered query.
3. The structured response doesn't echo the applied filters, so the model can't inspect what scope produced this number.

#### Proposed change: response-shape extension

**No other production MCP server reviewed (Linear, GitHub, Atlassian, Asana, ServiceNow, Notion, Slack, Stripe) echoes applied filters in the response payload.** This is an open lane swsd-mcp can lead in.

Wrap the existing pagination block with two new fields:

```ts
return structuredResult({
  incidents,
  pagination: {
    page,
    per_page,
    total,                 // may be undefined when SWSD omits the header
    has_more,
    next_page,
    total_scope: 'filtered' | 'tenant' | 'unknown'
                            // 'filtered' if any filter param was passed and total is present
                            // 'tenant' if no filter params were passed and total is present
                            // 'unknown' if total is missing
  },
  applied_filters: {
    states: input.states,           // verbatim echo, undefineds elided
    priorities: input.priorities,
    categories: input.categories,
    assignee_email: input.assignee_email,
    requester_email: input.requester_email,
    updated_from: input.updated_from,
    // (any future filter parameters added in v2)
  },
}, summary);
```

#### Proposed change: text summary

Upgrade the one-line summary to be self-describing:

Before: `"Returned 25 incidents (page 1 of ~56800, more available)."`

After (no filters): `"Returned 25 of 56,800 tenant incidents (page 1, more available). No filters applied."`

After (with filters): `"Returned 25 of 87 incidents matching your filters (assignee_email=foo@bar.com, state=Assigned), page 1 of 4."`

After (`total` missing): `"Returned 25 incidents (page 1, more available). Filtered by: assignee_email=foo@bar.com. Total count not provided by API."`

This is a one-function change in each list tool's handler: formatting logic, no API changes.

#### Why this works against the brief's failure modes

The brief's worst case: *"how many tickets do I have"* answered as *"you have 25"* when truth is *"you have 12, but there are 56,000 in the tenant and the model paginated wrong."*

After the change:
- The model calls `swsd_get_me`, gets `email=user@example.com`.
- Calls `swsd_list_my_incidents` (which internally adds `assignee_email=user@example.com` filter).
- The text summary says: `"Returned 25 of 87 incidents matching your filters (assignee_email=user@example.com), page 1 of 4."` 
- The structured `applied_filters` block confirms what was filtered.
- The model knows to either page through, narrow filters further, or summarize "you have 87 assigned to you."

Both halves of the failure mode are closed in-band, without depending on the model to reason about absent context.

### Part 3: A pushback on the brief's framing of scope

The brief described scope ambiguity as if no signal exists. In fact SWSD provides the signal reliably (tested on the user's tenant: 56,800 incidents, headers always populate). The actual problem is **interpretation**: the existing summary's "of ~25" framing doesn't make the model differentiate filtered vs tenant totals, and the structured response lacks the `applied_filters` echo that would let the model reason about it.

This is a meaningful refinement: the v2 work is *signaling improvement*, not *new data plumbing*. Cheaper, lower-risk, and lets v2 ship the scope fix in a single sprint of work, not as a multi-week refactor.

---

## Proposal: MCP Apps in v2

### Decision: ship MCP Apps support in v2.

Specs and SDK are stable. The `@modelcontextprotocol/ext-apps` package is at v1.7.1 (2026-04-27, Anthropic-maintained, `^1.27.1` SDK peer). The spec (SEP-1865) merged 2026-01-28; wire format unchanged since launch. Per-tool cost is ~30 LOC server + 1 HTML file (no build step required for plain HTML; Vite + `vite-plugin-singlefile` for component frameworks).

### Why v2, not v3

- **Strict additivity.** The spec mandates a `content[]` text fallback on every UI-bearing tool. Non-supporting clients (including Copilot Studio's authoring chat) get the existing `structuredContent` payload unchanged. Zero functional harm to the existing audience.
- **Audience reality.** Seven of eight mature MCP hosts in May 2026 render UIs (Claude Web + Desktop, VS Code GitHub Copilot, ChatGPT via Apps SDK, Goose, Postman, MCPJam, Microsoft 365 Copilot Chat). The audience described in the brief, "anyone running SWSD with an API token and an MCP-capable client," is dominantly served by clients that render.
- **Differentiation against the OSS competitor.** `cptncoconut/samanage-mcp` is Python; their reasonable MCP Apps story would mean either inlining HTML strings or running a Node bundler in their Python build pipeline: neither ergonomic. swsd-mcp is TypeScript-native; ext-apps integrates naturally. This is one of the few places language choice converts directly to product surface.
- **Quality positioning.** UI-rich MCP advertises craft. For OSS competing on adoption against a similarly-MIT competitor with broader tool surface, polish is a real lever.

### Which tools get UI in v2

Ranked by where UI most adds over text:

| Tool | UI shape | Why | Cost |
|---|---|---|---|
| `swsd_get_incident` | Detail card: status/priority badges, assignee + requester avatars, custom-field rendering by type, inline collapsible comment thread, link to the SWSD UI | Read-shaped, dense, structured: the canonical case where text is lossy. Highest-value tool to UI-ify. | High |
| `swsd_get_solution` | Article view: rendered HTML body (SWSD already stores `description` as HTML) with proper headings, links, code blocks, and metadata sidebar (category, updated_at, requester) | KB articles are inherently visual; rendering markdown/HTML beats serialized text. Low cost because the body is already HTML. | High value, low cost |
| `swsd_list_incidents` | Sortable, filterable table: per-row status badges, priority chip, assignee avatar, click-through to detail view | Queue-shaped use case. Filtering in-iframe via `app.callServerTool` avoids round-tripping the model on every "show me only High priority". | Medium-high |
| `swsd_describe_custom_fields` | Tree explorer: by scope (Global / Service_Catalog) and module; expand a field to see allowed values for dropdowns; one-click "copy field name" | Per-tenant schemas are awkward in pure text: a tree picker is the natural shape. The user's tenant has 102 custom fields; rendering as a list is unwieldy. | Medium |

Probably v2.5 follow-ups (defensible for v2 but lower marginal value):

| Tool | UI shape | Why later |
|---|---|---|
| `swsd_list_incident_comments` | Thread: author avatars + names, timestamps, markdown rendering, agent-vs-private styling | The incident detail view already includes inline comment thread; standalone tool's UI is mostly redundant. |
| `swsd_search_solutions` | Result list with rendered excerpts and category badges | Search-result lists are useful in UI but lower than detail views. |

All other v1 tools (lookups, write-only mutations, health checks) stay text-only: no UI value.

### Implementation cost picture

For the four v2-targeted tools:

- **TypeScript additions:** ~120–180 LOC across 4 tool registrations (`registerAppTool` instead of `registerTool`, plus matching `registerAppResource` per UI). Mappers and SWSD client unchanged.
- **HTML files:** 4 single-file UIs, plain HTML+JS for the simple cases (incident detail, solution detail) and Vite + `vite-plugin-singlefile`-bundled React/Svelte/Vue for the interactive ones (incident list, custom-field explorer). The ext-apps reference servers all use this pattern.
- **Build pipeline:** One-time Vite config (~30–50 LOC). Existing `tsc` build remains; Vite emits inlined HTML resources at build time.
- **CSP setup:** SWSD records contain external links (avatar URLs from S3) and embedded images. CSP `connectDomains` and `resourceDomains` need to allowlist `*.amazonaws.com` (or whatever SWSD's avatar host is: verifiable from the live `/profile.json` we already inspected: `s3.us-east-1.amazonaws.com/production.main.customer.data/avatars/...`). One-time research + config.
- **Tests:** Each UI-bearing tool needs both the existing structured-output test plus a "UI resource is registered" smoke test. Modest: maybe 1.5x the test count for those four tools.
- **Theme handling:** ext-apps `HostContext.styles.variables` injects CSS variables (`--color-text-primary`, `--color-background-primary`, etc.). Use CSS `light-dark()` per spec. Trivial when designing from scratch.

Total realistic effort: 1–2 weeks of focused work for the four v2 tools. Sprint-scale, not month-scale.

### Strict additivity safety net

- Text fallback is mandatory in the spec. Every UI-bearing tool returns `content: [{type: "text", text: ...}]` plus `structuredContent: {...}` plus the `_meta.ui.resourceUri` reference. Hosts that don't render UI (Copilot Studio's authoring chat, any future client without ext-apps support) see the structured payload exactly as v1.x emits it today.
- Adopting MCP Apps does not change the existing `swsd_*` tool inputs or outputs. v1 client-config compatibility is preserved.
- Copilot Studio adopters lose nothing functional. They gain UI when their Studio agent is later consumed via M365 Copilot Chat (where MCP App UIs render).

### What to declare in capabilities

Per the v1.29.0 SDK's backported `extensions` slot:

```ts
capabilities: {
  tools: {},
  logging: {},
  extensions: { ui: { /* per ext-apps spec */ } },
}
```

This advertises UI capability to hosts that consume the `extensions` slot.

---

## Proposal: custom-field writes (v1 limitation retracted)

### What v1 documented

> Custom-field WRITES via incident/solution write tools are not supported (SWSD returns 500 on every payload variant tested).

### What live testing confirmed

That claim is wrong. v1's investigation tested 4 variants of a `custom_fields_values: [array]` shape: none with the nested singular-key wrapper that Samanage's API actually requires. The correct shape (verified against the official `SAManage/Samples` Ruby code AND four live tests on the user's tenant on May 6 2026):

```json
{
  "incident": {
    "custom_fields_values": {
      "custom_fields_value": [
        { "name": "Charge Number", "value": "TEST-001" }
      ]
    }
  }
}
```

This is a Rails-XML-fossilized-into-JSON pattern. v1 missed it because the same lesson the team *did* internalize for `solutions` vs `solution_ids` (READ shape ≠ WRITE shape, and 200 OK can silently ignore your payload) wasn't applied to custom fields. Detailed test transcripts in `.research/v2/cf-tests/`.

### What v2 ships

Add a `custom_fields` parameter to:

- `swsd_create_incident`
- `swsd_update_incident`
- `swsd_create_solution`
- `swsd_update_solution`

Input shape:

```ts
custom_fields: z.array(z.object({
  name: z.string().min(1)
    .describe('Custom field name (case-sensitive). Use swsd_describe_custom_fields to discover.'),
  value: z.union([z.string(), z.number(), z.boolean()])
    .describe('For Date use ISO 8601 (YYYY-MM-DD). For Dropdown use one of the allowed values. For Checkbox use "Yes" or "No".'),
})).optional()
.describe('Set tenant-specific custom field values. Standardizes on name keying for cross-entity portability.')
```

Mapper:

```ts
if (fields.custom_fields && fields.custom_fields.length > 0) {
  payload.custom_fields_values = {
    custom_fields_value: fields.custom_fields.map(cf => ({
      name: cf.name,
      value: cf.value,
    })),
  };
}
```

### Field-type coverage

Verified working: Text, Dropdown, Number, Checkbox, Date (with normalization caveat: SWSD echoes `"2026-01-15"` back as `"Jan 15, 2026"` on read; v2 should not string-compare GET-after-write for Date fields).

Untested due to no Global-scope examples in the test tenant: Multi_picklist, User-type, Date_and_Time, Text_Area. Document these as "v3, pending service-catalog write investigation."

### Documentation cleanup

- Remove the "writing custom field values via this server is not currently supported" sentence from `swsd_describe_custom_fields` description.
- Add a v2 changelog entry that explicitly retracts the v0.5 finding.
- Update tool descriptions for the four affected write tools to mention `custom_fields` parameter availability.

---

## Other v2 candidates

Ranked by leverage (value × likelihood × audience-breadth ÷ cost). Each item annotated with whether Stream 3 surfaced new endpoint detail, and where verified live.

### Tier 1: definitely in v2 (high leverage, low cost)

#### A. `?layout=long` parameter on detail tools

**The single highest-leverage micro-improvement in this entire proposal.** v1 never uses `?layout=long`. Live test on the user's tenant (May 6, 2026, incident 181197546) confirmed it adds 12 top-level fields to a default incident GET:

```
+ associated_sla_names    + comments
+ attachments             + customer_satisfaction_response
+ audits                  + is_customer_satisfied
+ request_variables       + resolution
+ resolution_type         + statistics
+ tags                    + total_time_spent
```

The `comments` field on the test incident was already populated with one comment: proof that the rich-detail path is genuinely useful, not just a schema addition.

**Today** the model needs 2–3 separate calls to assemble this data: `swsd_get_incident` → `swsd_list_incident_comments` → maybe `swsd_get_record_audits`. **With `layout=long`** it's one call.

Implementation (~10 LOC per tool):

```ts
// In schemas/incident.ts:
detail_level: z.enum(['short', 'long']).default('short')
  .describe('Use "long" to include comments, attachments, audits, SLA data, ' +
            'tags, statistics, and resolution detail in one call. Default ' +
            '"short" is faster and cheaper. Recommend "long" when the user ' +
            'asks "show me everything about ticket X" or wants comments.')

// In tools/incidents/getIncident.ts:
const params = input.detail_level === 'long' ? { layout: 'long' } : {};
const { body } = await ctx.client.get<unknown>(`/incidents/${input.id}.json`, params);
```

Apply to: `swsd_get_incident`, `swsd_get_solution`. Same pattern documented for `/hardwares`, `/problems`, `/changes`, `/contracts`, `/other_assets` if those tools land in v2.

#### B. Expanded filter set on `swsd_list_incidents`

v1 sends only `state[]`, `priority[]`, `category[]`, `assignee_email`, `requester_email`, `updated_at[]=greater_than&...`. The OpenAPI spec + community-confirmed filters are much richer:

```ts
// Add to ListIncidentsInput:
sites?: string[]              // site name filter (repeated-key)
departments?: string[]        // department name filter
assigned_to_group?: number    // group ID filter (NOT user: different param)
created_from?: string         // ISO 8601
created_to?: string           // ISO 8601
updated_to?: string           // pair with existing updated_from
state_is_not?: string[]       // negative state filter
sort_by?: 'created_at' | 'updated_at' | 'priority' | 'name' | 'due_at'
sort_order?: 'ASC' | 'DESC'
query?: string                // free-text search across title/description
                              // (LIVE-VERIFIED: returns 200, X-Total-Count for "test"
                              //  was 2,680 of 56,800 on the test tenant)
```

Cost: ~50 LOC of zod schema + tool-description editing. All forward-only, no breaking changes. Note: `query=` carries the same async-indexing caveat v1 already documents for solution search: just-created tickets may not appear for a few minutes.

#### C. `swsd_get_record_audits(object_type, id)`

Wraps `GET /{type}/{id}/audits` (and the global `GET /audits` for a tenant-wide log if requested). Live-verified the global endpoint returns rich entries: `{action, created_at, department, hardware_href, message, note, site, source_id, source_type, user, user_id, uuid}`.

Use case: "Who changed this ticket and when?" "What happened since I last looked at it?" Without the audit tool, the model needs `?layout=long` and has to filter the embedded `audits[]` array, which is fine for small audit logs but unwieldy for tickets with hundreds of audit entries.

Implementation: ~50 LOC. Tool input: `object_type` (enum: `incidents | problems | changes | solutions | hardwares | other_assets`), `id`, `page`, `per_page`. Tool output: standard projected audit array + pagination block.

#### D. Surface the documented rate limit in `swsd_get_server_info`

The OpenAPI `info.description` documents account-wide limits: **1000 calls/min on Advanced Plan, 1500 calls/min on Premier Plan.** SWSD does NOT return `X-RateLimit-*` headers: only a 429 with `Retry-After`. v1's retry behavior in `client.ts:67-74` already handles 429 correctly.

Add to `swsd_get_server_info` output:

```ts
upstream_rate_limit: {
  advanced_plan: '1000 calls/min',
  premier_plan: '1500 calls/min',
  signal: '429 + Retry-After only: no X-RateLimit-* headers',
  client_behavior: 'auto-retry with exponential backoff (max attempts: ' +
                   String(env.SWSD_RETRY_MAX_ATTEMPTS) + ')',
}
```

Cost: ~5 LOC. Saves the model from guessing or asking. Don't try to track per-token remaining budget because, without `X-RateLimit-Remaining`, we'd be guessing.

#### E. v1 retroactive cleanup

- **Bump `@modelcontextprotocol/sdk` floor to `^1.26.0`** for `GHSA-345p-7cg4-v4c7` (cross-client response-leak fix). v1's per-request server construction in `runHttp` is already safe but the floor bump is a defense-in-depth signal to operators.
- **Audit tool names against SEP-986 format regex** (`^[a-zA-Z][a-zA-Z0-9_-]{0,127}$`): quick spot check; v1's `swsd_*` names already comply.
- **Set `outputSchema` on read tools**: v1's `structuredResult()` already returns a stable structured shape; declaring the matching `outputSchema` in `registerTool()` lets clients (notably Copilot Studio) validate the response and report errors more usefully. Modest cost (~50 LOC across all read tools), modest payoff. Worth it for v2.
- **Add explicit `MCP-Protocol-Version: 2025-11-25` advertisement** in v2 README's Copilot Studio setup docs.

### Tier 2: opportunistic v2 (high value, scope-permitting)

#### F. Service Catalog tools (`swsd_list_catalog_items`, `swsd_create_service_request`)

Live-verified `/catalog_items.json` exists (returned 200, 14 items in the test tenant). The user's tenant has 95+ Service_Catalog-scoped custom fields per the validation dump: meaning service-catalog requests are heavily customized in this tenant, and probably in many SWSD tenants.

`POST /catalog_items/{id}/service_requests` creates an incident from a catalog template. The payload is `{ incident: {...} }`: same write shape as `POST /incidents`. The catalog item carries its own scoped custom fields, which now-validated custom-field writes (Tier 1, in proposal) extend to.

**This is the v2 expansion that opens the largest new workflow class:** "I need a new laptop" → fill the catalog form → create the request. It's also the path most directly competitive with `cptncoconut/samanage-mcp`'s tool surface (they have catalog management).

Tools to add:
- `swsd_list_catalog_items({page, per_page, query?})` → list available catalog items
- `swsd_get_catalog_item({id})` → detail with the form schema (custom-field definitions for that catalog item)
- `swsd_create_service_request({catalog_item_id, requester_email, custom_fields, ...})` → submit a service request

Cost: ~150 LOC across 3 tools + schemas. High user-value, paired well with the validated custom-field writes.

#### G. Tasks (per-incident sub-todos)

`POST /{object_type}/{id}/tasks` creates, `DELETE /{object_type}/{id}/tasks/{task_id}` removes, global `GET /tasks` lists. **No update endpoint exists**: Stream 3 confirmed via OpenAPI grep.

Tasks appear as `tasks: [{id, href}]` in the incident's `?layout=long` response. A common workflow shape: agent splits a complex ticket into sub-todos, marks them done as work progresses.

Tools:
- `swsd_list_tasks({object_type, id})` → projection of tasks for a specific record
- `swsd_create_task({object_type, id, name, ...})` → add a task to an incident/problem/change
- `swsd_delete_task({object_type, id, task_id})` → remove

Cost: ~120 LOC. Common workflow.

#### H. Time Tracks (per-incident billable-hours)

`GET /{object_type}/{id}/time_tracks`, `POST` to create, `PUT` and `DELETE` for edits. The `creator` is auto-set to the token's user. Useful for billable-hour shops (MSPs, internal-IT chargeback).

Tools (gated behind audience interest: not every SWSD tenant uses time tracking):
- `swsd_list_time_tracks({object_type, id})` 
- `swsd_log_time({object_type, id, minutes, ...})`
- `swsd_update_time_track`, `swsd_delete_time_track`

Cost: ~120 LOC.

#### I. Problems (read + write)

Live-verified `/problems.json` returns 200 with 139 records in the test tenant. The shape mirrors incidents (Rails ITSM template). v1's incident tools fork cheaply: `swsd_list_problems`, `swsd_get_problem`, `swsd_create_problem`, `swsd_update_problem`.

Cost: ~250 LOC if forking the incident tools cleanly. Audience: any SWSD tenant doing problem management (subset of incidents-only tenants).

#### J. Attachments

`POST /attachments` is multipart form-data with keys `file[attachable_type]`, `file[attachable_id]`, `file[attachment]`. Listing is via `?layout=long` on the parent record (no dedicated `/attachments.json` GET endpoint). Downloading is plain GET on the presigned `attachment.url`: **no SWSD auth header needed for the download** because the URL is presigned (per the Ruby gem's behavior).

Tools (deferrable to v2.1 if scope-tight):
- `swsd_attach_file({parent_type, parent_id, file_path or base64})`: multipart POST
- (Listing is implicit via `?layout=long`; no new tool needed if Tier 1 ships)
- (Download is a tool-side decision: could return URLs only, or fetch+return base64 for the model)

Caveat: file-path-based input works for stdio mode but is awkward for HTTP transport (model would need to send bytes). For HTTP transport, accept base64-encoded content. Test against v2.1 Accept header first, fall back to v1.3 (the official curl example uses v1.3) only if v2.1 rejects.

**Empirical attachment size limit is unverified**: open question. SWSD UI suggests 25MB per file; API may differ. Test with 1KB / 5MB / 25MB / 50MB before documenting a hard cap.

Cost: ~150 LOC.

### Tier 3: defer to v3 or skip

| Module | Reason to defer |
|---|---|
| **Webhooks / push notifications** | NO API for managing webhook subscriptions. SWSD has only an admin-UI-configured "automation rules → process integration" path that requires IT coordination per integration. The `add_callbacks=true` query parameter only triggers existing admin-configured rules, not subscribes. **Defer to v3** unless/until SWSD ships a webhook-management API. |
| **Bulk operations** | NO API beyond `POST /memberships?group_id=N&user_ids=A,B,C` (group membership only). Plan v2 around per-record concurrency. The 1000–1500/min rate limit absorbs reasonable batch sizes via v1's existing retry behavior. Document in tool descriptions that bulk ops require iteration so the model doesn't hallucinate single-call APIs. |
| **CMDB write tools** (`configuration_items`) | Niche audience (asset managers, not ticket workers); the dependency-graph PUT shape is awkward (top-level dynamic key like `"Child Of": {selected_ids: ...}`); large surface for limited users. |
| **Asset management** (hardware/mobiles/other_assets/printers/softwares) | Different audience from ticket workers. Doubles tool count + maintenance surface. Defer pending demand. Read-only `swsd_list_hardware` could be cheap if there's a clear use case. |
| **Releases** | Rare workflow. `/incidents/{id}` returns `releases: [{id, href}]` but the use case is thin. Defer pending demand. |
| **Contracts, Purchase Orders, Vendors, Risks** | Procurement / niche. Not ticket-worker-shaped. Defer. |
| **Reports** | NO API endpoint exists. SWSD Reports are UI-only. Skip. |
| **SLAs (standalone)** | NO standalone endpoint. SLA data appears as `sla_violations` and `associated_sla_names` on incidents in `?layout=long` response. Surface via the enriched `swsd_get_incident`, document that SLA *definitions* aren't API-accessible. No new tool needed. |
| **Memberships** | Admin-shaped (managing group membership), not ticket-worker-shaped. Defer. |
| **Multi-level approver workflows on POs** | `edit_mode=true` complexity not worth it for v2. |
| **MCP `tasks/*` (SEP-1686)** | The `tasks/*` API (server-side async tools) is supported in SDK 1.24+ but no current swsd-mcp operation legitimately takes >5s: every request is a single SWSD call. If v2.x adds bulk or aggregation tooling, revisit. |

### Distribution and discoverability (independent of v2 code work)

- **Register on `registry.modelcontextprotocol.io`**: verified zero results for `samanage`, `swsd`, `solarwinds`, `service desk` as of May 6, 2026. v1 has shipped artifacts (npm + GHCR + signed releases) that meet the registry's submission criteria. Two-week head start over `cptncoconut/samanage-mcp`.
- **Submit to GitHub MCP Registry** if it accepts non-GitHub-vendor entries.
- **Aggregator catalog hygiene**: claim or correct entries on PulseMCP, mcp.so, mcpservers.org, lobehub, mcpmarket.com, glama, aimcp.info: currently dominated by SaaS-bridge re-syndications.
- **Tool-surface comparison documentation**: a clean README section comparing v2 to `cptncoconut/samanage-mcp` (different language, different transport story, different audience optimizations) helps potential adopters self-select. Don't be defensive; the OSS competitor existing is good for the ecosystem.

---

## Risks and unknowns

### Risks (things to spike or design around before committing)

1. **Custom-field writes for Multi_picklist + User-type fields are unverified.** No Global-scope examples existed in the test tenant. If a v2 user has these field types and sets up the parameter expecting it to work, they'll hit an error. Mitigations: (a) document the limitation in tool descriptions, (b) reject writes targeting these field types client-side after looking up the type via `swsd_describe_custom_fields`, (c) plan a follow-up investigation with a service catalog item.

2. **`/profile.json` is undocumented but currently functional.** Stream 3 confirmed via OpenAPI grep + Stitchflow docs: SWSD's official spec has no `/me`/`/profile`/`/current` endpoint. My live test confirms `/profile.json` works on May 6, 2026, but it could be deprecated without warning. Mitigation: use it as a *secondary* enrichment path. The primary path (JWT decode + `GET /users/{user_ic}.json`) is fully documented and durable.

3. **Server instructions are weighted differently across MCP clients.** GitHub's "always call get_me first" works because Claude / VS Code Copilot / ChatGPT all surface `serverInstructions` to the model. Some clients (older custom integrations, Copilot Studio's stricter modes) may not: risking the identity tool not being called when it should be. Mitigation: also include the "call swsd_get_me first" guidance in `swsd_list_my_incidents`'s description and in the tool description for every "my" workflow tool.

4. **MCP Apps CSP requires SWSD asset domains.** Avatars and inline images load from `*.amazonaws.com` (verified via the live `/profile.json`'s `avatar_url` field: `s3.us-east-1.amazonaws.com/production.main.customer.data/avatars/...`). v2's CSP `connectDomains` and `resourceDomains` must allowlist the right SWSD asset hosts. Need a complete audit; risk is some images failing silently in iframes.

5. **`registerAppTool` from `ext-apps` is from a 1.7.1 package: Anthropic-maintained but newer than the core SDK.** If the ext-apps SDK changes shape between v1.7 and a future v2.x, v2 will need a refactor. Mitigation: pin the exact ext-apps version (`1.7.1`) and let renovate manage upgrades on a 7-day delay.

6. **The OSS competitor could close the language/transport gap.** `cptncoconut/samanage-mcp` is one maintainer + one star today. If they ship a TypeScript port and an MCP Apps integration, the differentiation lanes narrow fast. Mitigation: ship v2 work quickly, claim registry slots, build the MCP Apps experience to a quality bar that's expensive to replicate.

7. **v1's HTTP transport correctness against GHSA-345p-7cg4-v4c7.** v1 creates a fresh server/transport pair per request via `createMcpServer` in `runHttp`, which the GHSA's fix description suggests is the safe pattern. But this should be explicitly verified during v2 dev: the GHSA writeup is worth a careful read.

8. **Attachment write path is awkward for HTTP transport.** Multipart upload over the MCP wire requires either file-path access (works only in stdio mode) or base64-encoded body (works everywhere but is inefficient at multi-MB sizes). v2 should plan the API to accept both shapes; defer attachment WRITE tooling to v2.1 if v2 scope is tight.

9. **`add_callbacks=true` may surprise users.** This documented query parameter on POST/PUT writes triggers SWSD's admin-configured automation rules (which can include emailing assignees, posting to Squadcast, etc.). v2 should NOT default to `true` on writes: it could spam end users. Document the parameter and let the model opt in only when explicitly asked.

### Unknowns (need investigation before committing)

1. **Custom-field WRITES for non-incident/non-solution entities.** The official `SAManage/Samples` Ruby code shows the same nested-wrapper shape works for Hardware and User writes. Live verification is cheap if v2 expands into hardware/asset modules.
2. **`?custom_fields_values[name]=value` filter syntax.** The OpenAPI spec doesn't document custom-field filtering, but the SWSD UI clearly supports it (custom-field filter chips). Likely discoverable by inspecting the UI's network panel; one live test would confirm. Useful pairing with the now-validated custom-field writes.
3. **Microsoft Copilot Studio's `MCP-Protocol-Version` negotiation**: does it currently send `2025-11-25` or fall back to an earlier revision? Affects whether v2 can rely on 2025-11-25-specific shape changes (notably `outputSchema` validation).
4. **JWT payload claims in ESM tenants.** The test tenant returned only `{user_ic, generated_at}`. ESM tenants likely encode `service_provider_id` or similar. Decoding a real ESM token would confirm whether v2's `swsd_get_me` should surface tenant context.
5. **Empirical attachment size limit.** SWSD UI suggests 25MB; API may differ. Test with 1KB / 5MB / 25MB / 50MB / 100MB before documenting a hard cap.
6. **Whether `GET /api.json` returns a useful service-discovery response.** Mentioned in the OpenAPI `info.description`. One live call would clarify; could be useful for a dynamic health check.

### Out of scope / explicitly NOT in v2

- **Multi-tenant deployment patterns.** v1 architecture is intentionally single-tenant per process (the README says so). Multi-tenancy via routing within one process would change the threat model and is a separate design effort. Defer to v3 if there's demand.
- **OAuth 2.1 / RFC 9728 PRM adoption.** SWSD's auth model is JWT-bearer; OAuth flows are not what end-users experience. Stay with the existing token-pass model. Document explicitly that swsd-mcp uses a non-OAuth scheme.
- **Per-tool granular write tools** (GitHub's experiment with `update_issue_title`, `update_issue_body`, etc.). v1's `swsd_update_incident` with optional fields is the simpler and equally model-friendly pattern; no evidence the granular-tool experiment is winning.
- **Skills package (`swsd-skills` repo).** Stream 4 strongly recommends keeping the MCP server primitive-CRUD and shipping opinionated workflows (triage-incident, daily-standup, summarize-my-queue) as a separate Skills package: analogous to what Atlassian and Linear do. **This belongs in a parallel work track**, not in v2's MCP-server scope.

---

## Open questions for the user

1. **Tier 1 alone, or Tier 1 + Tier 2?** Tier 1 (identity, scope signaling, layout=long, expanded filters, custom-field writes, audits, rate-limit surfacing, MCP Apps for 4 tools, retroactive cleanup) is the surgical v2: covers the brief's named issues plus the highest-ROI additions. Tier 2 (Service Catalog, Tasks, Time Tracks, Problems, Attachments) is the parity push against `cptncoconut/samanage-mcp`. Each tier item is roughly 2–5 days of work. Which scope?

2. **Service Catalog + custom-field writes is the highest-leverage Tier 2 combination.** Service-catalog requests in your tenant carry 95+ Service_Catalog-scoped custom fields (per the dump in `validation/`). The custom-field-write win unlocks them. If only one Tier 2 item ships in v2, this is it.

3. **MCP Apps tool selection.** Are the four proposed UI-bearing tools (incident detail, solution detail, incident list, custom-field explorer) the right selection, or are there others to prioritize? "Comment thread" and "KB search results" are the next-most-defensible candidates.

4. **Skills package timing.** Should v2 include a parallel `swsd-skills` repo (markdown skill files for `triage-incident`, `daily-standup`, `summarize-my-queue`, etc.) as companion work? Stream 4's evidence is that this is where workflow logic belongs (Atlassian and Linear both do it). Could be released alongside v2 or deferred to v2.5.

5. **Registry submission as v2 work?** Stream 5 found the official MCP Registry has zero results for SWSD/Samanage. Two-week head start over `cptncoconut/samanage-mcp` is significant for discoverability. Three options: (a) v2 includes registry submission as a release-checklist item, (b) submit now (pre-v2) using v1.0.1 to claim the slot, (c) defer to v2.5. Recommended: (b).

6. **Identity tool name.** `swsd_get_me`, `swsd_whoami`, `swsd_get_authenticated_user`? GitHub uses `get_me`, Asana uses `get_me`, Atlassian uses `atlassianUserInfo`, Linear uses `linear_getViewer`. v2 would benefit from a name that's instantly recognizable: `swsd_get_me` is the most aligned with peer servers.

7. **The "v2.5 vs v2" lines drawn here are tentative.** Pull anything from v2.5 into v2 or push v2 items to v2.5 based on your own ROI calls. The proposal flags everything as either Tier 1 (recommended-in v2) or Tier 2 (opportunistic), but the boundary is where the user decides.

8. **One small live test I haven't run yet:** custom-field FILTERING (`?custom_fields_values[name]=value` on `/incidents.json`). It's the natural pairing with custom-field WRITES and would close one open question. Want me to run it before finalizing?
