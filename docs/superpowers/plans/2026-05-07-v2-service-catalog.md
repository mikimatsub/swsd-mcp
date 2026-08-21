# Service Catalog (Plan E) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three swsd-mcp tools that expose the SolarWinds Service Desk catalog: `swsd_list_catalog_items` (browse what's offerable), `swsd_get_catalog_item` (inspect a single item's request form schema), and `swsd_create_service_request` (submit a catalog request as an incident with `is_service_request: true`, `catalog_item_id`, and `request_variables`).

**Architecture:** Three tools, all calling `api.samanage.com`. Two reads (`/catalog_items.json` list and single GET) and one write (`/incidents.json` POST with the SAManage-specific service-request payload shape). Reuses Plan B's `applied_filters` + `total_scope` pattern for the list tool. Reuses Plan C's nested-wrapper write idiom for the create tool. No new runtime dependencies.

**Tech Stack:** Same as v2: `@modelcontextprotocol/sdk@^1.29.0`, zod 4.x, vitest 4.x, TypeScript 6.x. No new packages.

---

## What was researched (live API probes)

The following findings come from probes recorded in `.research/v2/swsd-probes/` against the production tenant (gitignored: implementers can re-run them with `SWSD_TOKEN` set):

- **`GET /catalog_items.json`** returns an array of catalog items. Pagination via standard `page`/`per_page`; `X-Total-Count` header reflects total. Per-tenant volume is small (this tenant: 14 items total): no aggressive pagination concerns.
- **`GET /catalog_items/{id}.json`** returns the same shape as a list entry: no extra fields surfaced. (Confirmed: 23,919-byte single-item GET vs ~13.5 KB per item in the list.)
- **`GET /catalog_categories.json`** returns 404. There is no separate categories endpoint: categories are a property of each catalog item (`category` and `subcategory` fields).
- **`GET /service_requests.json`** returns 404. Service requests are surfaced ONLY through the regular `/incidents.json` collection with `is_service_request: true`.
- **No documented query filter narrows `/incidents.json` to service requests.** Fourteen candidates were tried, including `is_service_request=true`, `sub_type=*`, `request_type=*`, and `incident_type=*`; all were silently ignored and returned the unfiltered set. Categories don't cluster either (service requests appear in the same `Software`/`File System`/etc. categories as regular incidents). **Consequence: this plan does NOT include a `swsd_list_my_service_requests` wrapper.** A wrapper that paginated through 56,800 incidents to find the few service-request rows would be a bad tool. Defer to v2.5 once SWSD documents (or we discover) the correct filter mechanism.

Catalog-item shape:
```
id, url_id, name, description (HTML), price, currency, show_price,
state ("Approved" | "Internal" | "Draft"), portal_homepage, created_at, updated_at,
image_href, due_days, show_due_days, category, subcategory, department, site, tags,
request_count, variables, variables_unparsed, custom
```

Per-variable shape inside `variables`:
```
id, uuid (numeric), name, kind ("free_text" | "drop_down_menu" | "multi_select" | "date" | "user" | null),
field_type (1, 2, 4, 5, 7, 8: see mapping below), options (newline-separated string for dropdowns),
required ("0"/"1" string), sorted (boolean | null), helptext (HTML string)
```

`kind` to `field_type` mapping observed in this tenant (record what you find; do NOT hardcode any inferred mapping into the mapper: pass through both fields):
- `free_text` → 1
- `drop_down_menu` → 2
- `date` → 4
- `multi_select` → 8
- `user` → 7
- `null` (section header / label) → 6

When the request is created, the SUBMITTED `request_variables` array on the resulting incident has a different shape per row:
```
{ id, custom_field_id, name, value, attachment, options, type (int), type_name (string), entity, user }
```

Note `type_name`'s SAManage names ("Text_Area", "Dropdown", "Free_Text", ...) differ from the catalog-item `kind` names ("free_text", "drop_down_menu", ...). The TWO sides are semantically the same field type but use different label conventions: DO NOT try to translate or normalize. Pass through both fields as-is.

---

## Strict Additivity Contract

This plan must NOT regress any existing behavior:

- All existing v2 tools' input/output schemas are unchanged.
- The 4 existing UI-bearing tools' UI bundles + `_meta.ui.resourceUri` advertisements are unchanged. (No UI for the new catalog tools in this plan; that's a Tier 3 follow-up.)
- Existing test count baseline (post-Plan-D-merge) is **373 unit tests**. Plan E adds tests for 3 new tools; expected post-Plan-E baseline is ~395-410 depending on coverage granularity.
- The e2e MCP smoke test at `.research/v2/smoke-tests/mcp-e2e-smoke.mjs` currently passes 14/14. Plan E adds Test 8 (`swsd_list_catalog_items` returns the expected shape with at least 1 item; or 0 items + applied_filters present); expected post-Plan-E e2e: 14/14 still passing PLUS 1 or 2 new tests = 15-16.

A regression check (`npm test` + e2e smoke) must pass after every task in this plan.

---

## File Structure

