# swsd-mcp v2: Custom-Field Writes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `custom_fields` parameter to `swsd_create_incident`, `swsd_update_incident`, `swsd_create_solution`, and `swsd_update_solution`, using the SAManage-confirmed nested-wrapper write shape (`{entity: {custom_fields_values: {custom_fields_value: [{name, value}]}}}`). Standardize on `name`-keyed entries for cross-entity portability. Retract v1's incorrect "writes don't work" claim from the `swsd_describe_custom_fields` description and CHANGELOG.

**Architecture:** Schema additions to 4 input types. Mapper extensions to `buildIncidentWritePayload` and `buildSolutionWritePayload`: both already exist; both have well-tested unit tests in v1; both follow the same "include only if defined" pattern. Tool description updates. Documentation/CHANGELOG correction. No new files except the test additions go inline in existing test files.

**Tech Stack:** TypeScript 6.0.3 (ESM, NodeNext modules), Node ≥24.15.0, Zod 4.4+, vitest 4.1+.

**Critical context (read before starting):**
- `D:\Repos\Github\MCP-SWSD\.research\v2\03-swsd-custom-field-writes.md`: full research findings, including live test transcripts and the discovered nested-wrapper shape. **The single most important reference for this plan.**
- `D:\Repos\Github\MCP-SWSD\.research\v2\cf-tests\`: actual JSON test transcripts from the live tenant (May 6, 2026): all 3 keying variants pass for incidents; only `name`-keyed works for solutions.
- v1 commit `06e9cf6`: the historical context: v1 tested 4 array-direct variants (all 500), reverted, and documented the limitation. **That documentation is now wrong; this plan retracts it.**

**Why the shape:** SWSD's API is Rails-XML-fossilized-into-JSON. Rails' default `to_xml` on `has_many :custom_fields_values` produces `<custom_fields_values type="array"><custom_fields_value>...</custom_fields_value></custom_fields_values>`: a singular-named child element under a plural-named parent. When JSON support was added, Samanage preserved the structure literally as a hash with a singular inner key. The v1 attempts at `custom_fields_values: [array]` (without the inner singular wrapper) hit Samanage's nested-attribute parser, which couldn't find the row attributes and 500'd.

**Why `name` keying universally:** Live tests show Incidents accept either `name`, `custom_field_id`, or both. Solutions accept ONLY `name` (the `custom_field_id`-only variant returns 400). Standardizing on `name` works across both entity types and any future entities (Hardware, etc.) the API supports the same way.

---

## Task 1: Define the `CustomFieldWrite` schema fragment (shared)

**Why:** Four input schemas need the same `custom_fields` field. Defining it once keeps descriptions consistent and changes localized.

**Files:**
- Create: `src/schemas/customFieldWrite.ts`

- [ ] **Step 1: Create the shared schema fragment.**

Create `src/schemas/customFieldWrite.ts`:

```ts
import { z } from 'zod';

/**
 * Reusable Zod schema for the `custom_fields` write parameter.
 *
 * Standardizes on `name` keying (case-sensitive). Live testing on May 6,
 * 2026 confirmed:
 *   - Incidents accept name-only, custom_field_id-only, or both.
 *   - Solutions accept ONLY name (custom_field_id alone returns 400).
 *   - Therefore `name` is the cross-entity portable key.
 *
 * The mapper layer (buildIncidentWritePayload / buildSolutionWritePayload)
 * wraps these into the SAManage-required nested shape:
 *   { custom_fields_values: { custom_fields_value: [{name, value}, ...] } }
 *
 * Field-type coverage validated: Text, Dropdown, Number, Checkbox, Date.
 * NOT yet validated: Multi_picklist, User-type, Date_and_Time (no Global-scope
 * examples in test tenant). Field-type coverage to be expanded if/when those
 * are tested live.
 */
