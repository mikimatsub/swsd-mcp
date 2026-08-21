# SolarWinds Service Desk MCP Server: Implementation Planning Document

**Document status:** Research-backed implementation plan. Living artifact: revise as live validation resolves open items.
**Last updated:** 2026-05-03  
**Phase:** Planning only; no implementation code is included.  
**Validation environment:** Operator's production SWSD tenant with full admin token. All coworkers who will use the finished server share the same tenant. v0.0 validation runs against production using a controlled test-data convention (see the v0.0 Validation Runbook companion document). This means every endpoint, response shape, custom field, and error path can be verified directly rather than inferred from public documentation.

---

## 1. Executive decision

Proceed with a **single TypeScript MCP server package** that exposes SolarWinds Service Desk (SWSD) tools through two runtime transports:

- `stdio`, for local agent clients.
- Streamable HTTP, for cloud/browser clients and Microsoft Copilot Studio.

Use **profile-scoped tool registration at startup** rather than dynamic mid-session tool mutation. Keep all hard-delete operations out of v1 profiles. Use a tenant-configurable SWSD base URL and token passthrough. Return structured tool output as primary output and a short human-readable summary as fallback output.

### Validation summary

| Brief idea | Status | Decision | Verification note |
|---|---:|---|---|
| TypeScript + `@modelcontextprotocol/sdk` | Validated | Keep | The public MCP TypeScript SDK is actively maintained and is the natural npm distribution path. Source checked 2026-05-03. |
| One codebase with stdio and Streamable HTTP transports | Validated | Keep | MCP and Copilot Studio support Streamable HTTP. Copilot Studio explicitly supports Streamable transport only and no longer supports SSE after August 2025. Source checked 2026-05-03; Microsoft page last updated 2026-04-14. |
| Copilot Studio schema uses Swagger/OpenAPI file with `x-ms-agentic-protocol: mcp-streamable-1.0` | Validated | Keep, but generate per profile | Microsoft’s MCP server schema example uses `swagger: '2.0'` and the `/mcp` POST operation includes `x-ms-agentic-protocol: mcp-streamable-1.0`. Source checked 2026-05-03; Microsoft page last updated 2026-04-14. |
| SWSD token passthrough to `X-Samanage-Authorization: Bearer <token>` | Validated | Keep | SolarWinds documents API token-based authentication; community and integration examples consistently use `X-Samanage-Authorization: Bearer TOKEN`, `Accept: application/vnd.samanage.v2.1+json`, and `Content-Type: application/json`. Source checked 2026-05-03. |
| Server holds no credentials | Validated as architecture | Keep | Compatible with SWSD token model and Copilot API-key-in-header mode. For multi-user HTTP use, require token per request or per Copilot connection. |
| Configurable SWSD base URL | Validated | Keep | SWSD official docs reference regional API server usage. Community examples show `https://api.samanage.com` and `https://apieu.samanage.com`. Source checked 2026-05-03. |
| Four profiles: `triage`, `agent`, `knowledge`, `full` | Partially validated | Keep names; adjust tool contents after endpoint smoke tests | Profile concept is sound. Some planned solution/comment operations still need endpoint-level validation before being advertised in generated connector schemas. |
| Extras mechanism via `--enable` | Validated as architecture | Keep | No external dependency. Implement as deterministic startup-time set union with loud startup errors for unknown tools. |
| Dynamic mid-session tool changes out of scope | Validated as product decision | Keep | Profile-at-startup avoids client variability. Revisit after validating `notifications/tools/list_changed` behavior in target clients. |
| Exclude hard deletes from v1 | Validated as safety decision | Keep | This is a safety policy, not an API limitation. Delete tools should only appear later in an `admin-destructive` profile. |
| Full CRUD across incidents, comments, and solutions | Partially validated | Revise | Incident list/get/create/update are validated from public API definitions. Comments and solutions are valid SWSD object concepts, but exact public API shapes were not fully verifiable from accessible public docs on 2026-05-03. Treat solution/comment write tools as gated by sandbox tests before v1. |
| `link_solution_to_incident` | Not validated | Defer behind experimental flag | Publicly accessible docs did not confirm the exact API relationship model on 2026-05-03. Do not include in default `full` until live verification confirms path and behavior. |
| Custom fields passthrough | Partially validated | Keep passthrough first; schema-aware later | SolarWinds docs validate custom field types, scope, filter/search behavior, and indexing caveats. Public docs did not fully validate write payload shape for every entity. Implement generic passthrough with explicit validation errors surfaced to the agent. |
| Rate-limit behavior with 429 and `Retry-After` | Not SWSD-validated | Implement robust generic handling | No authoritative SWSD-specific rate-limit policy was found in public sources searched on 2026-05-03. Implement client-side concurrency limiting, exponential backoff for retryable operations, and surface 429/`Retry-After` exactly when present. |