**New files:**
- `src/schemas/catalogItem.ts`: Zod input schemas for `swsd_list_catalog_items` (state/department/site filters, pagination) and `swsd_get_catalog_item` (id).
- `src/schemas/serviceRequest.ts`: Zod input schema for `swsd_create_service_request`. Mirrors `createIncident.ts`'s shape but adds `catalog_item_id` (required) and `request_variables` (array of `{custom_field_id, value}`).
- `src/swsd/types.ts`: append `CatalogItemSummary`, `CatalogItemDetail`, `CatalogItemVariable` interfaces.
- `src/swsd/mappers/catalogItem.ts`: `toCatalogItemSummary(raw)` (compact projection for list responses) and `toCatalogItemDetail(raw)` (full pass-through with normalized variables array).
- `src/tools/catalog/listCatalogItems.ts`: `swsd_list_catalog_items` tool registration.
- `src/tools/catalog/getCatalogItem.ts`: `swsd_get_catalog_item` tool registration.
- `src/tools/catalog/createServiceRequest.ts`: `swsd_create_service_request` tool registration.
- `tests/unit/mappers/catalogItem.test.ts`: mapper unit tests (real-shape fixtures captured from live probes).
- `tests/unit/tools/listCatalogItems.test.ts`: input-schema validation + applied_filters/total_scope assertions (uses a fake client, not live HTTP).
- `tests/unit/tools/getCatalogItem.test.ts`: input-schema validation + structured output shape.
- `tests/unit/tools/createServiceRequest.test.ts`: input-schema validation + payload shape verification (asserts that the POST body matches the SAManage nested-wrapper convention with `incident.{is_service_request, catalog_item_id, request_variables, custom_fields_values}`).

**Modified files:**
- `src/config/toolRegistry.ts`: register the 3 new tools.
- `src/config/profiles.ts`: add new tools to the appropriate profiles.
- `src/mcp/server.ts`: append guidance to the INSTRUCTIONS array (e.g., "When the user wants to fulfill a request, prefer `swsd_create_service_request` over `swsd_create_incident` if a matching catalog item exists.").
- `src/tools/utility/healthCheck.ts`: bump the tool-count surfacing assertion if needed (verify by running `npm test` after toolRegistry change).
- `tests/unit/toolNames.test.ts`: auto-includes 3 new tools (it iterates the registry); test count increases by 3 here.
- `README.md`: append a section on the catalog tools.
- `CHANGELOG.md`: entry under unreleased v2.
- `docs-site/src/content/docs/tools.md`: add 3 rows + brief catalog-tool description block.
- `.research/v2/smoke-tests/mcp-e2e-smoke.mjs`: add Test 8 (`swsd_list_catalog_items` smoke).

---

## Task 1: List catalog items (read-only)

**Goal:** Ship `swsd_list_catalog_items` with applied_filters/total_scope per Plan B, output mapped via `toCatalogItemSummary`. Validates the catalog endpoint integration end-to-end before tackling single-record GET or write.

**Files:**
- Create: `src/schemas/catalogItem.ts`, `src/swsd/types.ts` (append), `src/swsd/mappers/catalogItem.ts`, `src/tools/catalog/listCatalogItems.ts`
- Create: `tests/unit/mappers/catalogItem.test.ts`, `tests/unit/tools/listCatalogItems.test.ts`
- Modify: `src/config/toolRegistry.ts`, `src/config/profiles.ts`

- [ ] **Step 1: Capture a real list-response fixture**

```bash
mkdir -p tests/fixtures/swsd
curl -s -H "X-Samanage-Authorization: Bearer $SWSD_TOKEN" \
  -H "Accept: application/vnd.samanage.v2.1+json" \
  "https://api.samanage.com/catalog_items.json?per_page=2" \
  > tests/fixtures/swsd/catalog_items_list.json
```

The first item's `variables` array is mapper input. Inspect manually:

```bash
node -e "const j=require('./tests/fixtures/swsd/catalog_items_list.json'); console.log(JSON.stringify(j[0].variables[0], null, 2))"
```

Confirm fields: `id`, `uuid`, `name`, `kind`, `field_type`, `options`, `required` (string), `sorted`, `helptext`.

(If `tests/fixtures/swsd/` doesn't exist or is in `.gitignore`, just keep the fixture out of the commit: it has account-internal data anyway. The mapper test below uses a hand-edited synthesized fixture below; this step is just for the implementer's reference.)

- [ ] **Step 2: Define `CatalogItemSummary` + `CatalogItemDetail` + `CatalogItemVariable` types**

Append to `src/swsd/types.ts`:

```ts
export interface CatalogItemVariable {
  /** Per-variable row id from SWSD. Pass through to swsd_create_service_request as `custom_field_id`. */
  id: number;
  /** Display name for the variable (e.g. "New Employee First Name"). */
  name: string;
  /** Catalog-item label for the field type (free_text / drop_down_menu / multi_select / date / user / null for section headers). */
  kind?: string;
  /** Numeric SAManage field type code (1, 2, 4, 5, 7, 8). Pass through alongside `kind`. */
  field_type?: number;
  /** Comma-/newline-separated allowed values for dropdown / multi_select kinds. */
  options?: string;
  /** "1" if required, "0" otherwise: preserved as string per SWSD's wire shape. */
  required?: string;
  /** Helper text shown to requesters in the SWSD portal: may contain HTML. */
  helptext?: string;
}

export interface CatalogItemSummary {
  id: number;
  name: string;
  state?: string;
  category?: string;
  subcategory?: string;
  department?: string;
  site?: string;
  /** Number of times this item has been requested across the tenant (read from `request_count`). */
  request_count?: number;
  /** ISO timestamp of last update. */
  updated_at?: string;
  /** Number of variables on this item (compact summary; full details via swsd_get_catalog_item). */
  variable_count?: number;
}

export type CatalogItemDetail = Record<string, unknown> & {
  id: number;
  name?: string;
  variables?: CatalogItemVariable[];
};
```

- [ ] **Step 3: Write the failing mapper test (TDD red)**