export const CustomFieldWrite = z.object({
  name: z
    .string()
    .min(1)
    .describe(
      'Custom field name (case-sensitive, matches the field as displayed in the SWSD UI). ' +
        'Use swsd_describe_custom_fields first to discover the available field names ' +
        'and their types/allowed values.',
    ),
  value: z
    .union([z.string(), z.number(), z.boolean()])
    .describe(
      'Value to set. For Date use ISO 8601 ("YYYY-MM-DD"); SWSD echoes back as ' +
        '"Mon DD, YYYY" on read. For Dropdown use one of the values from the ' +
        'field schema. For Checkbox use "Yes" or "No". For Number pass a number.',
    ),
});

export const CustomFieldsArray = z
  .array(CustomFieldWrite)
  .optional()
  .describe(
    'Set tenant-specific custom field values on the record. ' +
      'Multi_picklist and User-type fields are not yet supported by this tool ' +
      '(set those via the SWSD UI). Validated for Text, Dropdown, Number, ' +
      'Checkbox, and Date types.',
  );

export type CustomFieldWrite = z.infer<typeof CustomFieldWrite>;
```

- [ ] **Step 2: Typecheck.**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit.**

```bash
git add src/schemas/customFieldWrite.ts
git commit -m "feat(custom-fields): add shared CustomFieldWrite schema for use in all write tools"
```

---

## Task 2: Extend `buildIncidentWritePayload` with `custom_fields` (TDD)

**Why:** This is the meat of the change: the mapper that constructs the payload SWSD requires. Tests come first per v1's mapper-test convention.

**Files:**
- Modify: `tests/unit/mappers/incident.test.ts` (add new test cases)
- Modify: `src/swsd/mappers/incident.ts` (extend `IncidentWriteFields` + `buildIncidentWritePayload`)

- [ ] **Step 1: Add failing tests first.**

In `tests/unit/mappers/incident.test.ts`, append the following new `it` blocks INSIDE the existing `describe('buildIncidentWritePayload', () => { ... })` block (just before its closing `});`):

```ts
  it('emits custom_fields under the SAManage nested wrapper (single field)', () => {
    const p = buildIncidentWritePayload({
      custom_fields: [{ name: 'Charge Number', value: 'CC-42' }],
    });
    expect(p).toEqual({
      incident: {
        custom_fields_values: {
          custom_fields_value: [{ name: 'Charge Number', value: 'CC-42' }],
        },
      },
    });
  });

  it('emits custom_fields with multiple rows in declared order', () => {
    const p = buildIncidentWritePayload({
      custom_fields: [
        { name: 'Charge Number', value: 'CC-42' },
        { name: 'Asset Purchase Type', value: 'Leased Asset' },
        { name: 'Lease Commencement Date', value: '2026-01-15' },
        { name: 'Qty On Hand', value: 42 },
        { name: 'Request', value: 'Yes' },
      ],
    });
    expect(p).toEqual({
      incident: {
        custom_fields_values: {
          custom_fields_value: [
            { name: 'Charge Number', value: 'CC-42' },
            { name: 'Asset Purchase Type', value: 'Leased Asset' },
            { name: 'Lease Commencement Date', value: '2026-01-15' },
            { name: 'Qty On Hand', value: 42 },
            { name: 'Request', value: 'Yes' },
          ],
        },
      },
    });
  });

  it('combines custom_fields with other fields under one incident wrapper', () => {
    const p = buildIncidentWritePayload({
      name: 'Test',
      priority: 'High',
      custom_fields: [{ name: 'Charge Number', value: 'CC-42' }],
    });
    expect(p).toEqual({
      incident: {
        name: 'Test',
        priority: 'High',
        custom_fields_values: {
          custom_fields_value: [{ name: 'Charge Number', value: 'CC-42' }],
        },
      },
    });
  });

  it('omits custom_fields_values entirely when custom_fields is undefined', () => {
    const p = buildIncidentWritePayload({ name: 'Test' });
    expect(p.incident).not.toHaveProperty('custom_fields_values');
  });

  it('omits custom_fields_values when custom_fields is empty array', () => {
    const p = buildIncidentWritePayload({ name: 'Test', custom_fields: [] });
    expect(p.incident).not.toHaveProperty('custom_fields_values');
  });

  it('preserves number and boolean value types (does not coerce to string)', () => {
    const p = buildIncidentWritePayload({
      custom_fields: [
        { name: 'Qty On Hand', value: 42 },
        { name: 'Verified', value: true },
      ],
    });
    expect(p.incident).toEqual({
      custom_fields_values: {
        custom_fields_value: [
          { name: 'Qty On Hand', value: 42 },
          { name: 'Verified', value: true },
        ],
      },
    });
  });
