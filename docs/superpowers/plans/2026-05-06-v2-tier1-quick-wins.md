# swsd-mcp v2: Tier 1 Quick Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land 5 high-leverage low-cost improvements to swsd-mcp v1.0.1: `?layout=long` opt-in on detail tools, expanded list filters, a new `swsd_get_record_audits` tool, rate-limit info in `swsd_get_server_info`, plus retroactive cleanup (SDK floor bump for security backport, `outputSchema` declarations on read tools, tool-name format audit).

**Architecture:** Each task is an additive change to v1's existing surface: no breaking changes to tool inputs, no new transport behavior. The new audit tool follows v1's established pattern (zod schema → mapper → tool registration → profile inclusion → registry registration). Tests are vitest, focused on mappers and helpers (v1 has no tool-handler tests by convention; that pattern is preserved here). The Copilot Studio Swagger YAMLs are auto-generated from `PROFILE_TOOLS` and must be regenerated whenever a profile changes.

**Tech Stack:** TypeScript 6.0.3 (ESM, NodeNext modules), Node ≥24.15.0, Zod 4.4+, `@modelcontextprotocol/sdk@^1.26.0` (bumping floor from 1.29.0 exact pin), vitest 4.1+, Express 5.2+. Husky + lint-staged enforce `eslint --fix --max-warnings=0` on staged TS files. `prepublishOnly` runs `npm run lint && npm run typecheck && npm test && npm run build`.

**Reference reading before starting:**
- `D:\Repos\Github\MCP-SWSD\V2-PROPOSAL.md`: the proposal this plan implements (Tier 1 section)
- `D:\Repos\Github\MCP-SWSD\.research\v2\06-swsd-api-broad.md`: Stream 3 evidence for `?layout=long`, expanded filters, audits, rate limits
- `D:\Repos\Github\MCP-SWSD\src\schemas\incident.ts`: existing schema patterns
- `D:\Repos\Github\MCP-SWSD\src\tools\incidents\listIncidents.ts`: existing tool pattern
- `D:\Repos\Github\MCP-SWSD\tests\unit\mappers\incident.test.ts`: existing test pattern

---

## Task 1: Bump @modelcontextprotocol/sdk floor for GHSA-345p-7cg4-v4c7

**Why first:** picks up the cross-client response-leak security fix as a defense-in-depth signal to operators. v1 pinned `1.29.0` exactly; v2 should pin a range so renovate can take patches.

**Files:**
- Modify: `package.json` line 69 (the dependency declaration)

- [ ] **Step 1: Verify current SDK version**: confirm baseline before changing.

Run from repo root: `npm view @modelcontextprotocol/sdk version`
Expected output (one line): `1.29.0`

- [ ] **Step 2: Edit `package.json`**: change the SDK pin to a range.

Replace exactly:
```json
    "@modelcontextprotocol/sdk": "1.29.0",
```
with:
```json
    "@modelcontextprotocol/sdk": "^1.26.0",
```

(`^1.26.0` floors at the GHSA-345p-7cg4-v4c7 fix and lets renovate pull through `<2.0.0` patches; the `2.0.0-alpha` line is intentionally excluded by the caret semantics.)

- [ ] **Step 3: Reinstall + lock-file refresh.**

Run: `npm install`
Expected: `package-lock.json` updates. `npm ls @modelcontextprotocol/sdk` should show 1.29.0 (still the latest in the ^1.26.0 range).

- [ ] **Step 4: Verify build + tests still pass.**

Run: `npm run typecheck && npm test`
Expected: all 146 tests pass; no TypeScript errors.

- [ ] **Step 5: Commit.**

```bash
git add package.json package-lock.json
git commit -m "deps: relax @modelcontextprotocol/sdk to ^1.26.0 (picks up GHSA-345p-7cg4-v4c7 fix as defense-in-depth)"
```

---

## Task 2: Add `detail_level` parameter to `swsd_get_incident`

**Why:** SWSD's `?layout=long` adds 12 top-level fields including `comments[]`, `attachments[]`, `audits[]`, `statistics`, `tags`, `associated_sla_names`, `is_customer_satisfied`, `customer_satisfaction_response`, `request_variables`, `resolution`, `resolution_type`, `total_time_spent`: verified live on May 6, 2026 against incident 181197546. Today the model needs 2–3 round-trips to assemble this; with one parameter it's one call.

**Files:**
- Modify: `src/schemas/incident.ts` (extend `GetIncidentInput`)
- Modify: `src/tools/incidents/getIncident.ts` (pass layout param)

- [ ] **Step 1: Read the existing GetIncidentInput** to understand the current shape.

Open `D:\Repos\Github\MCP-SWSD\src\schemas\incident.ts` lines 47–53. Confirm `GetIncidentInput` is currently `{ id }` only.

- [ ] **Step 2: Extend `GetIncidentInput` with `detail_level`.**