Create `tests/unit/mappers/catalogItem.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toCatalogItemSummary, toCatalogItemDetail } from '../../../src/swsd/mappers/catalogItem.js';

// Fixture mirrors the real shape captured by .research/v2/swsd-probes/.
// Notable: `category`/`subcategory`/`department`/`site` are nested objects with `name`;
// `request_count` is a number; `variables` is an array; `state` is "Approved"/"Internal"/"Draft".
const REAL_ITEM = {
  id: 2757496,
  url_id: '2757496-new-employee-onboarding-process',
  name: 'New Employee Onboarding Process ',
  description: '<p>HTML body</p>',
  price: null,
  currency: 'USD',
  show_price: false,
  state: 'Approved',
  portal_homepage: true,
  created_at: '2026-02-13T10:59:37.000-05:00',
  updated_at: '2026-03-12T11:52:26.000-04:00',
  image_href: 'https://api.samanage.com/catalog_item_images/abc',
  due_days: '7-10 Business Days',
  show_due_days: true,
  category: { id: 1, name: 'Employee Management' },
  subcategory: { id: 2, name: 'Onboarding' },
  department: null,
  site: null,
  tags: [],
  request_count: 42,
  custom: null,
  variables: [
    { id: 10999918, uuid: 10999918, name: 'New Employee First Name', kind: 'free_text', field_type: 1, options: null, required: '1', sorted: null, helptext: null },
    { id: 10999942, uuid: 10999942, name: 'New Employee Hardware Profile', kind: 'drop_down_menu', field_type: 2, options: 'None\nAdministrative\nCAD Designer', required: '1', sorted: true, helptext: '<p>...</p>' },
  ],
  variables_unparsed: 'unused-internal-field',
};

describe('toCatalogItemSummary', () => {
  it('projects compact summary from a real catalog-item response', () => {
    const s = toCatalogItemSummary(REAL_ITEM);
    expect(s).toEqual({
      id: 2757496,
      name: 'New Employee Onboarding Process ',
      state: 'Approved',
      category: 'Employee Management',
      subcategory: 'Onboarding',
      request_count: 42,
      updated_at: '2026-03-12T11:52:26.000-04:00',
      variable_count: 2,
      // department/site null → undefined (omitted)
    });
  });

  it('returns null for non-object inputs', () => {
    expect(toCatalogItemSummary(null)).toBeNull();
    expect(toCatalogItemSummary('not an object')).toBeNull();
    expect(toCatalogItemSummary([])).toBeNull();
  });

  it('returns null when id is missing', () => {
    expect(toCatalogItemSummary({ name: 'no id' })).toBeNull();
  });

  it('handles missing optional nested fields', () => {
    const s = toCatalogItemSummary({ id: 1, name: 'minimal' });
    expect(s).toEqual({ id: 1, name: 'minimal', variable_count: 0 });
    expect(s).not.toHaveProperty('category');
  });

  it('handles variables=null gracefully', () => {
    const s = toCatalogItemSummary({ id: 1, name: 'x', variables: null });
    expect(s?.variable_count).toBe(0);
  });
});

describe('toCatalogItemDetail', () => {
  it('returns the raw shape with id and a normalized variables array', () => {
    const d = toCatalogItemDetail(REAL_ITEM);
    expect(d?.id).toBe(2757496);
    expect(d?.name).toBe('New Employee Onboarding Process ');
    expect(d?.variables).toHaveLength(2);
    expect(d?.variables?.[0]).toEqual({
      id: 10999918,
      name: 'New Employee First Name',
      kind: 'free_text',
      field_type: 1,
      required: '1',
      // options/helptext null → omitted
    });
    expect(d?.variables?.[1]?.options).toBe('None\nAdministrative\nCAD Designer');
    expect(d?.variables?.[1]?.helptext).toBe('<p>...</p>');
    // Pass-through: detail keeps category/description/etc. on the top level for power users
    expect(d?.description).toBe('<p>HTML body</p>');
    expect(d?.category).toEqual({ id: 1, name: 'Employee Management' });
  });

  it('returns null when id is missing', () => {
    expect(toCatalogItemDetail({ name: 'no id' })).toBeNull();
  });

  it('strips variables_unparsed (verbose internal field, not useful to clients)', () => {
    const d = toCatalogItemDetail(REAL_ITEM);
    expect(d).not.toHaveProperty('variables_unparsed');
  });
});
```

- [ ] **Step 4: Run tests: confirm fail (TDD red)**

```bash
npx vitest run tests/unit/mappers/catalogItem.test.ts
```

Expected: all 8 tests fail (mapper not implemented yet).

- [ ] **Step 5: Implement `toCatalogItemSummary` + `toCatalogItemDetail`**

Create `src/swsd/mappers/catalogItem.ts`:

```ts
import type { CatalogItemSummary, CatalogItemDetail, CatalogItemVariable } from '../types.js';

export function toCatalogItemSummary(raw: unknown): CatalogItemSummary | null {
  if (!isPlainObject(raw)) return null;
  const id = numberOrNull(raw.id);
  if (id === null) return null;

  const variables = Array.isArray(raw.variables) ? raw.variables : [];
  return removeUndefined({
    id,
    name: stringOrEmpty(raw.name),
    state: stringOrUndefined(raw.state),
    category: pickNestedString(raw.category, 'name'),
    subcategory: pickNestedString(raw.subcategory, 'name'),
    department: pickNestedString(raw.department, 'name'),
    site: pickNestedString(raw.site, 'name'),
    request_count: numberOrUndefined(raw.request_count),
    updated_at: stringOrUndefined(raw.updated_at),
    variable_count: variables.length,
  });
}

export function toCatalogItemDetail(raw: unknown): CatalogItemDetail | null {
  if (!isPlainObject(raw)) return null;
  const id = numberOrNull(raw.id);
  if (id === null) return null;

  const { variables_unparsed: _strip, variables, ...rest } = raw as Record<string, unknown>;
  return {
    ...rest,
    id,
    variables: Array.isArray(variables)
      ? variables.map(toCatalogItemVariable).filter((v): v is CatalogItemVariable => v !== null)
      : [],
  };
}

function toCatalogItemVariable(raw: unknown): CatalogItemVariable | null {
  if (!isPlainObject(raw)) return null;
  const id = numberOrNull(raw.id);
  if (id === null) return null;
  return removeUndefined({
    id,
    name: stringOrEmpty(raw.name),
    kind: stringOrUndefined(raw.kind),
    field_type: numberOrUndefined(raw.field_type),
    options: stringOrUndefined(raw.options),
    required: stringOrUndefined(raw.required),
    helptext: stringOrUndefined(raw.helptext),
  });
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function numberOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
function numberOrUndefined(v: unknown): number | undefined {
  const n = numberOrNull(v);
  return n === null ? undefined : n;
}
function stringOrEmpty(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function stringOrUndefined(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function pickNestedString(v: unknown, key: string): string | undefined {
  if (!isPlainObject(v)) return undefined;
  const inner = v[key];
  return typeof inner === 'string' ? inner : undefined;
}
function removeUndefined<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) {
    if (o[k] === undefined) delete o[k];
  }
  return o;
}
```