```

- [ ] **Step 2: Run the tests: verify they fail.**

Run: `npx vitest run tests/unit/mappers/incident.test.ts`
Expected: 6 NEW tests FAIL with messages about `custom_fields` not being a recognized field on `IncidentWriteFields`, OR returning a payload without `custom_fields_values`. The existing tests still pass.

- [ ] **Step 3: Extend the mapper to make the tests pass.**

In `src/swsd/mappers/incident.ts`, locate the `IncidentWriteFields` interface (lines 34–51). Add a `custom_fields` field at the end:

```ts
  /**
   * Tenant-specific custom field values. Each row is `{name, value}`.
   * The mapper wraps these into SAManage's nested-wrapper shape:
   *   custom_fields_values: { custom_fields_value: [{name, value}, ...] }
   * which is the Rails-XML-fossilized-into-JSON pattern Samanage requires.
   *
   * Standardize on name keying (works for both incidents and solutions; the
   * custom_field_id alternative is incidents-only).
   */
  custom_fields?: { name: string; value: string | number | boolean }[];
```

Then in `buildIncidentWritePayload` (function body, lines 60–72), append BEFORE the `return` line:

```ts
  if (fields.custom_fields !== undefined && fields.custom_fields.length > 0) {
    incident.custom_fields_values = {
      custom_fields_value: fields.custom_fields.map((cf) => ({
        name: cf.name,
        value: cf.value,
      })),
    };
  }
```

- [ ] **Step 4: Run the tests: verify they pass.**

Run: `npx vitest run tests/unit/mappers/incident.test.ts`
Expected: all tests PASS (existing + 6 new).

- [ ] **Step 5: Commit.**

```bash
git add src/swsd/mappers/incident.ts tests/unit/mappers/incident.test.ts
git commit -m "feat(incidents): support custom_fields in buildIncidentWritePayload: emits SAManage nested wrapper {custom_fields_values:{custom_fields_value:[...]}}"
```

---

## Task 3: Add `custom_fields` parameter to `CreateIncidentInput` + `UpdateIncidentInput` schemas

**Why:** Now that the mapper handles it, expose it on the tool inputs.

**Files:**
- Modify: `src/schemas/incident.ts` (extend two schemas)

- [ ] **Step 1: Import the shared schema.**

At the top of `src/schemas/incident.ts`, after the `import { z } from 'zod';` line, add:

```ts
import { CustomFieldsArray } from './customFieldWrite.js';
```

- [ ] **Step 2: Extend `CreateIncidentInput`.**

Locate `CreateIncidentInput` (lines 55–91). Add `custom_fields: CustomFieldsArray,` as the LAST field, just before the closing `});`:

```ts
  custom_fields: CustomFieldsArray,
```

- [ ] **Step 3: Extend `UpdateIncidentInput`.**

Locate `UpdateIncidentInput` (lines 93–105). Add the same line at the end (before the closing `});`):

```ts
  custom_fields: CustomFieldsArray,
```

- [ ] **Step 4: Typecheck + tests.**

Run: `npm run typecheck && npm test`
Expected: all pass. The Zod-inferred types now include `custom_fields?: { name: string; value: ... }[]`. Existing test fixtures don't set the field (it's optional) and continue to work.

- [ ] **Step 5: Commit.**

```bash
git add src/schemas/incident.ts
git commit -m "feat(incidents): expose custom_fields parameter on swsd_create_incident and swsd_update_incident schemas"
```

---

## Task 4: Update incident-write tool descriptions

**Why:** The model needs to know `custom_fields` is now available and how to use it. Tool descriptions are how the model learns capability.

**Files:**
- Modify: `src/tools/incidents/createIncident.ts`
- Modify: `src/tools/incidents/updateIncident.ts`

- [ ] **Step 1: Update `swsd_create_incident` description.**

In `src/tools/incidents/createIncident.ts`, locate the `description` field (currently a multi-line string). Append to the end of the description string (BEFORE the closing quote/backtick):

```
 To set tenant-specific custom field values, pass `custom_fields: [{name, value}]`: call swsd_describe_custom_fields first to discover field names and (for Dropdowns) allowed values. Validated for Text, Dropdown, Number, Checkbox, and Date types.