In `src/schemas/incident.ts`, replace exactly:
```ts
export const GetIncidentInput = z.object({
  id: z
    .number()
    .int()
    .positive()
    .describe('SWSD incident ID (numeric).'),
});
```
with:
```ts
export const GetIncidentInput = z.object({
  id: z
    .number()
    .int()
    .positive()
    .describe('SWSD incident ID (numeric).'),
  detail_level: z
    .enum(['short', 'long'])
    .default('short')
    .describe(
      'Use "long" to include comments, attachments, audits, SLA data, tags, ' +
        'statistics, satisfaction, and resolution detail in one call. Default ' +
        '"short" is faster and cheaper. Recommend "long" when the user asks ' +
        '"show me everything about ticket X" or wants comments/attachments/audits.',
    ),
});
```

- [ ] **Step 3: Read the existing `getIncident.ts` handler.**

Open `D:\Repos\Github\MCP-SWSD\src\tools\incidents\getIncident.ts` (the full file, ~25 lines) to see how the current request is constructed.

- [ ] **Step 4: Wire `detail_level` into the SWSD GET call.**

In `src/tools/incidents/getIncident.ts`, locate the line that calls `ctx.client.get<unknown>(...)`. Replace the existing `client.get` call to include the layout query param when `detail_level === 'long'`.

The exact edit (replace the relevant snippet inside the handler):
```ts
        const params = input.detail_level === 'long' ? { layout: 'long' } : {};
        const { body } = await ctx.client.get<unknown>(
          `/incidents/${String(input.id)}.json`,
          params,
        );
```