- [ ] **Step 6: Run mapper tests: confirm pass (TDD green)**

```bash
npx vitest run tests/unit/mappers/catalogItem.test.ts
```

Expected: 8/8 pass.

- [ ] **Step 7: Define the input schema for `swsd_list_catalog_items`**

Create `src/schemas/catalogItem.ts`:

```ts
import { z } from 'zod';

const PAGE = z.number().int().min(1).default(1);
const PER_PAGE = z.number().int().min(1).max(100).default(25);

export const ListCatalogItemsInput = z.object({
  page: PAGE,
  per_page: PER_PAGE,
  /** Filter by state (e.g. "Approved": Approved is the production set). */
  state: z.string().optional(),
  /** Filter by department name (substring match, server-side). */
  department: z.string().optional(),
  /** Filter by site name. */
  site: z.string().optional(),
  /** Free-text search across catalog item names + descriptions (server-side via the standard `name` query param). */
  query: z.string().optional(),
});

export const GetCatalogItemInput = z.object({
  id: z.number().int(),
});
```

- [ ] **Step 8: Implement `swsd_list_catalog_items`**

Create `src/tools/catalog/listCatalogItems.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ListCatalogItemsInput } from '../../schemas/catalogItem.js';
import { PaginationWithScopeOutput } from '../../schemas/output.js';
import { structuredResult } from '../../mcp/output.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { toCatalogItemSummary } from '../../swsd/mappers/catalogItem.js';
import type { ToolContext } from '../../config/toolRegistry.js';

const CatalogItemSummaryOutput = z.object({
  id: z.number().int(),
  name: z.string(),
  state: z.string().optional(),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  department: z.string().optional(),
  site: z.string().optional(),
  request_count: z.number().int().optional(),
  updated_at: z.string().optional(),
  variable_count: z.number().int().optional(),
});

export function registerListCatalogItems(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_list_catalog_items',
    {
      description:
        'List catalog items available in SolarWinds Service Desk. Each item ' +
        'represents an offerable service request template (e.g., "New Employee ' +
        'Onboarding", "Software Request") with a defined set of input variables ' +
        '(form fields). Use swsd_get_catalog_item to inspect a single item\'s ' +
        'variables, then swsd_create_service_request to submit a request.',
      inputSchema: ListCatalogItemsInput.shape,
      outputSchema: z.object({
        items: z.array(CatalogItemSummaryOutput),
        pagination: PaginationWithScopeOutput,
        applied_filters: z.record(z.string(), z.unknown()),
      }).shape,
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    },
    async (input) => {
      try {
        const params: Record<string, unknown> = {
          page: input.page,
          per_page: input.per_page,
        };
        const applied: Record<string, unknown> = {};
        if (input.state) { params.state = input.state; applied.state = input.state; }
        if (input.department) { params.department = input.department; applied.department = input.department; }
        if (input.site) { params.site = input.site; applied.site = input.site; }
        if (input.query) { params.name = input.query; applied.query = input.query; }

        const { body, pagination } = await ctx.client.get<unknown>('/catalog_items.json', params);
        const raw = Array.isArray(body) ? body : [];
        const items = raw
          .map(toCatalogItemSummary)
          .filter((i): i is NonNullable<typeof i> => i !== null);

        const totalScope = Object.keys(applied).length > 0 ? 'filtered' : 'unfiltered';
        const totalNote = pagination.total !== undefined ? ` of ${String(pagination.total)}` : '';
        const summary = `Returned ${String(items.length)} catalog items${totalNote} (page ${String(pagination.page)}, ${totalScope}).`;
        return structuredResult({
          items,
          pagination: { ...pagination, total_scope: totalScope },
          applied_filters: applied,
        }, summary);
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
```

- [ ] **Step 9: Register the new tool**

Modify `src/config/toolRegistry.ts` to import + register `registerListCatalogItems` (follow the existing registration pattern for other tools). Then update `src/config/profiles.ts` to include `swsd_list_catalog_items` in the appropriate profiles (likely `read`, `full`, `triage`: match what `swsd_list_incidents` is in).

- [ ] **Step 10: Write the failing tool-level test**

Create `tests/unit/tools/listCatalogItems.test.ts`. Mock the SWSD client (look at existing tool tests like `tests/unit/tools/...` for the pattern: use a fake client object that returns a fixed `body` + `pagination`). Assert:
- Tool registers with the right name + annotations
- With no filters, `applied_filters` is empty and `total_scope` is `'unfiltered'`
- With `state: 'Approved'`, `applied_filters.state === 'Approved'` and `total_scope === 'filtered'`
- The `query` input maps to `name` query param (verify the underlying client.get was called with `{ name: <query> }`)

- [ ] **Step 11: Build, test sweep**

```bash
npm run build
npm test
```

Expected: all green. Test count goes from 373 to ~382 (8 new mapper + 4 new tool tests + 1 added by toolNames dynamic test = 13 net; subtract any overlap).

- [ ] **Step 12: Re-run e2e smoke**

```bash
node .research/v2/smoke-tests/mcp-e2e-smoke.mjs
```