```

- [ ] **Step 2: Update `swsd_update_incident` description.**

Same change in `src/tools/incidents/updateIncident.ts`: append the same paragraph to the description.

- [ ] **Step 3: Typecheck + tests.**

Run: `npm run typecheck && npm test`
Expected: all pass.

- [ ] **Step 4: Commit.**

```bash
git add src/tools/incidents/createIncident.ts src/tools/incidents/updateIncident.ts
git commit -m "docs(incidents): announce custom_fields parameter availability in tool descriptions"
```

---

## Task 5: Extend `buildSolutionWritePayload` with `custom_fields` (TDD)

**Why:** Mirrors Task 2 for solutions. Same nested-wrapper shape; different entity wrapper (`solution` instead of `incident`).

**Files:**
- Modify: `tests/unit/mappers/solution.test.ts` (add new test cases)
- Modify: `src/swsd/mappers/solution.ts` (extend `SolutionWriteFields` + `buildSolutionWritePayload`)

- [ ] **Step 1: Add failing tests first.**

In `tests/unit/mappers/solution.test.ts`, locate the `describe('buildSolutionWritePayload', ...)` block (find it via grep if line numbers don't match). Append the following inside that describe block:

```ts
  it('emits custom_fields under the SAManage nested wrapper (single field)', () => {
    const p = buildSolutionWritePayload({
      custom_fields: [{ name: 'Charge Number', value: 'CC-42' }],
    });
    expect(p).toEqual({
      solution: {
        custom_fields_values: {
          custom_fields_value: [{ name: 'Charge Number', value: 'CC-42' }],
        },
      },
    });
  });

  it('emits custom_fields with multiple rows in declared order', () => {
    const p = buildSolutionWritePayload({
      custom_fields: [
        { name: 'Charge Number', value: 'CC-42' },
        { name: 'Lease Commencement Date', value: '2026-01-15' },
      ],
    });
    expect(p).toEqual({
      solution: {
        custom_fields_values: {
          custom_fields_value: [
            { name: 'Charge Number', value: 'CC-42' },
            { name: 'Lease Commencement Date', value: '2026-01-15' },
          ],
        },
      },
    });
  });

  it('combines custom_fields with other fields under one solution wrapper', () => {
    const p = buildSolutionWritePayload({
      name: 'How to reset a printer',
      state: 'Published',
      custom_fields: [{ name: 'Charge Number', value: 'CC-42' }],
    });
    expect(p).toEqual({
      solution: {
        name: 'How to reset a printer',
        state: 'Published',
        custom_fields_values: {
          custom_fields_value: [{ name: 'Charge Number', value: 'CC-42' }],
        },
      },
    });
  });

  it('omits custom_fields_values entirely when custom_fields is undefined', () => {
    const p = buildSolutionWritePayload({ name: 'x' });
    expect(p.solution).not.toHaveProperty('custom_fields_values');
  });

  it('omits custom_fields_values when custom_fields is empty array', () => {
    const p = buildSolutionWritePayload({ name: 'x', custom_fields: [] });
    expect(p.solution).not.toHaveProperty('custom_fields_values');
  });