---

## 2. Architecture

### 2.1 Runtime modes

```text
swsd-mcp
  --transport=stdio|http
  --profile=triage|agent|knowledge|full
  --enable=<comma-separated extra tool names>
  --base-url=<optional SWSD base URL>
```

Environment equivalents:

```text
SWSD_TRANSPORT=stdio|http
SWSD_PROFILE=triage|agent|knowledge|full
SWSD_ENABLE_EXTRAS=create_incident,update_incident
SWSD_BASE_URL=https://api.samanage.com
SWSD_API_VERSION=v2.1
SWSD_TOKEN=<token for stdio only>
```

### 2.2 Auth model

#### stdio

- Read `SWSD_TOKEN` from the environment.
- Do not persist it.
- Forward as `X-Samanage-Authorization: Bearer <token>`.

#### Streamable HTTP

- Accept `Authorization: Bearer <token>` by default.
- Optionally accept a configurable header such as `X-SWSD-Token` for Copilot custom connector deployments that cannot conveniently preserve the `Authorization` header.
- Forward to SWSD as `X-Samanage-Authorization: Bearer <token>`.
- Never log token values. Redact bearer values and SWSD ticket descriptions from error telemetry unless debug logging is explicitly enabled.

#### Copilot Studio

- Use Streamable HTTP endpoint `/mcp`.
- Provide one Swagger 2.0 YAML artifact per profile.
- Include `x-ms-agentic-protocol: mcp-streamable-1.0` on POST `/mcp`.
- Configure API key auth in a request header for bring-your-own-token deployments.

### 2.3 SWSD client contract

Every SWSD request should be made through one client module that handles:

- Base URL normalization.
- Required `.json` suffixes for endpoints.
- Standard headers:
  - `X-Samanage-Authorization: Bearer <token>`
  - `Accept: application/vnd.samanage.v2.1+json`
  - `Content-Type: application/json`
- Query serialization, including repeated array parameters where validated.
- Pagination defaults and caps.
- Retry and backoff for retryable failures.
- Error mapping to MCP tool errors.

> **Note on Accept header version.** The official SolarWinds documentation cURL example shows `application/vnd.samanage.v1.1+json`, while community integrations and integration scripts (THWACK PowerShell examples, Stitchflow guide, third-party sync scripts) consistently use `application/vnd.samanage.v2.1+json`. Both versions appear to work; v2.1 is the more current. Sandbox validation in v0.0 must confirm which version is canonical for the target tenant and document any response-shape differences between the two. The client module should expose `SWSD_API_VERSION` as a configurable env var (default `v2.1`) so coworkers on different tenant configurations can override without a code change.

### 2.4 Safety model