Expected: still 14/14 (the smoke test doesn't yet probe the catalog endpoints: Task 3 adds that).

- [ ] **Step 13: Commit**

```bash
git add src/schemas/catalogItem.ts src/swsd/types.ts src/swsd/mappers/catalogItem.ts src/tools/catalog/listCatalogItems.ts src/config/toolRegistry.ts src/config/profiles.ts tests/unit/mappers/catalogItem.test.ts tests/unit/tools/listCatalogItems.test.ts
git commit -m "feat(catalog): add swsd_list_catalog_items + catalog-item mappers"
```

---

## Task 2: Get a single catalog item (read-only, exposes form schema)

**Goal:** Ship `swsd_get_catalog_item` so agents can inspect a catalog item's `variables` before submitting a request. The `variables` array IS the form schema: the agent (or downstream UI) needs it to know what fields to fill.

**Files:**
- Create: `src/tools/catalog/getCatalogItem.ts`
- Create: `tests/unit/tools/getCatalogItem.test.ts`
- Modify: `src/config/toolRegistry.ts`, `src/config/profiles.ts`

- [ ] **Step 1: Write the failing tool test**

Create `tests/unit/tools/getCatalogItem.test.ts`. Mock the client to return the same fixture shape from Task 1. Assert:
- Tool registers with name `swsd_get_catalog_item` + readOnly/idempotent annotations
- Input schema requires `id` (number, int)
- Structured output has `item` with `variables` array (length matches input fixture)
- Each variable has `id`, `name`, and one of `kind`/`field_type`

- [ ] **Step 2: Run to confirm fail**

- [ ] **Step 3: Implement `swsd_get_catalog_item`**

Create `src/tools/catalog/getCatalogItem.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { GetCatalogItemInput } from '../../schemas/catalogItem.js';
import { structuredResult } from '../../mcp/output.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { toCatalogItemDetail } from '../../swsd/mappers/catalogItem.js';
import type { ToolContext } from '../../config/toolRegistry.js';

const CatalogItemVariableOutput = z.object({
  id: z.number().int(),
  name: z.string(),
  kind: z.string().optional(),
  field_type: z.number().int().optional(),
  options: z.string().optional(),
  required: z.string().optional(),
  helptext: z.string().optional(),
});

export function registerGetCatalogItem(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_get_catalog_item',
    {
      description:
        'Get a single SWSD catalog item by id, including its `variables` ' +
        '(the form schema for service requests). Use the variables to know ' +
        'which fields to populate in swsd_create_service_request. Each ' +
        'variable has an `id` (pass to swsd_create_service_request as ' +
        '`custom_field_id`), a `name`, a `kind` (free_text / drop_down_menu ' +
        '/ multi_select / date / user / null), and `options` (newline-separated ' +
        'allowed values for dropdowns).',
      inputSchema: GetCatalogItemInput.shape,
      outputSchema: z.object({
        item: z.record(z.string(), z.unknown()).and(z.object({
          id: z.number().int(),
          variables: z.array(CatalogItemVariableOutput).optional(),
        })),
      }).shape,
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    },
    async (input) => {
      try {
        const path = `/catalog_items/${String(input.id)}.json`;
        const { body } = await ctx.client.get<unknown>(path, {});
        const item = toCatalogItemDetail(body);
        if (item === null) {
          throw new Error(`Catalog item ${String(input.id)} not found or returned an unexpected shape.`);
        }
        const name = typeof item.name === 'string' ? `"${item.name}"` : `id=${String(item.id)}`;
        const varCount = Array.isArray(item.variables) ? item.variables.length : 0;
        const summary = `Catalog item ${name}: ${String(varCount)} variables.`;
        return structuredResult({ item }, summary);
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
```

- [ ] **Step 4: Register in toolRegistry + profiles**

- [ ] **Step 5: Build + test sweep**

```bash
npm run build && npm test
```

- [ ] **Step 6: Commit**

```bash
git add src/tools/catalog/getCatalogItem.ts src/config/toolRegistry.ts src/config/profiles.ts tests/unit/tools/getCatalogItem.test.ts
git commit -m "feat(catalog): add swsd_get_catalog_item with variable form schema"
```

---

## Task 3: Create a service request (write: high-value, careful)

**Goal:** Ship `swsd_create_service_request`. This creates an incident with `is_service_request: true`, `catalog_item_id`, and a `request_variables` array mapping each catalog-variable's `id` to the user-supplied value. Optionally accepts custom_fields_values (per Plan C's nested-wrapper pattern).

**Files:**
- Create: `src/schemas/serviceRequest.ts`
- Create: `src/tools/catalog/createServiceRequest.ts`
- Create: `tests/unit/tools/createServiceRequest.test.ts`
- Modify: `src/config/toolRegistry.ts`, `src/config/profiles.ts`

- [x] **Step 1: Verify the wire shape with a live POST against a SAFE catalog item** -- DONE (2026-05-07)

**ACTUAL ACCEPTED SHAPE (verified live against the production tenant):**

- **Endpoint:** `POST /catalog_items/{catalog_item_id}/service_requests.json`
  - The flat `POST /incidents.json` endpoint from the plan's draft schema is wrong: SWSD silently drops `is_service_request`, `catalog_item_id`/`catalog_item`, and `request_variables` from that endpoint, creating a plain incident instead.
  - `POST /service_requests.json` returns 404 (no top-level resource).