(If the file's current call uses a different variable name for the path, adjust accordingly. The key change: add the second `params` argument.)

Also update the tool's `description` field in the same file to mention the new parameter:
- Before: existing description text
- After: append the sentence: `' Pass detail_level: "long" to include comments, attachments, audits, SLA data, and resolution in one call.'`

- [ ] **Step 5: Run typecheck + tests.**

Run: `npm run typecheck && npm test`
Expected: typecheck passes; all 146 existing tests pass (no test changes yet: the new parameter has a default so no caller breaks).

- [ ] **Step 6: Commit.**

```bash
git add src/schemas/incident.ts src/tools/incidents/getIncident.ts
git commit -m "feat(incidents): add detail_level=long to swsd_get_incident: folds layout=long fields (comments, attachments, audits, SLA, tags, satisfaction, resolution) into one call"
```

---

## Task 3: Add `detail_level` parameter to `swsd_get_solution`

**Why:** Same `?layout=long` mechanism applies to `/solutions/{id}` and brings in attachments + audits + tags. Mirrors Task 2.

**Files:**
- Modify: `src/schemas/solution.ts` (extend `GetSolutionInput`)
- Modify: `src/tools/solutions/getSolution.ts` (pass layout param)

- [ ] **Step 1: Extend `GetSolutionInput` with `detail_level`.**

In `src/schemas/solution.ts`, replace exactly:
```ts
export const GetSolutionInput = z.object({
  id: z
    .number()
    .int()
    .positive()
    .describe('SWSD solution ID (numeric).'),
});
```
with:
```ts
export const GetSolutionInput = z.object({
  id: z
    .number()
    .int()
    .positive()
    .describe('SWSD solution ID (numeric).'),
  detail_level: z
    .enum(['short', 'long'])
    .default('short')
    .describe(
      'Use "long" to include attachments, audits, tags, and full statistics ' +
        'in one call. Default "short" is faster.',
    ),
});
```

- [ ] **Step 2: Wire into the handler.**

In `src/tools/solutions/getSolution.ts`, replace the existing `client.get` invocation with one that passes the layout param:
```ts
        const params = input.detail_level === 'long' ? { layout: 'long' } : {};
        const { body } = await ctx.client.get<unknown>(
          `/solutions/${String(input.id)}.json`,
          params,
        );
```

Append to the tool's description: `' Pass detail_level: "long" to include attachments, audits, and tags in one call.'`

- [ ] **Step 3: Typecheck + tests.**

Run: `npm run typecheck && npm test`
Expected: all pass.

- [ ] **Step 4: Commit.**

```bash
git add src/schemas/solution.ts src/tools/solutions/getSolution.ts
git commit -m "feat(solutions): add detail_level=long to swsd_get_solution: same pattern as get_incident"
```

---

## Task 4: Expand list filters on `swsd_list_incidents`

**Why:** v1 exposes only state, priority, category, assignee_email, requester_email, updated_from. Stream 3 documents richer filters: `created_from`/`created_to`, `updated_to`, `sites[]`, `departments[]`, `assigned_to_group` (group ID), `state_is_not[]`, `sort_by`, `sort_order`, plus full-text `query=` (live-verified May 6 against the user's tenant: returned 200 with X-Total-Count=2680 for "test"). All forward-only: no breaking changes.

**Files:**
- Modify: `src/schemas/incident.ts` (extend `ListIncidentsInput`)
- Modify: `src/tools/incidents/listIncidents.ts` (forward new params to the SWSD GET)

- [ ] **Step 1: Extend `ListIncidentsInput`.**

In `src/schemas/incident.ts`, locate `ListIncidentsInput` (lines 3–45) and add the following fields between `updated_from` and the closing `})`:

```ts
  updated_to: z
    .string()
    .min(10)
    .optional()
    .describe('Filter to incidents updated on or before this ISO date or datetime. Pair with updated_from for an explicit range.'),
  created_from: z
    .string()
    .min(10)
    .optional()
    .describe('Filter to incidents created on or after this ISO date or datetime (YYYY-MM-DD or RFC 3339).'),
  created_to: z
    .string()
    .min(10)
    .optional()
    .describe('Filter to incidents created on or before this ISO date or datetime.'),
  sites: z
    .array(z.string().min(1))
    .optional()
    .describe('Filter to incidents at any of these site names (use swsd_list_sites to discover).'),
  departments: z
    .array(z.string().min(1))
    .optional()
    .describe('Filter to incidents in any of these department names.'),
  assigned_to_group: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Filter to incidents assigned to this group ID. Use swsd_list_groups to find the ID. NOTE: this is GROUP id, not user id.'),
  state_is_not: z
    .array(z.string().min(1))
    .optional()
    .describe('Negative state filter: exclude incidents in any of these states (e.g. ["Resolved", "Closed"] to see only open work).'),
  sort_by: z
    .enum(['created_at', 'updated_at', 'priority', 'name', 'due_at'])
    .optional()
    .describe('Sort key. Default is SWSD-side (typically updated_at desc).'),
  sort_order: z
    .enum(['ASC', 'DESC'])
    .optional()
    .describe('Sort direction. Use uppercase per SWSD convention.'),
  query: z
    .string()
    .min(1)
    .optional()
    .describe('Free-text search across incident title and description. Same async-indexing caveat as solution search: just-created tickets may not appear for a few minutes.'),
```

(Existing fields above `updated_from` stay unchanged.)

- [ ] **Step 2: Forward the new params in the handler.**

In `src/tools/incidents/listIncidents.ts`, locate the params assembly block (lines 22–32). Replace it with:

```ts
        const params: Record<string, unknown> = {
          page: input.page,
          per_page: input.per_page,
        };
        if (input.states) params.state = input.states;
        if (input.priorities) params.priority = input.priorities;
        if (input.categories) params.category = input.categories;
        if (input.assignee_email) params.assignee_email = input.assignee_email;
        if (input.requester_email) params.requester_email = input.requester_email;
        if (input.updated_from) params.updated_at = ['greater_than', input.updated_from];
        if (input.updated_to) params.updated_to = input.updated_to;
        if (input.created_from) params.created_from = input.created_from;
        if (input.created_to) params.created_to = input.created_to;
        if (input.sites) params.site = input.sites;
        if (input.departments) params.department = input.departments;
        if (input.assigned_to_group !== undefined) params.assigned_to = input.assigned_to_group;
        if (input.state_is_not) params.state_is_not = input.state_is_not;
        if (input.sort_by) params.sort_by = input.sort_by;
        if (input.sort_order) params.sort_order = input.sort_order;
        if (input.query) params.query = input.query;
```

- [ ] **Step 3: Typecheck + tests.**

Run: `npm run typecheck && npm test`
Expected: all pass. The new params have no required fields and are gated by `if (input.X)` so the existing test fixtures still work.

- [ ] **Step 4: Commit.**

```bash
git add src/schemas/incident.ts src/tools/incidents/listIncidents.ts
git commit -m "feat(incidents): expand list filters: sites, departments, assigned_to_group, created/updated ranges, sort, state_is_not, query"
```

---

## Task 5: Add `AuditSummary` type and mapper

**Why:** New `swsd_get_record_audits` tool needs a projection. Following v1's mapper-first pattern: define the type, write the mapper, test it thoroughly. The mapper is the part with logic worth testing (defensive parsing of unknown SWSD shapes); the tool is a thin wrapper.

**Files:**
- Modify: `src/swsd/types.ts` (add `AuditSummary`)
- Create: `src/swsd/mappers/audit.ts`
- Create: `tests/unit/mappers/audit.test.ts`

- [ ] **Step 1: Add `AuditSummary` to `src/swsd/types.ts`.**

Append to the bottom of `src/swsd/types.ts`:

```ts
export interface AuditSummary {
  id: number;
  /** Human-readable change description, e.g. "State changed from New to On Hold". */
  message: string;
  /** Action taken: typically "Update", "Create", or "Delete". */
  action?: string;
  created_at?: string;
  /** The user who performed the action (display name; user_id is separate). */
  user?: string;
  user_id?: number;
  /** Free-text note attached to the audit, often empty. */
  note?: string;
  /** Optional: source-record reference fields (helpful for global /audits queries). */
  source_type?: string;
  source_id?: number;
}
```

- [ ] **Step 2: Write the failing test first** (TDD).

Create `tests/unit/mappers/audit.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { toAuditSummary } from '../../../src/swsd/mappers/audit.js';

describe('toAuditSummary', () => {
  it('projects compact summary from a full SWSD audit response', () => {
    const raw = {
      id: 99887766,
      uuid: 'abc-123',
      action: 'Update',
      message: 'State changed from New to On Hold',
      note: '',
      created_at: '2026-05-06T12:34:56Z',
      user: 'Alice Agent',
      user_id: 11643235,
      source_type: 'Incident',
      source_id: 12345,
      department: { id: 1, name: 'IT' },
      site: { id: 2, name: 'NYC' },
    };
    const a = toAuditSummary(raw);
    expect(a).toEqual({
      id: 99887766,
      message: 'State changed from New to On Hold',
      action: 'Update',
      created_at: '2026-05-06T12:34:56Z',
      user: 'Alice Agent',
      user_id: 11643235,
      note: '',
      source_type: 'Incident',
      source_id: 12345,
    });
  });

  it('returns null for non-object inputs', () => {
    expect(toAuditSummary(null)).toBeNull();
    expect(toAuditSummary(undefined)).toBeNull();
    expect(toAuditSummary('not an object')).toBeNull();
    expect(toAuditSummary(42)).toBeNull();
    expect(toAuditSummary([1, 2, 3])).toBeNull();
  });

  it('returns null when id is missing or non-numeric', () => {
    expect(toAuditSummary({ message: 'no id' })).toBeNull();
    expect(toAuditSummary({ id: 'not-a-number', message: 'x' })).toBeNull();
  });

  it('coerces a stringified numeric id', () => {
    const a = toAuditSummary({ id: '42', message: 'x' });
    expect(a?.id).toBe(42);
  });

  it('does not leak verbose nested fields (department, site): those belong on the parent record', () => {
    const a = toAuditSummary({
      id: 1,
      message: 'x',
      department: { id: 1, name: 'IT' },
      site: { id: 2, name: 'NYC' },
    });
    expect(a).not.toHaveProperty('department');
    expect(a).not.toHaveProperty('site');
  });

  it('handles missing optional fields gracefully', () => {
    const a = toAuditSummary({ id: 1, message: 'x' });
    expect(a?.action).toBeUndefined();
    expect(a?.user).toBeUndefined();
    expect(a?.user_id).toBeUndefined();
    expect(a?.created_at).toBeUndefined();
    expect(a?.note).toBeUndefined();
    expect(a?.source_type).toBeUndefined();
    expect(a?.source_id).toBeUndefined();
  });

  it('preserves empty-string note (distinct from missing)', () => {
    const a = toAuditSummary({ id: 1, message: 'x', note: '' });
    expect(a?.note).toBe('');
  });

  it('requires message but emits empty string if missing rather than null', () => {
    const a = toAuditSummary({ id: 1 });
    expect(a).not.toBeNull();
    expect(a?.message).toBe('');
  });
});
```

- [ ] **Step 3: Run the test: verify it fails.**

Run: `npx vitest run tests/unit/mappers/audit.test.ts`
Expected: ALL tests FAIL (the mapper file doesn't exist yet: Vitest will report a module-not-found error).

- [ ] **Step 4: Implement the mapper.**

Create `src/swsd/mappers/audit.ts`:

```ts
import type { AuditSummary } from '../types.js';

/**
 * Project a raw SWSD audit entry into a compact summary.
 * Strips department/site nested fields: those belong on the parent record,
 * not on each audit. Preserves empty-string note as distinct from missing.
 */
export function toAuditSummary(raw: unknown): AuditSummary | null {
  if (!isPlainObject(raw)) return null;
  const id = numberOrNull(raw.id);
  if (id === null) return null;

  return {
    id,
    message: stringOrEmpty(raw.message),
    action: stringOrUndefined(raw.action),
    created_at: stringOrUndefined(raw.created_at),
    user: stringOrUndefined(raw.user),
    user_id: numberOrUndefined(raw.user_id),
    note: typeof raw.note === 'string' ? raw.note : undefined,
    source_type: stringOrUndefined(raw.source_type),
    source_id: numberOrUndefined(raw.source_id),
  };
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
```

- [ ] **Step 5: Run the test: verify it passes.**

Run: `npx vitest run tests/unit/mappers/audit.test.ts`
Expected: ALL 8 tests PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/swsd/types.ts src/swsd/mappers/audit.ts tests/unit/mappers/audit.test.ts
git commit -m "feat(audits): add AuditSummary type + toAuditSummary mapper with full edge-case coverage"
```

---

## Task 6: Add `swsd_get_record_audits` tool

**Why:** Stream 3-confirmed cheap, high-value: lets the model answer "who changed this ticket and when?" without parsing the full `?layout=long` response. Live-verified `/audits.json` returns 200 with rich entries.

**Files:**
- Create: `src/schemas/audit.ts`
- Create: `src/tools/audits/getRecordAudits.ts`
- Modify: `src/config/profiles.ts` (add to `agent` and `full` profiles)
- Modify: `src/config/toolRegistry.ts` (add registrar import + map entry)

- [ ] **Step 1: Create the input schema.**

Create `src/schemas/audit.ts`:

```ts
import { z } from 'zod';

export const GetRecordAuditsInput = z.object({
  object_type: z
    .enum([
      'incidents',
      'problems',
      'changes',
      'releases',
      'solutions',
      'hardwares',
      'other_assets',
    ])
    .describe(
      "The SWSD record type to fetch audits for. Use 'incidents' for tickets, " +
        "'solutions' for KB articles, etc.",
    ),
  id: z
    .number()
    .int()
    .positive()
    .describe('Numeric ID of the parent record.'),
  page: z
    .number()
    .int()
    .min(1)
    .max(10_000)
    .default(1)
    .describe('Page number (1-indexed).'),
  per_page: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(25)
    .describe('Audits per page (1-100). Older records may have hundreds of audit entries; default 25 is enough for "recent activity" reads.'),
});

export type GetRecordAuditsInput = z.infer<typeof GetRecordAuditsInput>;
```

- [ ] **Step 2: Create the tool registrar.**

Create `src/tools/audits/getRecordAudits.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GetRecordAuditsInput } from '../../schemas/audit.js';
import { structuredResult } from '../../mcp/output.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { toAuditSummary } from '../../swsd/mappers/audit.js';
import type { ToolContext } from '../../config/toolRegistry.js';

export function registerGetRecordAudits(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_get_record_audits',
    {
      description:
        'List the audit log for a SWSD record. Each audit entry captures one ' +
        'change: action ("Update"/"Create"/"Delete"), message ("State changed ' +
        'from New to Assigned"), the user who performed it, and the timestamp. ' +
        'Use this to answer "who changed this ticket?" or "what happened since ' +
        "I last looked?\". Cheaper than swsd_get_incident with detail_level=long " +
        'when you only need the audit history. object_type accepts incidents, ' +
        'problems, changes, releases, solutions, hardwares, other_assets.',
      inputSchema: GetRecordAuditsInput.shape,
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    },
    async (input) => {
      try {
        const params: Record<string, unknown> = {
          page: input.page,
          per_page: input.per_page,
        };
        const path = `/${input.object_type}/${String(input.id)}/audits.json`;
        const { body, pagination } = await ctx.client.get<unknown>(path, params);
        const raw = Array.isArray(body) ? body : [];
        const audits = raw
          .map(toAuditSummary)
          .filter((a): a is NonNullable<typeof a> => a !== null);

        const totalNote =
          pagination.total !== undefined ? ` of ${String(pagination.total)}` : '';
        const moreNote = pagination.has_more ? ', more available' : '';
        const summary = `Returned ${String(audits.length)} audits${totalNote} for ${input.object_type}/${String(input.id)} (page ${String(pagination.page)}${moreNote}).`;
        return structuredResult({ audits, pagination }, summary);
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
```

- [ ] **Step 3: Wire into `toolRegistry.ts`.**

Open `D:\Repos\Github\MCP-SWSD\src\config\toolRegistry.ts`. Add the import at the bottom of the import block (after the `registerDescribeCustomFields` import line):

```ts
import { registerGetRecordAudits } from '../tools/audits/getRecordAudits.js';
```

Then add to the `REGISTRARS` object (after the `swsd_describe_custom_fields` entry):

```ts
  swsd_get_record_audits: registerGetRecordAudits,
```

- [ ] **Step 4: Add to `agent` and `full` profiles.**

Open `D:\Repos\Github\MCP-SWSD\src\config\profiles.ts`. In the `agent` profile array, add `'swsd_get_record_audits',` after the `'swsd_describe_custom_fields',` entry. In the `full` profile array, add the same entry at an appropriate position (after `'swsd_describe_custom_fields',`).

Do NOT add to `triage` or `knowledge` profiles: first-line triage and KB-author workflows don't typically need audit-log access.

- [ ] **Step 5: Typecheck + lint + tests.**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass.

- [ ] **Step 6: Regenerate Copilot Studio Swagger files.**

Run: `npm run generate:swagger`
Expected: `copilot-studio/{agent,full}.swagger.yaml` updated with new tool count and (potentially) updated description text. The `triage` and `knowledge` files should be unchanged (those profiles don't include the new tool).

- [ ] **Step 7: Verify the swagger drift test still passes.**

Run: `npx vitest run tests/unit/copilotSwagger.test.ts`
Expected: all tests pass; no drift.

- [ ] **Step 8: Commit.**

```bash
git add src/schemas/audit.ts src/tools/audits/getRecordAudits.ts src/config/toolRegistry.ts src/config/profiles.ts copilot-studio/agent.swagger.yaml copilot-studio/full.swagger.yaml
git commit -m "feat(audits): add swsd_get_record_audits tool: wraps GET /{type}/{id}/audits.json with pagination"
```

---

## Task 7: Surface SWSD upstream rate limit in `swsd_get_server_info`

**Why:** SWSD documents 1000 calls/min on Advanced Plan, 1500 calls/min on Premier Plan, with no `X-RateLimit-*` headers: only 429 + `Retry-After`. Putting this in `swsd_get_server_info` saves the model from guessing.

**Files:**
- Modify: `src/tools/utility/getServerInfo.ts`

- [ ] **Step 1: Read the current `getServerInfo.ts` to understand its return shape.**

Open `D:\Repos\Github\MCP-SWSD\src\tools\utility\getServerInfo.ts`. The current `data` object has `name, version, profile, tools, base_url_host, api_version`.

- [ ] **Step 2: Add `upstream_rate_limit` to the data object.**

In `src/tools/utility/getServerInfo.ts`, locate the `data` object construction. Add a new field:

```ts
        upstream_rate_limit: {
          advanced_plan: '1000 calls/min (account-wide)',
          premier_plan: '1500 calls/min (account-wide)',
          signal: '429 + Retry-After only: SWSD does not return X-RateLimit-* headers',
          client_behavior: `auto-retry with exponential backoff (max attempts: ${String(ctx.env.SWSD_RETRY_MAX_ATTEMPTS)})`,
        },
```

(Place it after `api_version`, before the closing `};`.)

Also append to the tool description: `' Includes documented SWSD upstream rate limits (the model can reference these without guessing).'`

- [ ] **Step 3: Typecheck + tests.**

Run: `npm run typecheck && npm test`
Expected: all pass.

- [ ] **Step 4: Commit.**

```bash
git add src/tools/utility/getServerInfo.ts
git commit -m "feat(utility): surface SWSD upstream rate limit (1000/1500 cpm) in swsd_get_server_info"
```

---

## Task 8: Add `outputSchema` declarations on read tools

**Why:** The `outputSchema` field on `Tool` definitions (SDK 1.18+, formalized in spec 2025-11-25) lets clients (notably Copilot Studio) validate response shape. v1's `structuredResult` already returns stable shapes; declaring the matching `outputSchema` is ~50 LOC across all read tools and gives clients better error reporting when SWSD returns malformed data.

**Files:**
- Modify: `src/tools/incidents/getIncident.ts` (add outputSchema to registerTool)
- Modify: `src/tools/incidents/listIncidents.ts`
- Modify: `src/tools/solutions/getSolution.ts`
- Modify: `src/tools/solutions/searchSolutions.ts`
- Modify: `src/tools/comments/listIncidentComments.ts`
- Modify: `src/tools/lookups/listCategories.ts`
- Modify: `src/tools/lookups/listSites.ts`
- Modify: `src/tools/lookups/listDepartments.ts`
- Modify: `src/tools/lookups/listUsers.ts`
- Modify: `src/tools/lookups/listGroups.ts`
- Modify: `src/tools/lookups/listRoles.ts`
- Modify: `src/tools/customFields/describeCustomFields.ts`
- Modify: `src/tools/audits/getRecordAudits.ts` (the new one from Task 6)
- Modify: `src/tools/utility/getServerInfo.ts`
- Modify: `src/tools/utility/healthCheck.ts`
- Create: `src/schemas/output.ts` (centralized output schemas)

- [ ] **Step 1: Centralize the pagination output schema.**

Create `src/schemas/output.ts`:

```ts
import { z } from 'zod';

/**
 * Pagination block emitted on every list-shaped tool response.
 * Mirrors the runtime shape returned by extractPagination().
 */
export const PaginationOutput = z.object({
  page: z.number().int().describe('Current page (1-indexed).'),
  per_page: z.number().int().describe('Items per page used in the request.'),
  total: z.number().int().optional().describe('Total record count when SWSD returns X-Total-Count.'),
  has_more: z.boolean().describe('True when more pages exist beyond this one.'),
  next_page: z.number().int().optional().describe('The next page number to request, when has_more is true.'),
});
```

- [ ] **Step 2: Add `outputSchema` to `swsd_list_incidents`.**

Import the helpers at the top of `src/tools/incidents/listIncidents.ts`:

```ts
import { z } from 'zod';
import { PaginationOutput } from '../../schemas/output.js';
```

In the `registerTool` call, add an `outputSchema` field next to `inputSchema`:

```ts
      outputSchema: z.object({
        incidents: z.array(
          z.object({
            id: z.number().int(),
            number: z.number().int().optional(),
            name: z.string(),
            state: z.string().optional(),
            priority: z.string().optional(),
            assignee_email: z.string().optional(),
            requester_email: z.string().optional(),
            category: z.string().optional(),
            updated_at: z.string().optional(),
            url: z.string().optional(),
          }),
        ),
        pagination: PaginationOutput,
      }).shape,
```

(`.shape` to match the v1 input-schema convention.)

- [ ] **Step 3: Repeat for each read tool listed in the Files section above.**

For each, declare an `outputSchema` whose shape exactly matches what `structuredResult(data, summary)` is currently emitting. Use the existing types in `src/swsd/types.ts` as the source of truth: every output schema field should map to a `*Summary` type field.

For `swsd_get_incident` and `swsd_get_solution`, the output shape is `{ incident: Record<string, unknown> }` / `{ solution: Record<string, unknown> }`. Use:

```ts
      outputSchema: z.object({
        incident: z.record(z.string(), z.unknown()),
      }).shape,
```

(SWSD's detail-shape varies by tenant; declaring it as a record-of-unknown is honest and lets the client validate "an incident was returned" without locking down field-by-field shapes.)

For `swsd_get_record_audits`, the output is `{ audits: AuditSummary[], pagination }`:

```ts
      outputSchema: z.object({
        audits: z.array(
          z.object({
            id: z.number().int(),
            message: z.string(),
            action: z.string().optional(),
            created_at: z.string().optional(),
            user: z.string().optional(),
            user_id: z.number().int().optional(),
            note: z.string().optional(),
            source_type: z.string().optional(),
            source_id: z.number().int().optional(),
          }),
        ),
        pagination: PaginationOutput,
      }).shape,
```

For `swsd_get_server_info`, the output already includes the new `upstream_rate_limit` block from Task 7:

```ts
      outputSchema: z.object({
        name: z.string(),
        version: z.string(),
        profile: z.string(),
        tools: z.array(z.string()),
        base_url_host: z.string(),
        api_version: z.string(),
        upstream_rate_limit: z.object({
          advanced_plan: z.string(),
          premier_plan: z.string(),
          signal: z.string(),
          client_behavior: z.string(),
        }),
      }).shape,
```

For each lookup tool, mirror the existing `*Summary` shape from `src/swsd/types.ts`.

- [ ] **Step 4: Typecheck + tests.**

Run: `npm run typecheck && npm test`
Expected: all 146+ tests pass; no typecheck errors. The SDK validates that the structured response matches the declared output schema at runtime: if any tool's actual emit doesn't match the declared schema, that's a real bug surfaced by this change.

- [ ] **Step 5: Lint.**

Run: `npm run lint`
Expected: clean. Husky's pre-commit hook will also run `eslint --fix --max-warnings=0` on staged files.

- [ ] **Step 6: Commit.**

```bash
git add src/schemas/output.ts src/tools/
git commit -m "feat(tools): declare outputSchema on all read tools: enables client-side response validation (notably Copilot Studio)"
```

---

## Task 9: Audit tool names against SEP-986 format

**Why:** Spec 2025-11-25 standardized the tool-name regex `^[a-zA-Z][a-zA-Z0-9_-]{0,127}$`. v1's tool names (all `swsd_*` snake_case) appear compliant; verify and document.

**Files:**
- Modify: `tests/unit/copilotSwagger.test.ts` (add a tool-name regex assertion): alternative: a new dedicated test file

- [ ] **Step 1: Write a test that asserts every PROFILE_TOOLS name matches the regex.**

Create `tests/unit/toolNames.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PROFILE_TOOLS } from '../../src/config/profiles.js';

const SEP_986_TOOL_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,127}$/;

describe('tool names (SEP-986 spec 2025-11-25 compliance)', () => {
  const allNames = new Set<string>();
  for (const tools of Object.values(PROFILE_TOOLS)) {
    for (const t of tools) allNames.add(t);
  }

  for (const name of [...allNames].sort()) {
    it(`"${name}" matches SEP-986 format`, () => {
      expect(name).toMatch(SEP_986_TOOL_NAME_RE);
    });
  }

  it('has at least one tool registered (sanity check)', () => {
    expect(allNames.size).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test.**

Run: `npx vitest run tests/unit/toolNames.test.ts`
Expected: all tests PASS (every `swsd_*` name complies). If any future tool name violates SEP-986, the test will catch it before commit.

- [ ] **Step 3: Commit.**

```bash
git add tests/unit/toolNames.test.ts
git commit -m "test: assert all tool names match SEP-986 format (defense against future drift)"
```

---

## Task 10: Update README.md with new tools and parameters

**Why:** v1 has documentation contract tests (`tests/unit/docs/readme.test.ts`) that catch drift between the README's tool table and `PROFILE_TOOLS`. With the new `swsd_get_record_audits` tool and expanded parameters, the README needs a corresponding update.

**Files:**
- Modify: `README.md` (the tools table + the configuration section if needed)
- Modify: `docs-site/src/content/docs/tools.md` (the docs site equivalent)

- [ ] **Step 1: Read the current README tools table.**

Open `D:\Repos\Github\MCP-SWSD\README.md` and locate the Tools section (around lines 83–94).

- [ ] **Step 2: Add a new row to the table.**

In the Tools table, after the **Custom fields** row, add:

```markdown
| **Audits** | `swsd_get_record_audits` |
```

And update the table header from "23 across 6 categories" to "24 across 7 categories" (or whatever the new total is: recount based on `PROFILE_TOOLS.full`).

- [ ] **Step 3: Run the doc drift test.**

Run: `npx vitest run tests/unit/docs/readme.test.ts`
Expected: PASS (the README now matches `PROFILE_TOOLS.full`).

If the test FAILS, read the assertion to see what counts/names mismatch and fix the README accordingly.

- [ ] **Step 4: Update `docs-site/src/content/docs/tools.md`** with parallel changes (read it first to understand its structure, then add the audits section + the new optional parameters on `swsd_get_incident` / `swsd_get_solution` / `swsd_list_incidents`).

- [ ] **Step 5: Run all doc tests.**

Run: `npx vitest run tests/unit/docs/`
Expected: all pass.

- [ ] **Step 6: Commit.**

```bash
git add README.md docs-site/src/content/docs/tools.md
git commit -m "docs: add swsd_get_record_audits + new parameters (detail_level, expanded list filters) to README and docs site"
```

---

## Task 11: Final verification

**Why:** Ensure the cumulative changes pass the full pre-publish gate before opening a PR.

- [ ] **Step 1: Run the full test suite.**

Run: `npm test`
Expected: all tests pass. New tests for audit mapper (Task 5) and tool-name format (Task 9) are included.

- [ ] **Step 2: Run typecheck.**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 3: Run lint.**

Run: `npm run lint`
Expected: zero errors / warnings.

- [ ] **Step 4: Run build.**

Run: `npm run build`
Expected: `dist/` is regenerated cleanly.

- [ ] **Step 5: Run the pre-publish gate end-to-end.**

Run: `npm run prepublishOnly`
Expected: lint + typecheck + test + build all pass in sequence.

- [ ] **Step 6: Smoke test against live tenant** (manual, optional but recommended).

Set `SWSD_TOKEN` and `SWSD_BASE_URL` env vars, then:

```bash
node dist/cli.js --transport=stdio
```

Pipe a JSON-RPC `tools/call` for `swsd_get_record_audits` with `object_type=incidents, id=<some-real-id>` and confirm the response includes the audits array. Same for `swsd_get_incident` with `detail_level=long`.

- [ ] **Step 7: CHANGELOG entry.**

Edit `CHANGELOG.md`, add an `Unreleased → Added` block:

```markdown
## [Unreleased]

### Added (Tier 1: v2 quick wins)

- `detail_level` parameter on `swsd_get_incident` and `swsd_get_solution`: opt into SWSD's `?layout=long` to fold comments, attachments, audits, SLA data, tags, satisfaction, and resolution into one call. Replaces the previous 2–3 round-trip pattern.
- New `swsd_get_record_audits` tool: wraps `GET /{type}/{id}/audits.json` for incidents, problems, changes, releases, solutions, hardwares, other_assets. Lets the model answer "who changed this and when?" without parsing layout=long.
- Expanded `swsd_list_incidents` filters: `sites`, `departments`, `assigned_to_group`, `created_from`/`created_to`, `updated_to`, `state_is_not`, `sort_by`, `sort_order`, free-text `query`. All forward-only.
- `outputSchema` declared on all read tools for client-side response validation.
- `upstream_rate_limit` info on `swsd_get_server_info` (1000 cpm Advanced / 1500 cpm Premier; signal: 429 + Retry-After only).

### Changed

- `@modelcontextprotocol/sdk` floor relaxed from exact `1.29.0` to `^1.26.0`. Picks up `GHSA-345p-7cg4-v4c7` (cross-client response-leak) fix as defense-in-depth even though v1's per-request server construction was already safe.

### Tests

- New `tests/unit/mappers/audit.test.ts`: full edge-case coverage for `toAuditSummary`.
- New `tests/unit/toolNames.test.ts`: asserts SEP-986 compliance of every `PROFILE_TOOLS` entry.
```

- [ ] **Step 8: Commit CHANGELOG.**

```bash
git add CHANGELOG.md
git commit -m "docs: CHANGELOG entry for v2 Tier 1 quick wins"
```

- [ ] **Step 9: Open a PR.**

```bash
gh pr create --title "v2 Tier 1 quick wins: layout=long, expanded filters, audits tool, rate-limit info, outputSchema" --body "$(cat <<'EOF'
## Summary
- Add `detail_level=long` opt-in on `swsd_get_incident` / `swsd_get_solution` (folds comments+attachments+audits+SLA+tags+satisfaction+resolution into one call)
- Add `swsd_get_record_audits` tool
- Expand `swsd_list_incidents` filters (sites, departments, group, created/updated ranges, sort, state_is_not, query)
- Add `outputSchema` on all read tools
- Surface SWSD's documented rate limits in `swsd_get_server_info`
- Relax `@modelcontextprotocol/sdk` floor to `^1.26.0` (security backport)

## Test plan
- [x] `npm test`: all pass (146 + new tests)
- [x] `npm run typecheck`: zero errors
- [x] `npm run lint`: zero warnings
- [x] `npm run build`: clean
- [x] `npm run prepublishOnly`: full gate passes
- [ ] Manual smoke against live tenant: `swsd_get_record_audits` returns audit entries; `swsd_get_incident` with `detail_level=long` includes comments/attachments/audits

Closes the Tier 1 deliverables in the v2 proposal at `V2-PROPOSAL.md`.
EOF
)"
```

---

## Self-review checklist (run after writing this plan)

**Spec coverage:** Each Tier 1 item from `V2-PROPOSAL.md` is covered:
- [x] `?layout=long` on detail tools (Tasks 2, 3)
- [x] Expanded list filters (Task 4)
- [x] `swsd_get_record_audits` (Tasks 5, 6)
- [x] Rate-limit surfacing in `swsd_get_server_info` (Task 7)
- [x] SDK floor bump (Task 1)
- [x] `outputSchema` declarations (Task 8)
- [x] SEP-986 tool name audit (Task 9)
- [x] Documentation updates (Task 10)
- [x] Final verification + CHANGELOG (Task 11)

**Placeholder scan:** No "TBD", "implement later", "appropriate error handling" stubs. Every code block is the actual code to write.

**Type consistency:** `AuditSummary` defined in Task 5 is referenced by name in Task 6 (mapper import) and Task 8 (outputSchema). The `PaginationOutput` schema centralized in Task 8 is reused across all list tools. `GetRecordAuditsInput` from Task 6 is used by the registerTool inputSchema.

**File-path consistency:** every `Files:` block lists exact paths. Test files mirror source structure (`tests/unit/mappers/audit.test.ts` for `src/swsd/mappers/audit.ts`).