- Read tools: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`.
- Create tools: `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`.
- Update tools: `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false` unless a tool is provably idempotent by design.
- Delete tools: excluded from v1. Future delete tools require `destructiveHint: true` and a separate `admin-destructive` profile.
- High-impact write tools should require explicit fields rather than accepting opaque JSON blobs, except for custom-field passthrough.

---

## 3. Resolved research questions

### RQ1. Endpoint coverage

**Validated:**

- Incident list endpoint returns an array of incidents.
- Incident get-by-id returns a single incident response shape.
- Incident create and update accept an incident request body and return incident response objects.
- JSON and XML are supported by SWSD API, but this project should standardize on JSON.
- `.json` URL suffix should be treated as required until proven otherwise in smoke tests.

**Partially validated / needs sandbox verification:**

- Comment API exact paths and write payloads.
- Solution CRUD paths and payloads.
- Solution-to-incident link behavior.
- Comment update/delete behavior.
- Full list of lookup endpoints and their exact response shapes.

**Implementation rule:** generated profile schemas must not advertise a mutating tool unless the endpoint has a passing sandbox smoke test.

### RQ2. Search and filter parameter syntax

The brief states that SWSD uses repeated-key array query params such as `state[]=Awaiting+Input&state[]=New`. Public search results and examples confirm rich filtering exists, including updated-date examples, but the complete canonical filter set per resource was not fully exposed by public docs searched on 2026-05-03.

**Decision:**

- Do not expose a raw query-string field as the main API.
- Model filters structurally in the tool input schema.
- Add an `advanced` object only for documented escape hatches.
- Implement a filter serializer with a fixture suite.
- In v0.1, support only filters validated against live SWSD: `page`, `per_page`, `updated_*`, `state`, `category`, `assignee`, `requester`, `site`, `department`, `priority`, and free text only if the official endpoint confirms it.

### RQ3. Pagination

**Validated:** public SWSD API snippets show `page` and `per_page` usage. Community reports show a practical page size of 100 records in SWSD API retrieval.

**Decision:**

- Default list tool `limit`/`per_page`: `25`.
- Maximum per request: configurable, default `100`.
- Always return pagination metadata:
  - `page`
  - `per_page`
  - `next_page` when known
  - `has_more` when derivable
  - `links` when SWSD returns link headers
- Never auto-drain all pages from an agent-facing list tool unless a future export tool is explicitly added.

### RQ4. Custom fields

**Validated:** SolarWinds supports custom fields with types including attachment, checkbox, date, date/time, dropdown, email, multi-picklist, number, star rating, text, text area, user, and user multi-select. Custom fields can be global or service-catalog scoped. SolarWinds also documents search/filter/sort indexing limits and overnight indexing behavior.

**Decision:**

- v0.0 introspects the operator's production tenant and captures the actual custom-field schema as a reference fixture (`fixtures/tenant/custom-fields.json`). This works because the v1 distribution scope is a single tenant: coworkers using this package share the operator's SWSD instance and inherit the same fields.
- v0.1/v1: outputs return `custom_fields` as a generic array/dictionary passthrough. Writes accept a `custom_fields` object keyed by field name or field id, mapped to SWSD's required write shape (confirmed in v0.0).
- Ship a `swsd_describe_custom_fields` tool in `triage` and above that returns the captured schema. Agents can introspect available fields before writes and self-correct on validation errors.
- Ship `scripts/dump-custom-fields.ts` for any future operator on a different tenant who needs to regenerate the reference fixture.
- Do not attempt cross-tenant schema generation in v1.

### RQ5. Rate limits

No authoritative SWSD-specific rate-limit policy was found in public sources searched on 2026-05-03.

**Decision:**

- Implement generic 429 handling.
- If `Retry-After` exists, surface it in the MCP error and use it for retryable internal retries.
- Use conservative per-token concurrency, default `4` in HTTP mode and `2` in stdio mode.
- Add `SWSD_MAX_CONCURRENCY` and `SWSD_RETRY_MAX_ATTEMPTS` settings.
- Do not hide rate-limit failures from the agent.

### RQ6. Error mapping

**Validated:** community reports show SWSD can return 422 validation bodies with field-specific errors such as a missing `name`/subject.

**Decision:**

Map errors into concise, actionable MCP tool errors:

| SWSD response | Agent-facing behavior |
|---|---|
| 400 | `Bad request` plus SWSD message body. |
| 401 | `Unauthorized: check SWSD token and header forwarding.` |
| 403 | `Forbidden: token user lacks permission for this action.` |
| 404 | Include resource type and id. |
| 422 | Flatten field errors into `field: message` lines. |
| 429 | Include `Retry-After` if present. |
| 5xx | Retry if idempotent/read-only; otherwise surface without automatic duplicate writes. |

### RQ7. Tool naming convention

**Decision:** use `swsd_` prefix and verb-noun ordering.

Reasons:

- Clear namespace in multi-server agents.
- Predictable grouping in client tool lists.
- Avoids ambiguous generic names like `search` or `update`.

### RQ8. Output schema design

**Decision:** return both structured and text output.

- `structuredContent`: primary output for agents that chain calls.
- Text summary: compact summary for chat clients and humans.
- For list tools, default to compact fields and allow `include_details: true` for heavier fields.
- For incident detail, include canonical URL when the API response exposes it or the URL can be derived safely.

### RQ9. Tool annotations

**Decision:** use MCP tool annotations consistently.

Examples:

- `swsd_list_incidents`: read-only, non-destructive, idempotent.
- `swsd_get_incident`: read-only, non-destructive, idempotent.
- `swsd_create_incident`: write, non-destructive, not idempotent.
- `swsd_update_incident`: write, non-destructive, not idempotent.
- `swsd_add_incident_comment`: write, non-destructive, not idempotent.
- Future delete tools: destructive, not idempotent unless SWSD behavior proves otherwise.

### RQ10. Linking solutions to incidents

**Status:** not validated from accessible public API docs on 2026-05-03.

**Decision:**

- Do not include `swsd_link_solution_to_incident` in default v1 profile schemas until a sandbox smoke test confirms exact behavior.
- Keep the intended tool in the roadmap as `experimental`.
- If the relationship is actually an incident update with a `solutions`/attached-solutions field, implement it as a safe wrapper around `swsd_update_incident`, not as a separate direct endpoint.

### RQ11. Repo structure

**Decision:** single npm package with runtime profile selection.

Rationale:

- One package minimizes release overhead.
- Profiles are data/config, not separate products.
- Per-profile Copilot artifacts can still be generated from the single package.

### RQ12. Testing strategy

**Decision:** use layered tests.

1. Unit tests for schema validation, query serialization, output mapping, and error mapping.
2. Contract tests using recorded SWSD responses with secrets scrubbed.
3. Live sandbox tests for each endpoint before a tool becomes GA.
4. MCP Inspector smoke tests for stdio and HTTP.
5. Copilot Studio import test for each generated Swagger profile artifact.
6. Negative tests for missing token, invalid token, 422 validation, 404, and 429 with fake responses.

---

## 4. Tool catalog

### 4.1 Profile legend

- **Triage:** read-heavy support workflow plus add-comment.
- **Agent:** ticket-handler workflow, no solution authoring.
- **Knowledge:** KB author workflow.
- **Full:** all non-destructive v1 tools that have passed validation.

### 4.2 Incidents

| Tool | Description | Input schema sketch | Output shape | Triage | Agent | Knowledge | Full | Validation |
|---|---|---|---|---:|---:|---:|---:|---|
| `swsd_list_incidents` | List incidents with structured filters and pagination. | `{ page?, per_page?, states?, priorities?, categories?, assignee_email?, requester_email?, site?, department?, updated_from?, updated_to?, include_details? }` | `{ incidents: IncidentSummary[], page, per_page, has_more?, next_page? }` | Yes | Yes | No | Yes | Incident list validated; full filters pending live matrix. |
| `swsd_get_incident` | Get one incident by numeric SWSD id. | `{ id: number, include?: { comments?, custom_fields?, related? } }` | `{ incident: IncidentDetail }` | Yes | Yes | No | Yes | Validated. |
| `swsd_create_incident` | Create an incident. | `{ name, description?, priority?, requester_email?, assignee_email?, category?, site?, department?, custom_fields? }` | `{ incident: IncidentDetail }` | Extra only | Yes | No | Yes | Create path validated; exact optional field behavior needs live tests. |
| `swsd_update_incident` | Update explicit fields on an incident. | `{ id, name?, description?, state?, priority?, assignee_email?, category?, site?, department?, custom_fields? }` | `{ incident: IncidentDetail, changed_fields: string[] }` | Extra only | Yes | No | Yes | Update path validated; field matrix pending. |
| `swsd_assign_incident` | Assign incident to user/group. Safer wrapper around update. | `{ id, assignee_email?, group_name? }` | `{ incident: IncidentDetail }` | Extra only | Yes | No | Yes | Wrapper pending assignee/group field live tests. |
| `swsd_update_incident_state` | Change incident state. Safer wrapper around update. | `{ id, state, comment? }` | `{ incident: IncidentDetail }` | Extra only | Yes | No | Yes | Wrapper pending state/comment behavior live tests. |

### 4.3 Comments

| Tool | Description | Input schema sketch | Output shape | Triage | Agent | Knowledge | Full | Validation |
|---|---|---|---|---:|---:|---:|---:|---|
| `swsd_list_incident_comments` | List comments for an incident. | `{ incident_id, page?, per_page?, visibility? }` | `{ comments: Comment[], page, per_page, has_more? }` | Yes | Yes | No | Yes | SWSD supports comments on incidents; exact API path pending live test. |
| `swsd_add_incident_comment` | Add public/private comment to incident. | `{ incident_id, body, is_private? }` | `{ comment: Comment }` | Yes | Yes | No | Yes | SWSD supports comments; exact API payload pending live test. |
| `swsd_update_comment` | Update an existing comment. | `{ comment_id, body }` | `{ comment: Comment }` | No | Yes | No | Yes | Not validated; include only after endpoint confirmation. |
| `swsd_delete_comment` | Delete a comment. | `{ comment_id, reason? }` | `{ deleted: true }` | No | No | No | No | Excluded from v1 default profiles. Future `admin-destructive` only. |

### 4.4 Solutions / knowledge base

| Tool | Description | Input schema sketch | Output shape | Triage | Agent | Knowledge | Full | Validation |
|---|---|---|---|---:|---:|---:|---:|---|
| `swsd_search_solutions` | Search/list solution articles. | `{ query?, category?, page?, per_page?, updated_from?, updated_to? }` | `{ solutions: SolutionSummary[], page, per_page, has_more? }` | Yes | Yes | Yes | Yes | Concept validated; exact search params pending. |
| `swsd_get_solution` | Get one solution article. | `{ id }` | `{ solution: SolutionDetail }` | Yes | Yes | Yes | Yes | Pending endpoint smoke test. |
| `swsd_create_solution` | Create solution article. | `{ title, body, category?, status?, custom_fields? }` | `{ solution: SolutionDetail }` | No | No | Yes | Yes | Pending endpoint smoke test. |
| `swsd_update_solution` | Update solution article. | `{ id, title?, body?, category?, status?, custom_fields? }` | `{ solution: SolutionDetail, changed_fields: string[] }` | No | No | Yes | Yes | Pending endpoint smoke test. |
| `swsd_link_solution_to_incident` | Attach/link solution to incident. | `{ incident_id, solution_id, comment? }` | `{ incident: IncidentDetail, solution: SolutionSummary }` | No | No | No | Experimental only | Not validated; defer. |

### 4.5 Lookup readers

| Tool | Description | Input schema sketch | Output shape | Triage | Agent | Knowledge | Full | Validation |
|---|---|---|---|---:|---:|---:|---:|---|
| `swsd_list_categories` | List categories for incident/solution selection. | `{ module?: "incidents"|"solutions", page?, per_page? }` | `{ categories: LookupItem[] }` | Yes | Yes | Yes | Yes | Endpoint needs live confirmation; community examples show `categories.json`. |
| `swsd_list_sites` | List sites. | `{ page?, per_page?, query? }` | `{ sites: LookupItem[] }` | Yes | Yes | No | Yes | Pending. |
| `swsd_list_departments` | List departments. | `{ page?, per_page?, query? }` | `{ departments: LookupItem[] }` | Yes | Yes | No | Yes | Pending. |
| `swsd_list_users` | List users. | `{ page?, per_page?, query?, email? }` | `{ users: UserSummary[] }` | Yes | Yes | No | Yes | Third-party .NET client validates users concept; endpoint smoke test needed. |
| `swsd_list_groups` | List groups. | `{ page?, per_page?, query? }` | `{ groups: GroupSummary[] }` | Yes | Yes | No | Yes | Pending. |
| `swsd_list_priorities` | Return supported priorities. | `{}` | `{ priorities: LookupItem[] }` | Yes | Yes | No | Yes | May be static or API-backed after validation. |
| `swsd_list_states` | Return supported incident states. | `{}` | `{ states: LookupItem[] }` | Yes | Yes | No | Yes | May be static or API-backed after validation. |

### 4.6 Utility tools

| Tool | Description | Input schema sketch | Output shape | Triage | Agent | Knowledge | Full | Validation |
|---|---|---|---|---:|---:|---:|---:|---|
| `swsd_health_check` | Check token, base URL, and API reachability with minimal safe call. | `{}` | `{ ok, base_url, authenticated_as? }` | Yes | Yes | Yes | Yes | Implement against a low-cost read endpoint after live validation. |
| `swsd_get_server_info` | Return server version, enabled profile, enabled tools, configured base URL host. | `{}` | `{ version, profile, tools, base_url_host }` | Yes | Yes | Yes | Yes | Local-only; no SWSD dependency. |

---

## 5. Proposed repo structure

```text
swsd-mcp/
  package.json
  tsconfig.json
  README.md
  LICENSE
  Dockerfile
  docker-compose.example.yml
  .github/
    workflows/
      ci.yml
      release.yml
  src/
    index.ts
    cli.ts
    config/
      env.ts
      profiles.ts
      toolRegistry.ts
    transports/
      stdio.ts
      http.ts
      auth.ts
    mcp/
      server.ts
      annotations.ts
      output.ts
      errors.ts
    swsd/
      client.ts
      endpoints.ts
      pagination.ts
      query.ts
      errors.ts
      types.ts
      mappers/
        incident.ts
        comment.ts
        solution.ts
        lookup.ts
        customFields.ts
    tools/
      incidents/
        listIncidents.ts
        getIncident.ts
        createIncident.ts
        updateIncident.ts
        assignIncident.ts
        updateIncidentState.ts
      comments/
        listIncidentComments.ts
        addIncidentComment.ts
        updateComment.ts
      solutions/
        searchSolutions.ts
        getSolution.ts
        createSolution.ts
        updateSolution.ts
        linkSolutionToIncident.experimental.ts
      lookups/
        listCategories.ts
        listSites.ts
        listDepartments.ts
        listUsers.ts
        listGroups.ts
        listPriorities.ts
        listStates.ts
      utility/
        healthCheck.ts
        getServerInfo.ts
    schemas/
      common.ts
      incident.ts
      comment.ts
      solution.ts
      lookup.ts
  copilot-studio/
    triage.swagger.yaml
    agent.swagger.yaml
    knowledge.swagger.yaml
    full.swagger.yaml
    README.md
  scripts/
    generate-copilot-swagger.ts
    validate-swsd-endpoints.ts
    record-fixture.ts
  tests/
    unit/
    contract/
    fixtures/
      swsd/
    integration/
      live.swsd.spec.ts
      mcp-inspector.md
  docs/
    api-validation-matrix.md
    security.md
    operations.md
    troubleshooting.md