- **Body wrapper:** `{ "incident": { ... } }` (not `{"service_request": {...}}`, which returns 422 with "Please enter subject" because SWSD doesn't recognize the wrapper).
- **Field name for variables:** `request_variables_attributes` (Rails-style nested-attributes assignment), NOT `request_variables`.
  - Sending the variables as `request_variables` (matching the read-shape field name) silently drops them: same with `variable_id`, `field_id`, `uuid`. Only `request_variables_attributes` persists.
- **Per-variable shape:** `{ custom_field_id: <catalog item variable id>, value: <string> }`.
- **Auto-populated from the catalog item:** `category`, `subcategory`, and `is_service_request: true`.
- **Server-overridden:** the SR's `name` on the response is the catalog item's name, not the `name` you sent in the body.
- **`requester` MUST be by email**: `requester: {id: <user_id>}` returns 422 "Please provide a registered requester to get updates". Use `requester: {email: ...}`. The default-to-JWT-user pattern therefore needs an extra `GET /users/{user_id}.json` call to resolve the email (mirrors `swsd_list_my_incidents`'s self-resolution).

**Canonical request:**

```json
POST /catalog_items/794451/service_requests.json
{
  "incident": {
    "name": "Data Recovery",
    "requester": { "email": "user@example.com" },
    "request_variables_attributes": [
      { "custom_field_id": 2181315, "value": "test_folder" },
      { "custom_field_id": 2181363, "value": "Z:\\test\\path" }
    ]
  }
}
```

**Canonical response excerpt** (full sample at `.research/v2/swsd-probes/created_service_request.json`):

```json
{
  "id": 181278194,
  "number": 60356,
  "name": "Data Recovery",
  "is_service_request": true,
  "category": { "id": 934345, "name": "File System" },
  "subcategory": { "id": 934350, "name": "Backup - Restore" },
  "request_variables": [
    {
      "id": 421911332,
      "custom_field_id": 2181315,
      "name": "File or Folder Name:",
      "value": "test_folder",
      "type": 6,
      "type_name": "Text_Area"
    }
  ]
}
```

**CONSEQUENCE FOR THE SCHEMA + TOOL:**

- The tool input still surfaces `catalog_item_id` and `request_variables` (the names users would expect from `swsd_get_catalog_item.variables`); the wire-shape translation happens in the tool handler.
- Plan B's `getUserIdFromJwtClaims` resolves the user_id, then the handler does a single `GET /users/{user_id}.json` to fetch the email (since `requester_id` isn't accepted on this endpoint).
- `is_service_request` is set automatically by the endpoint; we don't send it in the body.

**ORIGINAL PLAN NOTES (kept for reference):**

⚠️ **This step creates a real ticket in production.** Before implementing the schema, the implementer MUST verify the request body shape SWSD actually accepts. Use one of these strategies:

a) Pick a low-impact catalog item (e.g., one in `state: "Draft"` if the API allows it; or a "test" / "sandbox" item if the tenant has one).
b) Submit with the absolute minimum required fields per the spec, plus a body marker like `name: "API smoke-test from swsd-mcp v2 plan E - <timestamp> - delete me"`.
c) After the POST succeeds, GET the created incident, verify `is_service_request === true`, `request_variables` populated correctly, then close/delete it via the SWSD UI.
d) Capture the actual response shape into `.research/v2/swsd-probes/created_service_request.json` for the implementer to reference (gitignored).

Probe script template (`.research/v2/swsd-probes/post_test_request.py`):

```python
import json, os, urllib.request

token = os.environ['SWSD_TOKEN']
catalog_item_id = ???  # implementer fills in
my_user_id = ???       # from swsd_get_me

body = {
    'incident': {
        'name': f'API smoke-test from swsd-mcp v2 plan E - DELETE ME',
        'requester': {'id': my_user_id},
        'is_service_request': True,
        'catalog_item_id': catalog_item_id,
        'request_variables': [
            {'custom_field_id': ???, 'value': '???'},  # at least one required variable
        ],
    },
}

req = urllib.request.Request(
    'https://api.samanage.com/incidents.json',
    data=json.dumps(body).encode(),
    method='POST',
    headers={
        'X-Samanage-Authorization': f'Bearer {token}',
        'Accept': 'application/vnd.samanage.v2.1+json',
        'Content-Type': 'application/json',
    },
)
with urllib.request.urlopen(req, timeout=30) as r:
    data = json.load(r)
    json.dump(data, open('.research/v2/swsd-probes/created_service_request.json', 'w'), indent=2)
    print(f'Created: id={data["id"]}, number={data["number"]}, is_service_request={data["is_service_request"]}')
```

If the POST returns 400 with a useful error message, adapt the body shape until it succeeds. **Document the exact accepted shape in this plan file** (replacing the schema below if the live shape differs).

- [ ] **Step 2: Define the input schema based on Step 1's findings**

Create `src/schemas/serviceRequest.ts`:

```ts
import { z } from 'zod';
import { CustomFieldsValuesInput } from './customFieldWrite.js';

export const RequestVariableInput = z.object({
  /** The catalog item variable's `id` from swsd_get_catalog_item.variables[*].id */
  custom_field_id: z.number().int(),
  /** Stringified value matching the variable's `kind`. For dropdowns, use one of the `options` choices verbatim. */
  value: z.string(),
});

export const CreateServiceRequestInput = z.object({
  /** Title for the incident this service request creates. */
  name: z.string().min(1),
  /** Catalog item id from swsd_list_catalog_items. */
  catalog_item_id: z.number().int(),
  /** Form variable values; one entry per catalog variable being filled. */
  request_variables: z.array(RequestVariableInput).default([]),
  /** Optional: requester user_id. Defaults to the authenticated user (Plan B's getUserIdFromJwtClaims). */
  requester_id: z.number().int().optional(),
  /** Optional: free-text body added as the initial comment. */
  description: z.string().optional(),
  /** Optional: custom field values for SWSD-level (not catalog) custom fields. */
  custom_fields_values: CustomFieldsValuesInput.optional(),
});
```

- [ ] **Step 3: Write the failing tool test**