```

If the existing test file does NOT already import `buildSolutionWritePayload`, add it to the imports at the top:

```ts
import {
  toSolutionSummary,
  toSolutionDetail,
  buildSolutionWritePayload,
} from '../../../src/swsd/mappers/solution.js';
```

- [ ] **Step 2: Run the tests: verify they fail.**

Run: `npx vitest run tests/unit/mappers/solution.test.ts`
Expected: 5 NEW tests FAIL.

- [ ] **Step 3: Extend the mapper.**

In `src/swsd/mappers/solution.ts`, locate the `SolutionWriteFields` interface (lines 35–40). Add a `custom_fields` field at the end:

```ts
  /**
   * Tenant-specific custom field values. Each row is `{name, value}`.
   * IMPORTANT: solutions REQUIRE name keying: the custom_field_id-only
   * variant returns 400 (verified live May 6, 2026). For incidents either
   * works; standardize on name for cross-entity portability.
   */
  custom_fields?: { name: string; value: string | number | boolean }[];
```

Then in `buildSolutionWritePayload` (lines 47–56), append BEFORE the `return` line:

```ts
  if (fields.custom_fields !== undefined && fields.custom_fields.length > 0) {
    solution.custom_fields_values = {
      custom_fields_value: fields.custom_fields.map((cf) => ({
        name: cf.name,
        value: cf.value,
      })),
    };
  }
```

- [ ] **Step 4: Run the tests: verify they pass.**

Run: `npx vitest run tests/unit/mappers/solution.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit.**

```bash
git add src/swsd/mappers/solution.ts tests/unit/mappers/solution.test.ts
git commit -m "feat(solutions): support custom_fields in buildSolutionWritePayload: same SAManage nested-wrapper shape as incidents"
```

---

## Task 6: Add `custom_fields` to `CreateSolutionInput` + `UpdateSolutionInput` schemas

**Why:** Mirrors Task 3 for solutions.

**Files:**
- Modify: `src/schemas/solution.ts`

- [ ] **Step 1: Import the shared schema.**

At the top of `src/schemas/solution.ts`, after the `import { z } from 'zod';` line, add:

```ts
import { CustomFieldsArray } from './customFieldWrite.js';
```

- [ ] **Step 2: Extend `CreateSolutionInput`.**

Locate `CreateSolutionInput` (lines 37–55). Append `custom_fields: CustomFieldsArray,` as the last field before the closing `});`.

- [ ] **Step 3: Extend `UpdateSolutionInput`.**

Locate `UpdateSolutionInput` (lines 57–67). Append the same line.

- [ ] **Step 4: Typecheck + tests.**

Run: `npm run typecheck && npm test`
Expected: all pass.

- [ ] **Step 5: Commit.**

```bash
git add src/schemas/solution.ts
git commit -m "feat(solutions): expose custom_fields parameter on swsd_create_solution and swsd_update_solution schemas"
```

---

## Task 7: Update solution-write tool descriptions

**Files:**
- Modify: `src/tools/solutions/createSolution.ts`
- Modify: `src/tools/solutions/updateSolution.ts`

- [ ] **Step 1: Update `swsd_create_solution` description.**

Append to the description (same pattern as Task 4):

```
 To set tenant-specific custom field values, pass `custom_fields: [{name, value}]`: call swsd_describe_custom_fields first to discover field names. Solutions require `name` keying (custom_field_id alone is rejected with HTTP 400). Validated for Text, Dropdown, Number, Checkbox, and Date types.
```

- [ ] **Step 2: Update `swsd_update_solution` description.**

Same change in `src/tools/solutions/updateSolution.ts`.

- [ ] **Step 3: Typecheck + tests.**

Run: `npm run typecheck && npm test`
Expected: all pass.

- [ ] **Step 4: Commit.**

```bash
git add src/tools/solutions/createSolution.ts src/tools/solutions/updateSolution.ts
git commit -m "docs(solutions): announce custom_fields parameter availability (with name-keying requirement note) in tool descriptions"
```

---

## Task 8: Retract the v1 limitation note from `swsd_describe_custom_fields`

**Why:** The v1 description says writing custom field values is not supported. That claim is now demonstrably wrong. Replace it with the correct guidance.

**Files:**
- Modify: `src/tools/customFields/describeCustomFields.ts`

- [ ] **Step 1: Read the current description.**