```

---

## 6. Milestones

### v0.0: Live validation pass

**Goal:** resolve every endpoint, response shape, and tenant-specific behavior question against the operator's production SWSD tenant before any implementation code is written.

**Validation environment:** Production SWSD tenant. Admin token. All test data marked, scoped to a dedicated test category, and cleaned up at the end. See the v0.0 Validation Runbook companion document for the executable plan.

Deliverables:

- API validation matrix fully resolved: every row marked verified with date and fixture path.
- Header negotiation probe completed: canonical Accept version locked.
- Custom-field schema for the operator's tenant captured as a reference fixture (`fixtures/tenant/custom-fields.json`).
- Recorded response fixtures for every endpoint the four profiles will touch, with secrets and PII scrubbed.
- Tenant-specific quirks documented in `docs/tenant-notes.md`.
- Cleanup pass executed: no orphaned test data left in production.

Exit criteria:

- Every "Pending live" or "Not validated" row in the validation matrix is resolved.
- Accept header version is locked with documented evidence.
- `link_solution_to_incident` relationship model is confirmed and either promoted out of experimental or formally dropped.
- Comment public/private write semantics are confirmed.
- Custom-field write payload shape is confirmed.
- No generated Copilot schema advertises a tool without a verified endpoint.

### v0.1: Incident read MVP

Deliverables:

- TypeScript CLI.
- Stdio transport.
- SWSD client with auth, base URL, headers, `.json` suffix handling.
- Tools:
  - `swsd_get_server_info`
  - `swsd_health_check`
  - `swsd_list_incidents`
  - `swsd_get_incident`
- Unit tests for pagination, query serialization, and error mapping.
- README local stdio setup.

Exit criteria:

- MCP Inspector can list and call read tools.
- Invalid/missing token errors are clear.
- Pagination output is stable and compact.

### v0.2: Agent ticket workflow

Deliverables:

- `swsd_create_incident`
- `swsd_update_incident`
- `swsd_assign_incident`
- `swsd_update_incident_state`
- Validated lookup readers needed by ticket tools.
- Contract tests for 422 field validation responses.

Exit criteria:

- Can create, assign, update, and state-transition a sandbox incident.
- Writes are never retried automatically unless proven idempotent.
- Agent-facing errors name invalid fields.

### v0.3: Comments and triage profile

Deliverables:

- `swsd_list_incident_comments`
- `swsd_add_incident_comment`
- Optional `swsd_update_comment` only if validated.
- `triage` and `agent` profile manifests.

Exit criteria:

- Public/private comment behavior is documented.
- Add-comment is confirmed not to leak private comments in summaries.

### v0.4: Streamable HTTP and Docker

Deliverables:

- Streamable HTTP `/mcp` endpoint.
- Per-request bearer-token handling.
- Dockerfile and docker-compose example.
- Health endpoint for container probes that does not require a SWSD token.
- Rate-limit/concurrency settings.

Exit criteria:

- HTTP mode passes MCP Inspector or equivalent streamable-client smoke test.
- Token redaction confirmed in logs.

### v0.5: Copilot Studio artifacts

Deliverables:

- Swagger 2.0 generator.
- `copilot-studio/*.swagger.yaml` for validated profiles.
- Copilot Studio setup guide.
- API-key-in-header connector guidance.

Exit criteria:

- Each Swagger file imports successfully.
- POST `/mcp` includes `x-ms-agentic-protocol: mcp-streamable-1.0`.
- Connector auth passes token header correctly to server.

### v0.6: Knowledge profile

Deliverables:

- Solution read/search tools.
- Solution create/update tools only after endpoint validation.
- `knowledge` profile.

Exit criteria:

- Solution tools pass live sandbox tests.
- Draft/published/status behavior is documented.

### v1.0: Public release

Deliverables:

- Stable profile system.
- npm package.
- GitHub release with MIT license.
- Full docs for local, Docker, and Copilot installs.
- Security notes for token handling.
- API validation matrix included in repo docs.

Exit criteria:

- CI passes unit and contract tests.
- Live tests are documented and optional for contributors.
- No unvalidated tool is enabled in default profiles.

---

## 7. Architectural revisions to discuss before implementation

The first three items below are now scheduled for resolution during v0.0 rather than carrying forward as architectural risks, since the operator has full admin access to the production tenant. They remain listed for visibility.

1. **`link_solution_to_incident` relationship model: resolve in v0.0.** Validation runbook will probe the actual relationship (incident attribute, separate join, or attached-solutions field). Promote to `full` profile or drop entirely based on findings.
2. **Comments and solutions endpoint shapes: resolve in v0.0.** Live probes against the tenant will replace the "partially validated" status with documented endpoint specs and recorded fixtures.
3. **Accept header version: resolve in v0.0.** Probe both `v1.1` and `v2.1` against the tenant, document any response-shape differences, lock the default. `SWSD_API_VERSION` env var stays in the design as an override.
4. **Use an alternate HTTP token header option.** `Authorization` should be default, but Copilot deployments may be simpler with a configurable API-key header name.
5. **Treat custom-field writes as best-effort validated pass-through.** v0.0 will introspect the operator's tenant and capture the actual custom-field schema as a reference fixture. Coworkers on the same tenant inherit the same fields, so for this distribution scope a single captured schema is sufficient. A regeneration script (`scripts/dump-custom-fields.ts`) ships with the package for any future cross-tenant deployment.
6. **Document that rate limits are unknown.** Implement robust behavior but do not claim SWSD-specific rate limits. v0.0 may surface practical limits empirically; record what you find but do not depend on them.
7. **Generate Copilot artifacts only from verified tools.** This prevents accidental connector exposure of experimental operations.
8. **Convenience wrapper tools: keep or drop?** `swsd_assign_incident` and `swsd_update_incident_state` are functional subsets of `swsd_update_incident`. They exist to narrow agent decision-making on the two most common write operations, which improves reliability for smaller models but expands the tool surface. Decide before v0.2 whether the reliability gain justifies the extra registrations, or drop them and rely on `swsd_update_incident` alone. Either choice is defensible.
9. **`delete_comment` revised out of `full`.** The original research brief included `delete_comment` in the `full` profile, which conflicted with the same brief's no-hard-deletes policy. This doc resolves the inconsistency by deferring `delete_comment` to a future `admin-destructive` profile alongside other destructive operations. This is a deliberate safety choice, not an oversight: flagged here so the deviation is visible and reversible if the operator disagrees.

---

## 8. API validation matrix template

Use this table during sandbox validation before opening implementation PRs.

| Tool | Endpoint | Method | Headers | Required payload | Response fixture | Smoke test status | Verified date | Notes |
|---|---|---:|---|---|---|---|---|---|
| _Header negotiation_ | `/incidents.json?per_page=1` | GET | Try `v1.1` and `v2.1` Accept | None | `fixtures/headers/version-probe.json` | Pending live | TBD | Confirm which Accept version the tenant returns 200 for; capture any response-shape differences between versions. Lock the default. |
| `swsd_list_incidents` | `/incidents.json` | GET | Standard SWSD JSON | Query params | `fixtures/incidents/list.json` | Pending live | TBD | Validate filters. |
| `swsd_get_incident` | `/incidents/{id}.json` | GET | Standard SWSD JSON | None | `fixtures/incidents/get.json` | Pending live | TBD | Community source says `.json` suffix required. |
| `swsd_create_incident` | `/incidents.json` | POST | Standard SWSD JSON | `{ incident: ... }` | `fixtures/incidents/create.json` | Pending live | TBD | Confirm required `name`. |
| `swsd_update_incident` | `/incidents/{id}.json` | PUT/PATCH per docs | Standard SWSD JSON | `{ incident: ... }` | `fixtures/incidents/update.json` | Pending live | TBD | Confirm method. |
| `swsd_list_incident_comments` | TBD | GET | Standard SWSD JSON | Query params | TBD | Not validated | TBD | Do not ship until validated. |
| `swsd_add_incident_comment` | TBD | POST | Standard SWSD JSON | TBD | TBD | Not validated | TBD | Confirm public/private field. |
| `swsd_search_solutions` | TBD | GET | Standard SWSD JSON | Query params | TBD | Not validated | TBD | Do not ship write tools until validated. |
| `swsd_get_solution` | TBD | GET | Standard SWSD JSON | None | TBD | Not validated | TBD |  |
| `swsd_create_solution` | TBD | POST | Standard SWSD JSON | TBD | TBD | Not validated | TBD |  |
| `swsd_update_solution` | TBD | PUT/PATCH per docs | Standard SWSD JSON | TBD | TBD | Not validated | TBD |  |

---

## 9. Source log

All public research below was accessed on **2026-05-03** unless otherwise stated.

| ID | Source | Date stamp | Used for | Confidence |
|---|---|---|---|---|
| S1 | User-provided `RESEARCH-BRIEF.md` | File created/modified 2026-05-03T15:53:09Z | Requirements, profiles, research questions, deliverables | High |
| S2 | MCP specification, Streamable HTTP / transports, `https://modelcontextprotocol.io/specification/2025-11-25/basic/transports` | Spec version 2025-11-25; accessed 2026-05-03 | Transport architecture | High |
| S3 | MCP specification, tools, `https://modelcontextprotocol.io/specification/2025-11-25/server/tools` | Spec version 2025-11-25; accessed 2026-05-03 | Tool annotations and schema behavior | High |
| S4 | Model Context Protocol TypeScript SDK, `https://github.com/modelcontextprotocol/typescript-sdk` | Accessed 2026-05-03 | SDK/runtime choice | High |
| S5 | Microsoft Learn, “Connect your agent to an existing MCP server”, `https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent` | Last updated 2026-04-14; accessed 2026-05-03 | Copilot Streamable transport, auth modes, Swagger 2.0 example, `x-ms-agentic-protocol` | High |
| S6 | SolarWinds, “Token authentication for API integration”, `https://documentation.solarwinds.com/en/success_center/swsd/content/completeguidetoswsd/token-authentication-for-api-integration.htm` | Accessed 2026-05-03 | API token behavior and permission caveats | High |
| S7 | SolarWinds ITSM API docs, `https://apidoc.samanage.com/` | Accessed 2026-05-03 | API reference; dynamic page was accessible but hard to extract fully | Medium |
| S8 | Public API-definition package diff, `solarwinds-itsm-api-definitions 0.1.0 -> 0.1.1`, `https://my.diffend.io/gems/solarwinds-itsm-api-definitions/0.1.0/0.1.1` | Accessed 2026-05-03 | Incident OpenAPI response/request shapes | Medium-High |
| S9 | THWACK accepted answer, “GetIncidentByID (REST API)”, `https://thwack.solarwinds.com/discussion/151299/getincidentbyid-rest-api` | Posted 2025-11-26; accessed 2026-05-03 | `.json` suffix and headers; community validation | Medium |
| S10 | SolarWinds, “Custom fields”, `https://documentation.solarwinds.com/en/success_center/swsd/content/completeguidetoswsd/custom-fields.htm` | Accessed 2026-05-03 | Custom field types, scope, indexing caveats | High |
| S11 | SolarWinds, “Comments”, `https://documentation.solarwinds.com/en/success_center/swsd/content/completeguidetoswsd/comments.htm` | Accessed 2026-05-03 | Comment concept, public/private comments | High for UI concept; not endpoint proof |
| S12 | `panoramicdata/SolarWinds.Api`, `https://github.com/panoramicdata/SolarWinds.Api` | Accessed 2026-05-03 | Third-party client validates incidents/users concepts | Medium |
| S13 | THWACK / community examples for SWSD headers and 422 validation errors | Accessed 2026-05-03; examples from 2021-2025 | Header patterns and validation-error behavior | Medium |
| S14 | Public community pagination examples mentioning `page` and 100-record retrieval | Accessed 2026-05-03 | Pagination practical behavior | Low-Medium; confirm live |

---

## 10. Immediate next actions

1. Run a live SWSD sandbox validation pass using the API validation matrix.
2. Fill exact endpoint/method/payload details for comments and solutions.
3. Decide whether unvalidated solution write tools stay out of v1 or move behind `experimental`.
4. Create the implementation backlog from milestones v0.1 through v1.0.
5. Only after those gates, begin code.