Create `tests/unit/tools/createServiceRequest.test.ts`. Mock the client to capture the POST body. Assert:
- Tool registers with name `swsd_create_service_request`, `readOnlyHint: false`, `destructiveHint: false` (creating IS a write but not destructive)
- Input schema requires `name` and `catalog_item_id`
- The POST is sent to `/incidents.json` with body shape `{incident: {name, catalog_item_id, is_service_request: true, request_variables: [{custom_field_id, value}], requester: {id}}}`
- When `requester_id` omitted, the tool uses `getUserIdFromJwtClaims(ctx.token)` (Plan B's helper)
- When `custom_fields_values` provided, body includes the nested-wrapper `{custom_fields_values: {custom_fields_value: [...]}}` (Plan C's pattern)

- [ ] **Step 4: Implement `swsd_create_service_request`**

Create `src/tools/catalog/createServiceRequest.ts`. Pattern: mirror `src/tools/incidents/createIncident.ts` (already on main from Plan C) but add the service-request-specific fields:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CreateServiceRequestInput } from '../../schemas/serviceRequest.js';
import { wrapCustomFieldsValues } from '../../schemas/customFieldWrite.js';
import { structuredResult } from '../../mcp/output.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { getUserIdFromJwtClaims, decodeJwtClaims } from '../../swsd/jwt.js';
import type { ToolContext } from '../../config/toolRegistry.js';

export function registerCreateServiceRequest(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_create_service_request',
    {
      description:
        'Submit a SWSD catalog request, creating an incident with ' +
        '`is_service_request: true` and the supplied form variables. ' +
        'Use swsd_list_catalog_items to find the right catalog_item_id ' +
        'and swsd_get_catalog_item to inspect its variables before filling. ' +
        'Each request_variables entry must have `custom_field_id` (from ' +
        'item.variables[*].id) and `value` (a string matching the variable\'s ' +
        'kind: for dropdowns, one of the `options`).',
      inputSchema: CreateServiceRequestInput.shape,
      outputSchema: z.object({
        incident: z.object({
          id: z.number().int(),
          number: z.number().int().optional(),
          name: z.string().optional(),
          is_service_request: z.boolean().optional(),
          state: z.string().optional(),
          url: z.string().optional(),
        }),
      }).shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
        idempotentHint: false,
      },
    },
    async (input) => {
      try {
        const requesterId = input.requester_id
          ?? getUserIdFromJwtClaims(decodeJwtClaims(ctx.token) ?? {});
        if (requesterId === null || requesterId === undefined) {
          throw new Error('Cannot determine requester user_id: provide `requester_id` or supply a token with a user_id/user_ic claim.');
        }
        const incident: Record<string, unknown> = {
          name: input.name,
          requester: { id: requesterId },
          is_service_request: true,
          catalog_item_id: input.catalog_item_id,
          request_variables: input.request_variables,
        };
        if (input.description) incident.description = input.description;
        if (input.custom_fields_values) {
          incident.custom_fields_values = wrapCustomFieldsValues(input.custom_fields_values);
        }
        const body = { incident };
        const { body: response } = await ctx.client.post<unknown>('/incidents.json', body);
        if (typeof response !== 'object' || response === null) {
          throw new Error('SWSD returned an unexpected response shape on POST /incidents.json');
        }
        const r = response as Record<string, unknown>;
        const id = typeof r.id === 'number' ? r.id : null;
        if (id === null) throw new Error('SWSD response missing numeric id on the created incident.');
        const summary = `Created service request #${String(r.number ?? id)} (id=${String(id)}, catalog_item_id=${String(input.catalog_item_id)}).`;
        return structuredResult({
          incident: {
            id,
            number: typeof r.number === 'number' ? r.number : undefined,
            name: typeof r.name === 'string' ? r.name : undefined,
            is_service_request: typeof r.is_service_request === 'boolean' ? r.is_service_request : undefined,
            state: typeof r.state === 'string' ? r.state : undefined,
            url: typeof r.href_account_domain === 'string' ? r.href_account_domain : undefined,
          },
        }, summary);
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
```

- [ ] **Step 5: Register in toolRegistry + profiles**

- [ ] **Step 6: Run test sweep**

```bash
npm run build && npm test
```

- [ ] **Step 7: (Optional but recommended) Live POST verification**

```bash
node -e "/* call swsd_create_service_request via the MCP server in stdio mode against a known-safe catalog item; verify the response */"
```

Or use the inspector:

```bash
npm run inspect:stdio
```

Submit a request to the safe catalog item from Step 1's probe. Verify the resulting incident has the right `is_service_request` flag and `request_variables` populated. **Close/delete the test ticket via the SWSD UI** afterward.

- [ ] **Step 8: Commit**

```bash
git add src/schemas/serviceRequest.ts src/tools/catalog/createServiceRequest.ts src/config/toolRegistry.ts src/config/profiles.ts tests/unit/tools/createServiceRequest.test.ts
git commit -m "feat(catalog): add swsd_create_service_request with request_variables write"
```

---

## Task 4: Polish: INSTRUCTIONS, docs, e2e Test 8

**Goal:** Surface the new catalog tools to agents (so they're chosen when the user wants to fulfill a request), document them, and extend the e2e smoke.

**Files:**
- Modify: `src/mcp/server.ts` (INSTRUCTIONS)
- Modify: `README.md`, `CHANGELOG.md`, `docs-site/src/content/docs/tools.md`
- Modify: `.research/v2/smoke-tests/mcp-e2e-smoke.mjs`

- [ ] **Step 1: Add INSTRUCTIONS guidance**

Modify `src/mcp/server.ts`: append to the INSTRUCTIONS array:

```ts
INSTRUCTIONS.push(
  'When the user asks to "request" something (e.g., new hardware, software access, ' +
  'an account, a file restore), prefer `swsd_list_catalog_items` first to find a ' +
  'matching catalog item, then `swsd_get_catalog_item` to inspect its required ' +
  'variables, then `swsd_create_service_request` to submit. Falling back to ' +
  '`swsd_create_incident` is correct only when no catalog item matches.',
);
```

(If `INSTRUCTIONS` is a `const readonly` array literal, prepend to its initialization instead. Read the file to see the current shape.)

- [ ] **Step 2: Extend e2e smoke test**

Edit `.research/v2/smoke-tests/mcp-e2e-smoke.mjs`: add Test 8 after the existing Test 7:

```js
// 8. swsd_list_catalog_items: verify catalog endpoint integration
console.log('\n=== Test 8: tools/call swsd_list_catalog_items ===');
const ciRes = await send('tools/call', {
  name: 'swsd_list_catalog_items',
  arguments: { per_page: 5 },
});
if (ciRes.result?.isError) {
  record('swsd_list_catalog_items succeeded', false, ciRes.result?.content?.[0]?.text);
} else {
  const ciStruct = ciRes.result?.structuredContent;
  record(
    'swsd_list_catalog_items returns items + pagination + applied_filters',
    Array.isArray(ciStruct?.items)
      && typeof ciStruct?.pagination?.page === 'number'
      && typeof ciStruct?.pagination?.total_scope === 'string'
      && ciStruct?.applied_filters !== undefined,
    `count=${ciStruct?.items?.length} total=${ciStruct?.pagination?.total} scope=${ciStruct?.pagination?.total_scope}`,
  );
}
```

Re-run the smoke:

```bash
npm run build && node .research/v2/smoke-tests/mcp-e2e-smoke.mjs
```

Expected: 14/14 + 1 new = 15/15 (or 14 if no items exist; either way the structural assertion passes).

- [ ] **Step 3: Update docs**

`README.md`: add a "Service Catalog tools" subsection under the existing tools section, listing the 3 new tools.

`CHANGELOG.md`: add an "Added" entry under unreleased v2:

```markdown
### Added
- Service catalog support: `swsd_list_catalog_items`, `swsd_get_catalog_item`, `swsd_create_service_request`. The list/get tools surface the catalog plus each item's variable schema; the create tool submits the request as an incident with `is_service_request: true`. Note: a `swsd_list_my_service_requests` wrapper is NOT yet shipped: SAManage's REST API has no documented filter param to narrow the incident collection by `is_service_request`. To be revisited in v2.5.
```

`docs-site/src/content/docs/tools.md`: add 3 rows for the new tools.

- [ ] **Step 4: Final test sweep**

```bash
npm run typecheck
npm test
npm run build
node .research/v2/smoke-tests/mcp-e2e-smoke.mjs
```

Expected:
- typecheck: clean
- test: ~395-410 passing (depending on coverage granularity)
- build: clean
- e2e: 15/15

- [ ] **Step 5: Commit + open PR**

```bash
git add src/mcp/server.ts README.md CHANGELOG.md docs-site/src/content/docs/tools.md
git commit -m "feat(catalog): finalize Service Catalog plan E: INSTRUCTIONS, docs, e2e"
git push -u origin <branch>
gh pr create --title "v2: Service Catalog support (3 new tools)" --body "..."
```

---

## Open questions (deferred to implementer or v2.5)

1. **Live wire shape for POST /incidents.json with is_service_request:** Task 3 Step 1 verifies. If the actual accepted body diverges from the plan's schema, update the schema and the createServiceRequest tool accordingly.

2. **`swsd_list_my_service_requests`:** explicitly DEFERRED to v2.5: no working server-side filter param. If a future SWSD docs update or SDK change exposes one, that's the trigger to add this tool.

3. **MCP Apps UI for the catalog tools:** out of scope for Plan E. A `swsd_get_catalog_item` UI rendering the variable form (with `kind`-aware widgets) would be a nice Tier 3 addition. Defer to Plan G or later.

4. **Catalog category browsing:** the `/catalog_categories.json` endpoint returns 404. If a future tenant or API version exposes it, consider adding `swsd_list_catalog_categories`. For now, agents can group catalog items client-side by the `category`/`subcategory` fields on each item.

---

## Self-review

Spec coverage:
- 3 new tools (list, get, create): ✓ Tasks 1, 2, 3.
- Plan B's applied_filters/total_scope pattern on the list tool: ✓ Task 1 Step 8.
- Plan C's nested-wrapper write idiom on the create tool: ✓ Task 3 Step 4.
- Plan B's `getUserIdFromJwtClaims` for default requester: ✓ Task 3 Step 4.
- Mapper unit tests with real-shape fixtures: ✓ Task 1 Step 3.
- Tool-level tests asserting POST body shape: ✓ Task 3 Step 3.
- e2e smoke extension: ✓ Task 4 Step 2.
- Docs (README + CHANGELOG + docs-site): ✓ Task 4 Step 3.
- INSTRUCTIONS guidance for tool selection: ✓ Task 4 Step 1.
- Strict additivity preserved: ✓ stated in Strict Additivity Contract; reviewed before each commit.

Placeholder scan: Task 3 Step 1 has deliberate `???` placeholders for `catalog_item_id`, `my_user_id`, and `custom_field_id`; the implementer fills them in based on the live tenant. Task 4 Step 1 also has a deliberate "see file for current shape" instruction for INSTRUCTIONS.

Type consistency:
- `CatalogItemSummary` field names match what the mapper produces.
- `CatalogItemDetail` is `Record<string, unknown> & {id, name?, variables?}`: pass-through with minimum guarantees.
- `CatalogItemVariable.id` (number) is what `swsd_create_service_request.input.request_variables[*].custom_field_id` consumes.
- `swsd_create_service_request`'s output `incident.is_service_request: boolean` matches what the API returns post-creation.

Estimated implementation time: 3-5 working days. Task 1 (~1.5 days due to mapper + first integration), Task 2 (~0.5 day), Task 3 (~2 days due to live POST verification + write-tool care), Task 4 (~0.5 day).