Open `D:\Repos\Github\MCP-SWSD\src\tools\customFields\describeCustomFields.ts`. The `description` field currently includes (around lines 21–25):

> NOTE: writing custom field values via the incident or solution write tools is not currently supported (SWSD returns 500 on every payload variant tested): set custom field values via the SWSD UI or service catalog forms for now.

- [ ] **Step 2: Replace the NOTE block.**

Replace the exact text:

```
NOTE: writing custom field values via the incident ' +
        'or solution write tools is not currently supported (SWSD returns 500 ' +
        'on every payload variant tested): set custom field values via the ' +
        'SWSD UI or service catalog forms for now.
```

with:

```
v2 NOTE: custom field WRITES are now supported via the `custom_fields` ' +
        'parameter on swsd_create_incident, swsd_update_incident, ' +
        'swsd_create_solution, and swsd_update_solution. Pass ' +
        '`custom_fields: [{name, value}]` (name-keyed for portability). ' +
        'Validated field types: Text, Dropdown, Number, Checkbox, Date. ' +
        'Multi_picklist and User-type writes are not yet supported: set ' +
        'those via the SWSD UI.
```

- [ ] **Step 3: Typecheck + tests.**

Run: `npm run typecheck && npm test`
Expected: all pass.

- [ ] **Step 4: Commit.**

```bash
git add src/tools/customFields/describeCustomFields.ts
git commit -m "docs(custom-fields): retract v1's incorrect 'writes not supported' claim: v2 supports custom_fields parameter on 4 write tools"
```

---

## Task 9: Final verification

**Why:** Full pre-publish gate before opening a PR.

- [ ] **Step 1: Run the full test suite.**

Run: `npm test`
Expected: all tests pass (existing 146 + 11 new from Tasks 2 and 5).

- [ ] **Step 2: Typecheck + lint + build.**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: zero errors, zero warnings, clean dist/.

- [ ] **Step 3: Run the pre-publish gate end-to-end.**

Run: `npm run prepublishOnly`
Expected: lint + typecheck + test + build all pass in sequence.

- [ ] **Step 4: Smoke test against live tenant** (manual, recommended).

With `SWSD_TOKEN` and `SWSD_BASE_URL` set, run the inspector:

```bash
npm run inspect:stdio
```

In the inspector, call `swsd_describe_custom_fields` to find a Text-type Global-scope field name. Then call `swsd_create_incident` with:

```json
{
  "name": "v2-cfw-smoke-test-DELETE-ME",
  "custom_fields": [
    { "name": "<the-field-name>", "value": "v2-smoke-001" }
  ]
}
```

Note the returned `id`. Then call `swsd_get_incident` with `detail_level: "long"` (assumes Plan A is also merged) on that id and confirm the custom field value persisted. Finally, manually clean up by deleting the test incident via the SWSD UI (v1 does not expose a delete tool).

- [ ] **Step 5: CHANGELOG entry.**

Append to `CHANGELOG.md` under `## [Unreleased]`:

```markdown
### Added (Tier 1: v2 custom-field writes)

- `custom_fields` parameter on `swsd_create_incident`, `swsd_update_incident`, `swsd_create_solution`, and `swsd_update_solution`. Accepts `[{name, value}]` rows. Name-keyed for cross-entity portability (Solutions reject `custom_field_id`-only keying with HTTP 400; Incidents accept either). Validated field types: Text, Dropdown, Number, Checkbox, Date.

### Fixed / Retracted

- The v0.5 documented limitation that "SWSD returns 500 on every payload variant tested" for custom-field writes was **incorrect**. v1's investigation tested only the array-direct shape `{custom_fields_values: [{name, value}]}`. The actual shape SWSD requires is the SAManage-documented nested wrapper `{custom_fields_values: {custom_fields_value: [{name, value}]}}`: confirmed live against the user's tenant on May 6, 2026 and against the official `SAManage/Samples` Ruby code. The `swsd_describe_custom_fields` tool description has been updated accordingly.
```

- [ ] **Step 6: Commit CHANGELOG.**

