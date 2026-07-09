---
title: Tools reference
description: All 66 MCP tools swsd-mcp registers, organized by category with per-profile availability.
---

swsd-mcp registers **66 tools** across 15 categories. Each tool's input schema, full description, and output shape is auto-discovered by your MCP client at runtime — ask your agent _"what swsd tools are available?"_ for the live list.

This page is the at-a-glance summary: what each tool does and which [profile](/configuration/#profiles) includes it.

## MCP Apps UI bundles

Seven read tools ship interactive UI bundles using the [MCP Apps capability](https://modelcontextprotocol.io/specification/2025-11-25) (SEP-1865). Hosts that support MCP Apps render a rich UI alongside the structured response — single-record detail views, filterable/sortable tables, comment threads, audit timelines, searchable explorers, and submit-ready forms — instead of (or in addition to) plain text. Hosts without MCP Apps support are unaffected: the same tools continue to return their normal text + structured output, and the `_meta.ui.resourceUri` advertisement is silently ignored.

| Tool | Widget | UI |
|---|---|---|
| `swsd_get_incident` | `incident-detail` | Single-record detail view (description, due date, SLA, resolution, custom fields) |
| `swsd_get_solution` | `solution-detail` | Single-record detail view with sanitized HTML body |
| `swsd_list_incidents`, `swsd_list_my_incidents` | `incident-list` | Filterable, sortable table with overflow scroll |
| `swsd_list_incident_comments` | `comment-thread` | Vertical conversation with author chips, timestamps, public/private badges, sanitized HTML bodies |
| `swsd_get_record_audits` | `audit-timeline` | Vertical timeline grouped by day with action chips and field-level diffs |
| `swsd_get_catalog_item` | `catalog-item-form` | Renders catalog variables as a form; submits via `swsd_create_service_request` (calls back into the server through `app.callServerTool`) |
| `swsd_describe_custom_fields` | `custom-fields` | Searchable explorer with scope/module filters |

HTML content (solution bodies, incident descriptions, comment bodies, catalog helptext) is sanitized client-side via DOMPurify before insertion — no external network access, no third-party scripts. Tools with a UI bundle are marked **UI** in the Type column below.

## v2.1: id-or-number friendly inputs

Every id-keyed tool now accepts **either** the internal id (≥7 digits, the SWSD primary key) **or** the human-facing number visible in the SWSD UI (≤6 digits for incidents, ≤4 digits for solutions). The disambiguator looks at digit count first; ambiguous inputs trigger a single targeted list lookup. Affected tools:

- `swsd_get_incident`, `swsd_update_incident`, `swsd_assign_incident`, `swsd_update_incident_state`, `swsd_link_solution_to_incident`
- `swsd_list_incident_comments`, `swsd_add_incident_comment`, `swsd_update_comment`
- `swsd_get_solution`, `swsd_update_solution`
- `swsd_get_record_audits` (when `object_type` is `incidents` or `solutions`; other types remain id-only)

This eliminates the 4-round-trip "find then fetch" pattern that v2.0.2 user smoke testing surfaced — agents can paste the number from a SWSD email or browser tab directly.

## Legend

| Symbol | Meaning |
|---|---|
| ✓ | Tool is registered in this profile |
| W | Write tool — modifies SWSD state. Does not retry on transient failure (avoids duplicate writes). Honors `SWSD_WRITE_MODE`. |
| R | Read tool — safe to retry; auto-retries up to `SWSD_RETRY_MAX_ATTEMPTS` on 5xx/network errors. |
| UI | Ships an [MCP Apps](#mcp-apps-ui-bundles) UI bundle (SEP-1865). Capable hosts render a rich interactive view; text-only clients are unaffected. |

---

## Utility (3)

| Tool | Type | triage | agent | knowledge | operations | full |
|---|---|---|---|---|---|---|
| `swsd_get_server_info` | R | ✓ | ✓ | ✓ | ✓ | ✓ |
| `swsd_health_check` | R | ✓ | ✓ | ✓ | ✓ | ✓ |
| `swsd_get_me` | R | ✓ | ✓ | ✓ | ✓ | ✓ |

`swsd_get_server_info` returns version, profile, transport, base URL, and the list of enabled tools — useful for verifying server configuration from inside the MCP client. Also includes documented SWSD upstream rate limits (`upstream_rate_limit`: 1000 calls/min on Advanced, 1500 on Premier; signal: `429 + Retry-After` only — SWSD does not return `X-RateLimit-*` headers) so the model can reference these without guessing.

`swsd_health_check` performs a live API call to SWSD (lightweight read against `/users/me.json`) and returns connectivity + auth status. Use this as the first call to confirm your token works.

`swsd_get_me` returns the SWSD user record for the token's owner — `id`, `email`, `name`, `title`, `role`, `department`, `site`, `group_ids`, and assignment status. Combines three identity paths: JWT payload decode (zero-cost, always works), `GET /users/{user_ic}.json` (documented endpoint), and `GET /profile.json` (optional fallback that adds `last_login`). **Call this first** when the request mentions "me", "my", or "I" (e.g. "my tickets", "tickets in my group", "tickets assigned to me"), then pass the returned `id`/`email` to `assignee_email` or `requester_email` filters on `swsd_list_incidents`.

---

## Incidents (8)

| Tool | Type | triage | agent | knowledge | operations | full |
|---|---|---|---|---|---|---|
| `swsd_list_incidents` | R, UI | ✓ | ✓ | ✓ | ✓ | ✓ |
| `swsd_list_my_incidents` | R, UI | ✓ | ✓ | ✓ | ✓ | ✓ |
| `swsd_get_incident` | R, UI | ✓ | ✓ | ✓ | ✓ | ✓ |
| `swsd_create_incident` | W |   | ✓ |   | ✓ | ✓ |
| `swsd_update_incident` | W |   | ✓ |   | ✓ | ✓ |
| `swsd_assign_incident` | W |   | ✓ |   | ✓ | ✓ |
| `swsd_update_incident_state` | W |   | ✓ |   | ✓ | ✓ |
| `swsd_link_solution_to_incident` | W |   | ✓ |   | ✓ | ✓ |

- **`swsd_list_incidents`** — paginated list with structured filters using SWSD repeated-key array semantics (multiple values within a filter are OR-ed). Filters: `states`, `priorities`, `categories`, `assignee_email`, `requester_email`, `sites`, `departments`, `assigned_to_group` (group ID, not user ID), `created_from`/`created_to`, `updated_from`/`updated_to`, `updated_within` (date-natural-language alias — `"24h"`, `"7d"`, `"1w"`, `"30d"`, etc.), `state_is_not` (negative state filter — e.g. `["Resolved", "Closed"]` to see only open work), `sort_by` (`created_at`, `updated_at`, `priority`, `name`, `due_at`), `sort_order` (`ASC`/`DESC`), `query` (free-text across title and description). Returns compact summaries (id, name, state, priority, assignee_email, requester_email, category, updated_at) — call `swsd_get_incident` for full detail of any one row.
- **`swsd_list_my_incidents`** — thin wrapper over `swsd_list_incidents` that auto-resolves the authenticated user's email (via JWT decode + `/users/{user_ic}.json`) and applies it as `assignee_email`. One round-trip instead of two for first-person queries ("my tickets", "tickets assigned to me"). Same input shape as `swsd_list_incidents` minus `assignee_email`. Renders the same `incident-list` widget as `swsd_list_incidents` in MCP Apps-capable hosts. For tenant-wide queries use `swsd_list_incidents` with explicit filters.
- **`swsd_get_incident`** — full incident detail as returned by SWSD (passthrough), including custom-field values. Accepts the incident's `id` or human-facing `number`. Pass `detail_level: "long"` to include comments, attachments, audits, SLA data, tags, statistics, satisfaction, and resolution detail in one call. Default `"short"` is faster and cheaper; recommend `"long"` when the user asks "show me everything about ticket X" or wants comments/attachments/audits. Renders the `incident-detail` widget in MCP Apps-capable hosts (description, due date with Overdue badge, SLA violations, resolution body, custom fields).
- **`swsd_create_incident`** — minimum required: `name`. Strongly recommended: `description`, `requester`, `category`, `site`. Returns the created incident's full payload. To set tenant-specific custom field values, pass `custom_fields: [{name, value}]` — call `swsd_describe_custom_fields` first to discover field names and (for Dropdowns) allowed values. Validated for Text, Dropdown, Number, Checkbox, and Date types.
- **`swsd_update_incident`** — partial-update semantics: pass only the fields you want to change. Accepts the incident's `id` or human-facing `number`. To clear a field, pass `null`. To set tenant-specific custom field values, pass `custom_fields: [{name, value}]` — call `swsd_describe_custom_fields` first to discover field names and (for Dropdowns) allowed values. Validated for Text, Dropdown, Number, Checkbox, and Date types.
- **`swsd_assign_incident`** — convenience wrapper for changing the assignee (user or group). Accepts the incident's `id` or human-facing `number`. Validates that the assignee exists.
- **`swsd_update_incident_state`** — state transition with optional resolution comment. Accepts the incident's `id` or human-facing `number`. Validates against your tenant's allowed states.
- **`swsd_link_solution_to_incident`** — append-only solution linking. Accepts both ids/numbers (incident and solution) in either form. Fetches existing links, adds the new one, PUTs the merged set so existing links aren't dropped.

:::note[v2: list responses echo your filters and discriminate scope]
As of v2, `swsd_list_incidents` and `swsd_list_my_incidents` return an `applied_filters` block (verbatim echo of the filters used — empty object if none) and a `pagination.total_scope` discriminator (`"filtered"` | `"tenant"` | `"unknown"`). Use these together to reason about whether a 25-incident result is "page 1 of 87 matching your filters" vs "page 1 of 56,800 tenant-wide" — without guessing. `"unknown"` means SWSD did not return `X-Total-Count` for this query.
:::

---

## Service Catalog (3)

| Tool | Type | triage | agent | knowledge | operations | full |
|---|---|---|---|---|---|---|
| `swsd_list_catalog_items` | R | ✓ | ✓ | ✓ | ✓ | ✓ |
| `swsd_get_catalog_item` | R, UI | ✓ | ✓ | ✓ | ✓ | ✓ |
| `swsd_create_service_request` | W |   | ✓ |   | ✓ | ✓ |

Use the catalog flow when the user asks to **request** something — new hardware, software access, an account, a file restore — instead of `swsd_create_incident`. SWSD's catalog items carry pre-defined approval routing, request variables (form fields), category/subcategory defaults, and SLA targets that a free-form incident misses. The server `instructions` advertise this preference order so capable agents pick the catalog flow automatically.

- **`swsd_list_catalog_items`** — paginated list of catalog items with `state`, `department`, `site`, and free-text `query` filters. Returns compact summaries (id, name, state, category/subcategory, request_count, updated_at, variable_count). Carries the same `applied_filters` echo + `pagination.total_scope` discriminator as `swsd_list_incidents`. Call this first when you need to find the right catalog item.
- **`swsd_get_catalog_item`** — single-item lookup that exposes the full `variables` array (the request form schema). Each variable carries `id` (consume as `custom_field_id` when submitting), `name`, `kind` (`free_text` / `drop_down_menu` / `multi_select` / `date` / `user`), `field_type` (numeric SAManage code), `options` (newline-separated allowed values for dropdowns), `required`, and `helptext`. Inspect the variables before filling them — for dropdowns, the `value` you submit must match one of the `options` verbatim. **Renders the `catalog-item-form` widget** in MCP Apps-capable hosts: variables become a form whose Submit button calls `swsd_create_service_request` directly via `app.callServerTool`, collapsing the 4-round-trip request workflow to 2.
- **`swsd_create_service_request`** — submits a request via `POST /catalog_items/{id}/service_requests.json`. The endpoint auto-sets `is_service_request: true` and inherits the catalog item's category/subcategory. Each `request_variables` entry maps a catalog variable's `id` (as `custom_field_id`) to a string `value`. Requester defaults to the JWT-authenticated user; pass `requester_id` to file the request on behalf of someone else. Optionally accepts `description` (initial comment) and `custom_fields_values` (SWSD-level custom fields, separate from the catalog's `request_variables`).

:::note[v2.5 deferred: `swsd_list_my_service_requests`]
A "list my service requests" wrapper is not shipped. The SAManage REST API has no documented filter parameter that narrows `/incidents.json` to service-request rows (we probed 14 candidates including `is_service_request=true`, `sub_type=*`, `request_type=*`, all silently ignored). A wrapper that paginated through tens of thousands of incidents to find the few service-request rows would be a bad tool. Will revisit once SWSD documents the correct filter mechanism.
:::

---

## Comments (3)

| Tool | Type | triage | agent | knowledge | operations | full |
|---|---|---|---|---|---|---|
| `swsd_list_incident_comments` | R, UI | ✓ | ✓ |   | ✓ | ✓ |
| `swsd_add_incident_comment` | W | ✓ | ✓ |   | ✓ | ✓ |
| `swsd_update_comment` | W |   | ✓ |   | ✓ | ✓ |

- **`swsd_list_incident_comments`** — paginated comment thread for an incident, including private/internal comments if your token has permission. Accepts the incident's `id` or human-facing `number`. Renders the `comment-thread` widget in MCP Apps-capable hosts (vertical conversation with author chips, timestamps, public/private badges, sanitized HTML bodies).
- **`swsd_add_incident_comment`** — post a new comment. Set `is_private: true` for internal-only comments (default `false` = visible to the requester). Accepts the incident's `id` or human-facing `number`. To edit later, use `swsd_update_comment`.
- **`swsd_update_comment`** — edit an existing comment's body or visibility. Accepts the parent incident's `id` or human-facing `number`.

---

## Tasks (3)

| Tool | Type | triage | agent | knowledge | operations | full |
|---|---|---|---|---|---|---|
| `swsd_list_incident_tasks` | R | ✓ | ✓ |   | ✓ | ✓ |
| `swsd_create_incident_task` | W |   | ✓ |   | ✓ | ✓ |
| `swsd_update_task_state` | W |   | ✓ |   | ✓ | ✓ |

SWSD incident sub-tasks are inline-only — they exist as ordered children of a parent incident, not as first-class records, so every tool here takes an `incident_id_or_number`.

- **`swsd_list_incident_tasks`** — paginated task list for one incident. Returns id, title, completion status, assignee, position (display order), and timestamps. Use this to see open work without opening the parent incident.
- **`swsd_create_incident_task`** — create a sub-task on the parent incident. Required: `title`. Optional: `assignee_id`, `position`, `description`. Posted via `POST /incidents/{id}/tasks.json`.
- **`swsd_update_task_state`** — toggle a task's completion. `complete: true` marks done (sets `completion_date`); `complete: false` reopens. PUTs to `/incidents/{incident_id}/tasks/{task_id}.json`.

---

## Time Tracking (3)

| Tool | Type | triage | agent | knowledge | operations | full |
|---|---|---|---|---|---|---|
| `swsd_list_time_tracks` | R |   | ✓ |   | ✓ | ✓ |
| `swsd_log_time` | W |   | ✓ |   | ✓ | ✓ |
| `swsd_update_time_track` | W |   | ✓ |   | ✓ | ✓ |

Time entries are scoped to a parent `incident`, `problem`, `change`, or `release`.

- **`swsd_list_time_tracks`** — paginated work-log lookup for a parent record.
- **`swsd_log_time`** — add a time entry with a description and `minutes_parsed`.
- **`swsd_update_time_track`** — update an existing time entry's description and/or minutes.

---

## Attachments (1)

| Tool | Type | triage | agent | knowledge | operations | full |
|---|---|---|---|---|---|---|
| `swsd_upload_attachment` | W |   | ✓ |   | ✓ | ✓ |

- **`swsd_upload_attachment`** — upload evidence to incidents, problems, changes, releases, solutions, hardware assets, other assets, or configuration items. Use `content_base64` for HTTP/hosted clients; `file_path` is allowed only in stdio mode.

---

## Problems (3)

| Tool | Type | triage | agent | knowledge | operations | full |
|---|---|---|---|---|---|---|
| `swsd_list_problems` | R | ✓ | ✓ |   | ✓ | ✓ |
| `swsd_get_problem` | R |   | ✓ |   | ✓ | ✓ |
| `swsd_create_problem` | W |   | ✓ |   | ✓ | ✓ |

ITIL problem records — separate from incidents, scoped to root-cause investigation across recurring incidents. Read-only visibility ships in the `triage` profile so first-line support can see open root-cause work without granting promote/create rights.

- **`swsd_list_problems`** — paginated browse with `state`, `priority`, `assignee_email`, `category`, `created_from`/`created_to`, free-text `query`, and standard sort/page filters. Returns compact summaries (id, name, state, priority, assignee, updated_at).
- **`swsd_get_problem`** — full problem detail as returned by SWSD (passthrough), including custom-field values and any linked incidents.
- **`swsd_create_problem`** — create a new problem record. Required: `name`. Strongly recommended: `description`, `requester`, `category`. Use this when an agent recognizes that several incidents share a common root cause.

---

## Change & Release (8)

| Tool | Type | triage | agent | knowledge | operations | full |
|---|---|---|---|---|---|---|
| `swsd_list_changes` | R |   |   |   | ✓ | ✓ |
| `swsd_get_change` | R |   |   |   | ✓ | ✓ |
| `swsd_create_change` | W |   |   |   | ✓ | ✓ |
| `swsd_update_change` | W |   |   |   | ✓ | ✓ |
| `swsd_list_releases` | R |   |   |   | ✓ | ✓ |
| `swsd_get_release` | R |   |   |   | ✓ | ✓ |
| `swsd_create_release` | W |   |   |   | ✓ | ✓ |
| `swsd_update_release` | W |   |   |   | ✓ | ✓ |

Use these for ITSM lifecycle work that needs change/release records instead of free-form incidents.

- **`swsd_list_changes` / `swsd_get_change`** — browse and inspect SWSD change records. `detail_level: "long"` maps to SWSD `layout=long` where documented.
- **`swsd_create_change` / `swsd_update_change`** — create or update change records with plans, rollback/test plans, CI links, tags, and custom fields.
- **`swsd_list_releases` / `swsd_get_release`** — browse and inspect release records.
- **`swsd_create_release` / `swsd_update_release`** — create or update release plans, build/deploy notes, linked changes, CIs, tags, and custom fields.

---

## Assets & CMDB (12)

| Tool | Type | triage | agent | knowledge | operations | full |
|---|---|---|---|---|---|---|
| `swsd_list_hardware_assets` | R |   |   |   | ✓ | ✓ |
| `swsd_get_hardware_asset` | R |   |   |   | ✓ | ✓ |
| `swsd_list_mobile_devices` | R |   |   |   | ✓ | ✓ |
| `swsd_get_mobile_device` | R |   |   |   | ✓ | ✓ |
| `swsd_list_printers` | R |   |   |   | ✓ | ✓ |
| `swsd_get_printer` | R |   |   |   | ✓ | ✓ |
| `swsd_list_software_assets` | R |   |   |   | ✓ | ✓ |
| `swsd_get_software_asset` | R |   |   |   | ✓ | ✓ |
| `swsd_list_other_assets` | R |   |   |   | ✓ | ✓ |
| `swsd_get_other_asset` | R |   |   |   | ✓ | ✓ |
| `swsd_list_configuration_items` | R |   |   |   | ✓ | ✓ |
| `swsd_get_configuration_item` | R |   |   |   | ✓ | ✓ |

These read tools expose asset and CMDB context without adding asset mutation risk.

- **Hardware, mobile, printer, software, and other asset tools** — compact list views plus single-record passthrough detail for asset investigation.
- **Configuration item tools** — CMDB lookup for change planning and dependency review.

---

## Procurement & Risk (7)

| Tool | Type | triage | agent | knowledge | operations | full |
|---|---|---|---|---|---|---|
| `swsd_list_contracts` | R |   |   |   | ✓ | ✓ |
| `swsd_get_contract` | R |   |   |   | ✓ | ✓ |
| `swsd_list_purchase_orders` | R |   |   |   | ✓ | ✓ |
| `swsd_get_purchase_order` | R |   |   |   | ✓ | ✓ |
| `swsd_list_vendors` | R |   |   |   | ✓ | ✓ |
| `swsd_get_vendor` | R |   |   |   | ✓ | ✓ |
| `swsd_list_risks` | R |   |   |   | ✓ | ✓ |

Procurement context helps agents answer warranty, vendor, and purchase-history questions without opening a separate system.

- **Contract, purchase order, and vendor tools** — list and inspect procurement records tied to operational work.
- **`swsd_list_risks`** — browse documented SWSD risk records.

---

## Solutions / Knowledge Base (4)

| Tool | Type | triage | agent | knowledge | operations | full |
|---|---|---|---|---|---|---|
| `swsd_search_solutions` | R |   | ✓ | ✓ | ✓ | ✓ |
| `swsd_get_solution` | R, UI |   | ✓ | ✓ | ✓ | ✓ |
| `swsd_create_solution` | W |   |   | ✓ |   | ✓ |
| `swsd_update_solution` | W |   |   | ✓ |   | ✓ |

- **`swsd_search_solutions`** — full-text search across titles and descriptions. Pass `category` to filter to a specific KB section.
- **`swsd_get_solution`** — full solution as returned by SWSD (passthrough), including both `description` (HTML) and `description_no_html` (plain text), custom-field values, comments count, and attachment metadata. Accepts the solution's `id` or human-facing `number`. Pass `detail_level: "long"` to include attachments, audits, tags, and full statistics in one call. Default `"short"` is faster. Renders the `solution-detail` widget in MCP Apps-capable hosts (full sanitized HTML body, not just an excerpt — the whole point of opening a KB article).
- **`swsd_create_solution`** — required: `title`. Strongly recommended: `description` (HTML supported), `state`, `category`. To set tenant-specific custom field values, pass `custom_fields: [{name, value}]` — call `swsd_describe_custom_fields` first to discover field names and (for Dropdowns) allowed values. Solutions require `name` keying (`custom_field_id` alone is rejected with HTTP 400). Validated for Text, Dropdown, Number, Checkbox, and Date types.
- **`swsd_update_solution`** — partial update. Accepts the solution's `id` or human-facing `number`. To replace the description entirely, pass the full new body. To set tenant-specific custom field values, pass `custom_fields: [{name, value}]` — call `swsd_describe_custom_fields` first to discover field names and (for Dropdowns) allowed values. Solutions require `name` keying (`custom_field_id` alone is rejected with HTTP 400). Validated for Text, Dropdown, Number, Checkbox, and Date types.

---

## Lookups (6)

All lookup tools are read-only. They exist to validate IDs/names before passing to write tools (e.g., look up a site name before creating an incident with `site_name`).

| Tool | Type | triage | agent | knowledge | operations | full |
|---|---|---|---|---|---|---|
| `swsd_list_categories` | R | ✓ | ✓ | ✓ | ✓ | ✓ |
| `swsd_list_sites` | R |   | ✓ |   | ✓ | ✓ |
| `swsd_list_departments` | R |   | ✓ |   | ✓ | ✓ |
| `swsd_list_users` | R | ✓ | ✓ | ✓ | ✓ | ✓ |
| `swsd_list_groups` | R |   | ✓ |   | ✓ | ✓ |
| `swsd_list_roles` | R |   | ✓ |   | ✓ | ✓ |

Each returns `id`, `name`, plus type-specific fields (e.g., `time_zone` for sites, `disabled` for groups).

---

## Custom fields (1)

| Tool | Type | triage | agent | knowledge | operations | full |
|---|---|---|---|---|---|---|
| `swsd_describe_custom_fields` | R, UI |   | ✓ | ✓ | ✓ | ✓ |

- **`swsd_describe_custom_fields`** — schema introspection for custom fields defined in your tenant. Returns each field's `name`, `type`, `category`, allowed values (for picklists), and which entity types it applies to.

:::note[v2: custom-field writes are now supported]
As of v2, the four write tools (`swsd_create_incident`, `swsd_update_incident`, `swsd_create_solution`, `swsd_update_solution`) accept a `custom_fields: [{name, value}]` parameter. Call `swsd_describe_custom_fields` first to discover field names and (for Dropdowns) allowed values. Validated for Text, Dropdown, Number, Checkbox, and Date types. Solutions require `name` keying (`custom_field_id` alone is rejected with HTTP 400).
:::

---

## Audits (1)

| Tool | Type | triage | agent | knowledge | operations | full |
|---|---|---|---|---|---|---|
| `swsd_get_record_audits` | R, UI |   | ✓ |   | ✓ | ✓ |

- **`swsd_get_record_audits`** — list the audit log for a SWSD record. Wraps `GET /{type}/{id}/audits.json`. Each audit entry captures one change: action (`"Update"`/`"Create"`/`"Delete"`), message (e.g. `"State changed from New to Assigned"`), the user who performed it, and the timestamp. Use this to answer "who changed this ticket?" or "what happened since I last looked?". Cheaper than `swsd_get_incident` with `detail_level=long` when you only need the audit history. `object_type` accepts `incidents`, `problems`, `changes`, `releases`, `solutions`, `hardwares`, `other_assets`. When `object_type` is `incidents` or `solutions`, `id` accepts either the internal id or the human-facing number; other types remain id-only. Renders the `audit-timeline` widget in MCP Apps-capable hosts (vertical timeline grouped by day with action chips and field-level diffs).

---

## Adding tools to a profile

Use `SWSD_ENABLE_EXTRAS` to add specific tools on top of the chosen profile. See [Configuration → Profiles](/configuration/#profiles).

Example: triage profile + KB read access:

```bash
SWSD_PROFILE=triage
SWSD_ENABLE_EXTRAS=swsd_search_solutions,swsd_get_solution
```