```bash
git add CHANGELOG.md
git commit -m "docs: CHANGELOG entry for v2 custom-field writes: retracts v0.5 documented limitation"
```

- [ ] **Step 7: Open a PR.**

```bash
gh pr create --title "v2: custom-field WRITES on 4 tools (retracts v1's documented limitation)" --body "$(cat <<'EOF'
## Summary
- Add `custom_fields: [{name, value}]` parameter on `swsd_create_incident`, `swsd_update_incident`, `swsd_create_solution`, `swsd_update_solution`
- Mapper layer wraps to SAManage's required nested shape: `{custom_fields_values: {custom_fields_value: [{name, value}]}}`
- Standardize on `name` keying (Solutions reject `custom_field_id`-only with 400; Incidents accept either)
- Retract v0.5's "writes don't work" claim from `swsd_describe_custom_fields` description and CHANGELOG

## Why this fix
v1's investigation (commit 06e9cf6) tested four variants of `{custom_fields_values: [array]}` and got 500s: concluded the API didn't support writes. Live testing on May 6, 2026 confirms the API DOES support writes; v1 just had the wrong envelope. The actual shape is the Rails-XML-fossilized-into-JSON nested wrapper used by Samanage's official sample scripts (https://github.com/SAManage/Samples/blob/master/Sync%20Users/sync_users.rb).

## Field-type coverage
Validated for Text, Dropdown, Number, Checkbox, Date. Multi_picklist and User-type are not yet validated (no Global-scope examples in the test tenant); documented in tool descriptions.

## Test plan
- [x] `npm test`: all pass (146 + 11 new mapper tests)
- [x] `npm run typecheck`: zero errors
- [x] `npm run lint`: zero warnings
- [x] `npm run build`: clean
- [x] `npm run prepublishOnly`: full gate passes
- [ ] Manual smoke test against live tenant: create incident with custom_fields, GET to verify persistence, manual cleanup

Closes the custom-field-writes deliverable in `V2-PROPOSAL.md`. Detailed research findings at `.research/v2/03-swsd-custom-field-writes.md` (gitignored).
EOF
)"
```

---

## Self-review checklist (run after writing this plan)

**Spec coverage:** Each item from V2-PROPOSAL.md "Custom-field writes" section is covered:
- [x] Add `custom_fields` to `CreateIncidentInput` (Task 3)
- [x] Add `custom_fields` to `UpdateIncidentInput` (Task 3)
- [x] Add `custom_fields` to `CreateSolutionInput` (Task 6)
- [x] Add `custom_fields` to `UpdateSolutionInput` (Task 6)
- [x] Extend `buildIncidentWritePayload` mapper (Task 2)
- [x] Extend `buildSolutionWritePayload` mapper (Task 5)
- [x] Update tool descriptions for the 4 write tools (Tasks 4, 7)
- [x] Update `swsd_describe_custom_fields` description (Task 8)
- [x] CHANGELOG retraction entry (Task 9)
- [x] TDD discipline on the mapper changes (Tasks 2, 5)
- [x] Final verification including manual smoke test (Task 9)

**Placeholder scan:** No "TBD" / "implement later" / "appropriate handling" stubs. Every code block is concrete.

**Type consistency:** `CustomFieldWrite` and `CustomFieldsArray` defined in Task 1 are imported in Tasks 3 and 6. The mapper field shape `{name, value}` matches the Zod schema field names exactly. Both `IncidentWriteFields.custom_fields` (Task 2) and `SolutionWriteFields.custom_fields` (Task 5) use the same `{name, value}` shape: symmetric across entities.

**Cross-plan consistency:** This plan is independent of Plan A (`2026-05-06-v2-tier1-quick-wins.md`). They touch overlapping files (`src/schemas/incident.ts`, `src/schemas/solution.ts`) but in different additive ways: there are no merge conflicts as long as both plans use unique field names (Plan A adds `detail_level`, `created_from`, `sites`, etc.; Plan C adds `custom_fields`). Recommended merge order: either plan can land first; the second will rebase cleanly.
