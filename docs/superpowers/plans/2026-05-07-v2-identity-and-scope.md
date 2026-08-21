# swsd-mcp v2: Identity & Scope Implementation Plan (Plan B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the brief's two primary v2 failure modes: **identity** (the model can't tell who the authenticated user is) and **scope** (the model can't tell whether a 25-item response is "your queue of 25" or "tenant total of 56,000"). Adds `swsd_get_me` (whoami) and `swsd_list_my_incidents` (thin wrapper) tools, augments the server's MCP INSTRUCTIONS to teach the model the whoami-first pattern, and extends list responses with an `applied_filters` echo + `total_scope` discriminator that no comparable MCP server in the ecosystem ships today.

**Architecture:**
- Identity uses three complementary paths (most-durable to least): JWT payload decode (zero-cost, always works) → `GET /users/{user_ic}.json` (documented endpoint) → `GET /profile.json` (undocumented but live-verified, optional fallback for the few extra fields). All three flow into one `swsd_get_me` response.
- `swsd_list_my_incidents` is a thin wrapper that calls `swsd_get_me` (cached per-request) then `swsd_list_incidents` with `assignee_email = profile.email`. Same input shape minus the `assignee_email` parameter.
- `applied_filters` echo is added as a top-level field in the structured response of `swsd_list_incidents`; `total_scope` is a new field on the `pagination` block. Both are pure additions: non-breaking for existing callers.
- Server `INSTRUCTIONS` (in `src/mcp/server.ts`) gains a sentence teaching the model to call `swsd_get_me` first when a user request mentions "me/my/I". This is GitHub's canonical pattern for whoami discoverability (per Stream 4 research).

**Tech Stack:** TypeScript 6.0.3 (ESM, NodeNext modules), Node ≥24.15.0, Zod 4.4+, `@modelcontextprotocol/sdk@^1.26.0` (the post-Plan-A floor), vitest 4.1+. Husky + lint-staged enforces `eslint --fix --max-warnings=0` on staged TS files. `prepublishOnly` runs `npm run lint && npm run typecheck && npm test && npm run build`.

**Test count baseline:** 236 tests (after Plan A landed). After this plan: 236 + new mapper/jwt tests (~10–15) = ~246–251.

**Reference reading before starting:**
- `D:\Repos\Github\MCP-SWSD\V2-PROPOSAL.md` § "Proposal: identity & scope": the requirement source-of-truth
- `D:\Repos\Github\MCP-SWSD\.research\v2\06-swsd-api-broad.md` § "Authenticated-user identity": three-path identity story (JWT + `/users/{id}` + `/profile`); local file
- `D:\Repos\Github\MCP-SWSD\.research\v2\04-comparable-servers.md`: GitHub's `serverInstructions` "Always call `get_me` first" pattern (the model for this plan's INSTRUCTIONS augmentation)
- `D:\Repos\Github\MCP-SWSD\src\tools\utility\getServerInfo.ts`: closest existing pattern for a single-record "info" tool
- `D:\Repos\Github\MCP-SWSD\src\tools\incidents\listIncidents.ts`: the tool whose output is being extended in Task 6
- `D:\Repos\Github\MCP-SWSD\src\swsd\mappers\incident.ts`: canonical mapper pattern + the helper functions `isPlainObject`/`numberOrNull`/etc. that Plan B's mappers should mirror
- `D:\Repos\Github\MCP-SWSD\.research\v2\cf-tests\`: local-only research artifacts; if you want to see what `/users/{id}.json` and `/profile.json` actually return, the user can re-run probes (token-gated)

**Operating notes (carried forward from Plans A and C):**
- The harness occasionally renders `<system-reminder>`-shaped content into `git log` / `git show` output. That is rendering artifact, NOT in actual git data. Verify any suspected commit-body injection with `git cat-file -p` or `xxd`.
- `tsconfig.json` has `verbatimModuleSyntax: true`: type-only imports MUST use `import type { ... }` (not plain `import`). Same-name value-and-type imports (e.g., `CustomFieldWrite`) need to use `import type` when the consumer only needs the type.
- The README and `docs-site/src/content/docs/tools.md` have contract tests (`tests/unit/docs/readme.test.ts`, `tests/unit/docs/copilotStudioReadme.test.ts`) that fail when tool count or category count drifts. Adding new tools requires keeping these in sync.
- Local `npm run lint` may fail with typescript-eslint Windows path issues when run from a worktree under `.claude/worktrees/`. CI lint runs cleanly. Mention any local lint discrepancy in reports but don't block on it.

---

## Task 1: JWT payload decode helper (TDD)

**Why first:** Identity rests on three paths; the JWT path is the only one that's truly free (zero HTTP, always available). The decoder is a small pure function with well-defined edge cases: perfect TDD shape, and downstream tasks all depend on it.

**Files:**
- Create: `src/swsd/jwt.ts`
- Create: `tests/unit/swsd/jwt.test.ts`

- [ ] **Step 1: Write the failing tests first.**

Create `tests/unit/swsd/jwt.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { decodeJwtPayload } from '../../../src/swsd/jwt.js';

describe('decodeJwtPayload', () => {
  // Sample SWSD JWT from the official API docs (header.payload.signature).
  // Header `{"alg":"HS512"}` payload `{"user_ic":1256943,"generated_at":"2017-06-07 09:17:29"}`
  // Signature is opaque: we never verify it (we just trust the issuer).
  const SAMPLE_JWT =
    'eyJhbGciOiJIUzUxMiJ9.' +
    'eyJ1c2VyX2ljIjoxMjU2OTQzLCJnZW5lcmF0ZWRfYXQiOiIyMDE3LTA2LTA3IDA5OjE3OjI5In0.' +
    'j_H15qzJJr_signature_placeholder_';

  it('extracts user_ic and generated_at from a valid JWT', () => {
    const payload = decodeJwtPayload(SAMPLE_JWT);
    expect(payload).not.toBeNull();
    expect(payload?.user_ic).toBe(1256943);
    expect(payload?.generated_at).toBe('2017-06-07 09:17:29');
  });

  it('returns the full claims object so unknown claims (e.g. ESM service_provider_id) survive', () => {
    // Synthetic ESM-style payload with an extra claim
    const esmHeader = Buffer.from(JSON.stringify({ alg: 'HS512' })).toString('base64url');
    const esmPayload = Buffer.from(
      JSON.stringify({ user_ic: 42, generated_at: '2026-05-07 00:00:00', service_provider_id: 99 }),
    ).toString('base64url');
    const esmJwt = `${esmHeader}.${esmPayload}.signature`;

    const payload = decodeJwtPayload(esmJwt);
    expect(payload).not.toBeNull();
    expect(payload).toEqual({
      user_ic: 42,
      generated_at: '2026-05-07 00:00:00',
      service_provider_id: 99,
    });
  });

  it('returns null for a non-JWT string (no dots)', () => {
    expect(decodeJwtPayload('not-a-jwt')).toBeNull();
  });

  it('returns null for a string with wrong number of segments', () => {
    expect(decodeJwtPayload('only.two')).toBeNull();
    expect(decodeJwtPayload('a.b.c.d')).toBeNull();
  });

  it('returns null when the payload segment is invalid base64', () => {
    expect(decodeJwtPayload('header.!!!not-base64!!!.sig')).toBeNull();
  });

  it('returns null when the payload decodes to non-JSON', () => {
    const badPayload = Buffer.from('not json').toString('base64url');
    expect(decodeJwtPayload(`header.${badPayload}.sig`)).toBeNull();
  });

  it('returns null when the payload is JSON but not an object', () => {
    const arrayPayload = Buffer.from(JSON.stringify([1, 2, 3])).toString('base64url');
    expect(decodeJwtPayload(`header.${arrayPayload}.sig`)).toBeNull();
    const stringPayload = Buffer.from(JSON.stringify('hello')).toString('base64url');
    expect(decodeJwtPayload(`header.${stringPayload}.sig`)).toBeNull();
  });

  it('returns null for non-string inputs (defensive)', () => {
    expect(decodeJwtPayload(null as unknown as string)).toBeNull();
    expect(decodeJwtPayload(undefined as unknown as string)).toBeNull();
    expect(decodeJwtPayload('' as string)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests: verify they fail.**

Run: `npx vitest run tests/unit/swsd/jwt.test.ts`
Expected: ALL tests FAIL with module-not-found (`Cannot find module '../../../src/swsd/jwt.js'`).

- [ ] **Step 3: Implement the decoder.**

Create `src/swsd/jwt.ts`:

```ts
/**
 * Decode the payload (claims) of a JWT WITHOUT verifying the signature.
 *
 * SWSD tokens are HS512-signed JWTs issued by the user's tenant. We never
 * verify the signature locally; that's the upstream API's job. We just
 * read the claims to extract the authenticated user's id.
 *
 * Returns the parsed JSON object on success, or null on any failure
 * (malformed JWT, invalid base64, non-JSON payload, non-object payload).
 *
 * Common claims found in SWSD tokens:
 *   - user_ic: number: the authenticated user's numeric ID. NOTE the
 *     verbatim spelling "user_ic" (looks like a typo for "user_id" but
 *     the API docs ship it as-is).
 *   - generated_at: string: when the token was issued.
 *   - (ESM tenants may include additional claims like service_provider_id;
 *     we surface ALL claims so callers can use them.)
 */
export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  if (typeof jwt !== 'string' || jwt.length === 0) return null;
  const segments = jwt.split('.');
  if (segments.length !== 3) return null;
  const payloadSegment = segments[1];
  if (payloadSegment === undefined || payloadSegment.length === 0) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(payloadSegment, 'base64url').toString('utf-8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}
```

- [ ] **Step 4: Run the tests: verify they pass.**

Run: `npx vitest run tests/unit/swsd/jwt.test.ts`
Expected: ALL 8 tests PASS.

Then run `npm test` and confirm full suite at 244 (236 baseline + 8 new).

- [ ] **Step 5: Commit.**

```bash
git add src/swsd/jwt.ts tests/unit/swsd/jwt.test.ts
git commit -m "feat(jwt): add decodeJwtPayload helper for zero-cost user_ic extraction from SWSD tokens"
```

---

## Task 2: `UserMeRecord` type + `toUserMeRecord` mapper (TDD)

**Why:** `swsd_get_me` returns a structured user record. The mapper projects SWSD's `/users/{id}.json` response (and optionally `/profile.json`'s extra fields) into a stable shape. Following Plan A's pattern (mapper-first, TDD).

**Files:**
- Modify: `src/swsd/types.ts` (append `UserMeRecord` interface)
- Create: `src/swsd/mappers/me.ts`
- Create: `tests/unit/mappers/me.test.ts`

- [ ] **Step 1: Append `UserMeRecord` to `src/swsd/types.ts`.**

After the existing types (after `AuditSummary`), append:

```ts
export interface UserMeRecord {
  id: number;
  email?: string;
  name?: string;
  title?: string;
  /** Role name (e.g. "Administrator", "Requester"). */
  role?: string;
  /** Department name. */
  department?: string;
  /** Site name. */
  site?: string;
  /** Group IDs the user belongs to. Empty array if none. */
  group_ids: number[];
  /** Whether the user account is disabled. */
  disabled?: boolean;
  /** Whether the user is currently configured to receive incident assignments. */
  available_for_assignment?: boolean;
  /** ISO timestamp of the user's last login (only present from /profile.json). */
  last_login?: string;
}
```

- [ ] **Step 2: Write the failing tests first.**

Create `tests/unit/mappers/me.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toUserMeRecord } from '../../../src/swsd/mappers/me.js';

describe('toUserMeRecord', () => {
  it('projects from a full /users/{id}.json response', () => {
    const raw = {
      id: 11643235,
      email: 'agent@example.com',
      name: 'Alice Agent',
      title: 'Service Desk Technician',
      disabled: false,
      available_for_assignment: true,
      role: { id: 316753, name: 'Administrator', description: '...' },
      site: { id: 2, name: 'NYC' },
      department: { id: 3, name: 'IT' },
      group_ids: [12990074, 99],
    };
    expect(toUserMeRecord(raw)).toEqual({
      id: 11643235,
      email: 'agent@example.com',
      name: 'Alice Agent',
      title: 'Service Desk Technician',
      role: 'Administrator',
      department: 'IT',
      site: 'NYC',
      group_ids: [12990074, 99],
      disabled: false,
      available_for_assignment: true,
    });
  });

  it('augments from a /profile.json response (adds last_login)', () => {
    const usersResponse = { id: 1, email: 'a@b.com', name: 'A', group_ids: [] };
    const profileResponse = {
      id: 1,
      email: 'a@b.com',
      name: 'A',
      group_ids: [],
      last_login: '2026-05-06T22:27:54.000Z',
    };
    const merged = toUserMeRecord(usersResponse, profileResponse);
    expect(merged?.last_login).toBe('2026-05-06T22:27:54.000Z');
    expect(merged?.id).toBe(1);
  });

  it('returns null for non-object inputs', () => {
    expect(toUserMeRecord(null)).toBeNull();
    expect(toUserMeRecord(undefined)).toBeNull();
    expect(toUserMeRecord('hello')).toBeNull();
    expect(toUserMeRecord([1, 2])).toBeNull();
  });

  it('returns null when id is missing or non-numeric', () => {
    expect(toUserMeRecord({ email: 'no-id' })).toBeNull();
    expect(toUserMeRecord({ id: 'not-a-number', email: 'x' })).toBeNull();
  });

  it('emits empty group_ids array when missing', () => {
    const r = toUserMeRecord({ id: 1, email: 'x' });
    expect(r?.group_ids).toEqual([]);
  });

  it('filters non-numeric entries out of group_ids', () => {
    const r = toUserMeRecord({ id: 1, group_ids: [10, 'oops', 20, null, 30] });
    expect(r?.group_ids).toEqual([10, 20, 30]);
  });

  it('handles malformed nested fields gracefully', () => {
    const r = toUserMeRecord({
      id: 1,
      email: 'x@y.com',
      role: 'oops a string',
      site: 99,
      department: null,
    });
    expect(r?.role).toBeUndefined();
    expect(r?.site).toBeUndefined();
    expect(r?.department).toBeUndefined();
  });

  it('coerces stringified numeric id', () => {
    const r = toUserMeRecord({ id: '42', email: 'x' });
    expect(r?.id).toBe(42);
  });
});
```

- [ ] **Step 3: Run the tests: verify they fail.**

Run: `npx vitest run tests/unit/mappers/me.test.ts`
Expected: ALL tests FAIL with module-not-found.

- [ ] **Step 4: Implement the mapper.**

Create `src/swsd/mappers/me.ts`:

```ts
import type { UserMeRecord } from '../types.js';

/**
 * Project SWSD's `/users/{id}.json` response (and optionally `/profile.json`)
 * into a stable UserMeRecord. The /profile.json response adds last_login
 * (and a few other fields the schema doesn't currently surface).
 *
 * Returns null on malformed input (non-object, missing/non-numeric id).
 *
 * Note: filters non-numeric entries out of group_ids defensively. SWSD has
 * been observed to occasionally include null entries in array-of-int fields.
 */
export function toUserMeRecord(
  raw: unknown,
  profile?: unknown,
): UserMeRecord | null {
  if (!isPlainObject(raw)) return null;
  const id = numberOrNull(raw.id);
  if (id === null) return null;

  const groupIdsRaw = Array.isArray(raw.group_ids) ? raw.group_ids : [];
  const group_ids = groupIdsRaw
    .map((v) => numberOrNull(v))
    .filter((v): v is number => v !== null);

  const base: UserMeRecord = {
    id,
    email: stringOrUndefined(raw.email),
    name: stringOrUndefined(raw.name),
    title: stringOrUndefined(raw.title),
    role: nestedString(raw.role, 'name'),
    department: nestedString(raw.department, 'name'),
    site: nestedString(raw.site, 'name'),
    group_ids,
    disabled: typeof raw.disabled === 'boolean' ? raw.disabled : undefined,
    available_for_assignment:
      typeof raw.available_for_assignment === 'boolean'
        ? raw.available_for_assignment
        : undefined,
  };

  if (isPlainObject(profile)) {
    const lastLogin = stringOrUndefined(profile.last_login);
    if (lastLogin !== undefined) base.last_login = lastLogin;
  }

  return base;
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

function stringOrUndefined(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function nestedString(parent: unknown, key: string): string | undefined {
  if (!isPlainObject(parent)) return undefined;
  const v = parent[key];
  return typeof v === 'string' ? v : undefined;
}
```

- [ ] **Step 5: Run the tests: verify they pass.**

Run: `npx vitest run tests/unit/mappers/me.test.ts`
Expected: all 8 tests PASS.

Run `npm test`: confirm full count at 252 (244 from Task 1 + 8 new).

- [ ] **Step 6: Commit.**

```bash
git add src/swsd/types.ts src/swsd/mappers/me.ts tests/unit/mappers/me.test.ts
git commit -m "feat(me): add UserMeRecord type + toUserMeRecord mapper (TDD)"
```

---

## Task 3: `swsd_get_me` tool

**Why:** Closes the brief's identity gap. Combines JWT decode (Task 1) + `/users/{id}.json` fetch + optional `/profile.json` enrichment (Task 2 mapper) into a single tool the model can call.

**Files:**
- Create: `src/schemas/me.ts`
- Create: `src/tools/utility/getMe.ts`
- Modify: `src/config/profiles.ts` (add to `triage`, `agent`, `knowledge`, `full`: every profile benefits)
- Modify: `src/config/toolRegistry.ts` (import + REGISTRARS map entry)

- [ ] **Step 1: Create the input schema.**

Create `src/schemas/me.ts`:

```ts
import { z } from 'zod';

export const GetMeInput = z.object({});

export type GetMeInput = z.infer<typeof GetMeInput>;
```

(Empty object: `swsd_get_me` takes no input.)

- [ ] **Step 2: Create the tool registrar.**

Create `src/tools/utility/getMe.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { GetMeInput } from '../../schemas/me.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { decodeJwtPayload } from '../../swsd/jwt.js';
import { toUserMeRecord } from '../../swsd/mappers/me.js';
import type { ToolContext } from '../../config/toolRegistry.js';

export function registerGetMe(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_get_me',
    {
      description:
        "Get the SWSD user record for the token's owner: id, email, name, title, " +
        'role, department, site, group_ids, and assignment status. **Call this first** ' +
        'when the request mentions "me", "my", or "I" (e.g. "my tickets", "tickets ' +
        'in my group", "tickets assigned to me"), then pass the returned id/email to ' +
        'assignee_email or requester_email filters on swsd_list_incidents (or use ' +
        'swsd_list_my_incidents which does this in one call). Without this step, ' +
        '"my X" queries cannot be answered correctly.',
      inputSchema: GetMeInput.shape,
      outputSchema: z.object({
        user: z.object({
          id: z.number().int(),
          email: z.string().optional(),
          name: z.string().optional(),
          title: z.string().optional(),
          role: z.string().optional(),
          department: z.string().optional(),
          site: z.string().optional(),
          group_ids: z.array(z.number().int()),
          disabled: z.boolean().optional(),
          available_for_assignment: z.boolean().optional(),
          last_login: z.string().optional(),
        }),
        sources: z.array(z.string()).describe(
          'Which paths populated the response. "jwt" is always present (JWT decode is mandatory). "users-endpoint" is present when /users/{id}.json succeeded. "profile-fallback" is present when /profile.json succeeded (adds last_login).',
        ),
        jwt_claims: z.record(z.string(), z.unknown()).describe(
          'All claims found in the JWT payload. SWSD typically includes user_ic and generated_at; ESM tenants may include service_provider_id or similar.',
        ),
      }).shape,
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    },
    async () => {
      try {
        // Path A: JWT decode (zero-cost, always works if the token is well-formed).
        const claims = decodeJwtPayload(ctx.token);
        if (claims === null) {
          return toolError('Could not decode the SWSD JWT payload. The configured SWSD_TOKEN may be malformed.');
        }
        const userIc = claims.user_ic;
        if (typeof userIc !== 'number') {
          return toolError('JWT payload missing user_ic (numeric). The token may be from an unsupported issuer.');
        }

        const sources: string[] = ['jwt'];

        // Path B: /users/{id}.json: documented endpoint.
        let usersBody: unknown;
        try {
          const result = await ctx.client.get<unknown>(`/users/${String(userIc)}.json`);
          usersBody = result.body;
          sources.push('users-endpoint');
        } catch (err) {
          // Surface error rather than silently degrading: this is the documented path.
          return mapSwsdError(err);
        }

        // Path C: /profile.json: undocumented but live-verified fallback for the few extra fields.
        let profileBody: unknown = undefined;
        try {
          const result = await ctx.client.get<unknown>(`/profile.json`);
          profileBody = result.body;
          sources.push('profile-fallback');
        } catch {
          // Silent fail: /profile.json is undocumented and may go away. The
          // `users-endpoint` path already gives us the canonical record;
          // /profile.json only adds a few extras.
        }

        const user = toUserMeRecord(usersBody, profileBody);
        if (user === null) {
          return toolError(`Could not parse user record for id ${String(userIc)}.`);
        }

        const summary = `You are ${user.name ?? '(unknown name)'} <${user.email ?? '(no email)'}>` +
          (user.role !== undefined ? `, role ${user.role}` : '') +
          (user.group_ids.length > 0 ? `, in ${String(user.group_ids.length)} group${user.group_ids.length === 1 ? '' : 's'}` : '') +
          '.';
        return structuredResult({ user, sources, jwt_claims: claims }, summary);
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
```

**IMPORTANT:** The handler depends on `ctx.token` being available on `ToolContext`. v1's `ToolContext` does NOT currently expose the token (it's only used inside the client). You will need to extend `src/config/toolRegistry.ts`'s `ToolContext` interface to include `token: string` AND wire it through where the context is constructed. Refer to `src/transports/http.ts` and `src/transports/stdio.ts` to see where `registerTools` is called: both call sites construct the context with `client` + `env`; both need to also pass `token`.

If extending `ToolContext` raises typecheck issues elsewhere, that's a real bug surfaced by this change and should not be papered over as expected behavior.

- [ ] **Step 3: Wire into `toolRegistry.ts`.**

Open `src/config/toolRegistry.ts`:
- Add `token: string;` to the `ToolContext` interface.
- Add the import: `import { registerGetMe } from '../tools/utility/getMe.js';`
- Add to `REGISTRARS`: `swsd_get_me: registerGetMe,`

- [ ] **Step 4: Wire `token` through transports.**

In `src/transports/http.ts`, locate the line where `registerTools(server, { env, profile, client, enabledTools })` is called. Add `token,` to the context object (the token is already extracted earlier in the handler).

In `src/transports/stdio.ts`, locate the analogous `registerTools` call and add `token,` to the context. The token comes from `env.SWSD_TOKEN` in stdio mode.

- [ ] **Step 5: Add to all profiles.**

Open `src/config/profiles.ts`. Add `'swsd_get_me'` to `READ_BASE` (since whoami is needed for every workflow). All four profiles (`triage`, `agent`, `knowledge`, `full`) will inherit it.

- [ ] **Step 6: Typecheck + tests.**

Run: `npm run typecheck && npm test`
Expected: typecheck clean, 252 tests pass.

- [ ] **Step 7: Regenerate Copilot Studio Swagger files.**

Run: `npm run generate:swagger`
Expected: all four `copilot-studio/*.swagger.yaml` files updated with the new tool count (each profile gains 1).

- [ ] **Step 8: Update README + docs-site for tool count + new tool.**

Edit `README.md` and `docs-site/src/content/docs/tools.md`:
- Update the tool table header from "24 tools across 7 categories" to "25 tools across 7 categories" (or 8 if `swsd_get_me` deserves its own category: recommend adding it to **Utility** since `swsd_get_server_info` and `swsd_health_check` are also there).
- Add `swsd_get_me` to the Utility row in the README's table.
- Add `swsd_get_me` to docs-site/tools.md's Utility section.

Run: `npx vitest run tests/unit/docs/` to confirm doc-contract tests pass.

- [ ] **Step 9: Run full pre-publish gate.**

Run: `npm run prepublishOnly`
Expected: lint + typecheck + 252 tests + build all pass.

- [ ] **Step 10: Commit.**

```bash
git add src/schemas/me.ts src/tools/utility/getMe.ts \
        src/config/toolRegistry.ts src/config/profiles.ts \
        src/transports/http.ts src/transports/stdio.ts \
        copilot-studio/*.swagger.yaml \
        README.md docs-site/src/content/docs/tools.md
git commit -m "feat(me): add swsd_get_me tool: JWT decode + /users/{id}.json + optional /profile.json"
```

---

## Task 4: Server INSTRUCTIONS augmentation for whoami-first

**Why:** GitHub's `serverInstructions` "Always call get_me first" pattern (Stream 4) is more reliable than tool descriptions alone. The model gets the instruction in the `initialize` response.

**Files:**
- Modify: `src/mcp/server.ts`

- [ ] **Step 1: Read current INSTRUCTIONS.**

Open `src/mcp/server.ts`. Find the `INSTRUCTIONS` constant (currently 4 array elements after Plan C's update).

- [ ] **Step 2: Append a 5th element.**

Add after the existing `'For custom-field writes ...'` element:

```ts
  'For requests mentioning "me", "my", or "I" (e.g. "my tickets", "tickets in my group"), call swsd_get_me first to learn the authenticated user\'s id, email, and group memberships. Then pass those to assignee_email/requester_email filters on swsd_list_incidents (or use swsd_list_my_incidents which does this in one call). Without this step, "my X" queries cannot be answered correctly.',
```

(Single-quoted string literal; the embedded `\'` escapes the apostrophe in `user's`.)

- [ ] **Step 3: Typecheck + tests.**

Run: `npm run typecheck && npm test`
Expected: 252 tests pass.

- [ ] **Step 4: Commit.**

```bash
git add src/mcp/server.ts
git commit -m "docs(server): augment INSTRUCTIONS with whoami-first guidance for 'my X' queries"
```

---

## Task 5: `swsd_list_my_incidents` thin wrapper tool

**Why:** Stream 4's research showed Asana ships an explicit `get_my_tasks` and that's friendlier to weaker models than teaching them `assignee_email=<my-email>` syntax. One round-trip vs two.

**Files:**
- Create: `src/schemas/listMyIncidents.ts`
- Create: `src/tools/incidents/listMyIncidents.ts`
- Modify: `src/config/profiles.ts` (add to all profiles)
- Modify: `src/config/toolRegistry.ts` (registrar)
- Modify: `README.md` and `docs-site/src/content/docs/tools.md` (tool count → 26)

- [ ] **Step 1: Create the input schema.**

Create `src/schemas/listMyIncidents.ts`:

```ts
import { z } from 'zod';
import { ListIncidentsInput } from './incident.js';

/**
 * Input for swsd_list_my_incidents: same as ListIncidentsInput but without
 * `assignee_email` (the wrapper sets it from swsd_get_me automatically).
 *
 * Z's omit({ key: true }) is the canonical shape-removal in Zod v4.
 */
export const ListMyIncidentsInput = ListIncidentsInput.omit({
  assignee_email: true,
});

export type ListMyIncidentsInput = z.infer<typeof ListMyIncidentsInput>;
```

- [ ] **Step 2: Create the tool registrar.**

Create `src/tools/incidents/listMyIncidents.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ListMyIncidentsInput } from '../../schemas/listMyIncidents.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { toIncidentSummary } from '../../swsd/mappers/incident.js';
import { decodeJwtPayload } from '../../swsd/jwt.js';
import { toUserMeRecord } from '../../swsd/mappers/me.js';
import type { ToolContext } from '../../config/toolRegistry.js';

export function registerListMyIncidents(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_list_my_incidents',
    {
      description:
        'List incidents assigned to the authenticated user. Internally calls ' +
        'swsd_get_me to discover the user\'s email, then swsd_list_incidents ' +
        'with assignee_email=<your email>. Use this for first-person queries ' +
        '("my tickets", "tickets assigned to me"). Same input shape as ' +
        'swsd_list_incidents minus assignee_email (which is set automatically). ' +
        'For tenant-wide queries use swsd_list_incidents with explicit filters.',
      inputSchema: ListMyIncidentsInput.shape,
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    },
    async (input) => {
      try {
        // Step 1: Resolve the authenticated user's email via JWT + /users/{id}.
        const claims = decodeJwtPayload(ctx.token);
        if (claims === null || typeof claims.user_ic !== 'number') {
          return toolError('Could not decode SWSD JWT to identify the authenticated user.');
        }
        const usersResult = await ctx.client.get<unknown>(`/users/${String(claims.user_ic)}.json`);
        const me = toUserMeRecord(usersResult.body);
        if (me === null || me.email === undefined) {
          return toolError(`Could not resolve email for user_ic ${String(claims.user_ic)}.`);
        }

        // Step 2: Build /incidents.json query with assignee_email = me.email + the input filters.
        const params: Record<string, unknown> = {
          page: input.page,
          per_page: input.per_page,
          assignee_email: me.email,
        };
        if (input.states) params.state = input.states;
        if (input.priorities) params.priority = input.priorities;
        if (input.categories) params.category = input.categories;
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

        const { body, pagination } = await ctx.client.get<unknown>('/incidents.json', params);
        const raw = Array.isArray(body) ? body : [];
        const incidents = raw
          .map(toIncidentSummary)
          .filter((x): x is NonNullable<typeof x> => x !== null);

        const totalNote =
          pagination.total !== undefined ? ` of ${String(pagination.total)}` : '';
        const moreNote = pagination.has_more ? ', more available' : '';
        const summary =
          `Returned ${String(incidents.length)} incidents${totalNote} assigned to ${me.email} ` +
          `(page ${String(pagination.page)}${moreNote}).`;
        return structuredResult({ incidents, pagination, assignee_email: me.email }, summary);
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
```

- [ ] **Step 3: Register and add to profiles.**

In `src/config/toolRegistry.ts`:
- Add import: `import { registerListMyIncidents } from '../tools/incidents/listMyIncidents.js';`
- Add to REGISTRARS: `swsd_list_my_incidents: registerListMyIncidents,`

In `src/config/profiles.ts`:
- Add `'swsd_list_my_incidents'` to `READ_BASE` (so it appears in every profile that has read tools).

- [ ] **Step 4: Typecheck + tests.**

Run: `npm run typecheck && npm test`
Expected: 252 tests pass.

- [ ] **Step 5: Regenerate Swagger.**

Run: `npm run generate:swagger`

- [ ] **Step 6: Update README + docs-site.**

Tool count: 25 → 26. Add `swsd_list_my_incidents` to the Incidents row in README + docs-site Incidents section. Run `npx vitest run tests/unit/docs/` to confirm contract tests pass.

- [ ] **Step 7: Commit.**

```bash
git add src/schemas/listMyIncidents.ts src/tools/incidents/listMyIncidents.ts \
        src/config/toolRegistry.ts src/config/profiles.ts \
        copilot-studio/*.swagger.yaml \
        README.md docs-site/src/content/docs/tools.md
git commit -m "feat(incidents): add swsd_list_my_incidents thin wrapper: Asana-style explicit my-X tool"
```

---

## Task 6: `applied_filters` echo + `total_scope` discriminator on `swsd_list_incidents`

**Why:** This is the lane Stream 4 found NO production MCP server has filled (Linear, GitHub, Atlassian, Asana, ServiceNow, Notion, Slack, Stripe: none echo applied filters or distinguish filtered-vs-tenant totals). Solves the "25 of 25 vs 25 of 56,000" failure mode in-band. The model can finally say "you have 12 of 56,800 tenant incidents assigned to you (page 1, more available)" with confidence.

**Files:**
- Modify: `src/schemas/output.ts` (add `TotalScope` enum + `AppliedFiltersOutput` if shared)
- Modify: `src/tools/incidents/listIncidents.ts` (extend response)
- Optionally: same treatment for `swsd_list_my_incidents`, `swsd_search_solutions`, `swsd_list_incident_comments`, lookup list tools

- [ ] **Step 1: Add `TotalScope` enum to `src/schemas/output.ts`.**

Append to `src/schemas/output.ts`:

```ts
/**
 * total_scope discriminator on pagination blocks.
 * - "filtered": filters were applied AND SWSD returned X-Total-Count, so
 *   the total is the post-filter count.
 * - "tenant"  : no filters applied AND SWSD returned X-Total-Count, so
 *   the total is the tenant-wide count.
 * - "unknown" : SWSD did not return X-Total-Count.
 */
export const TotalScope = z.enum(['filtered', 'tenant', 'unknown']);

/**
 * Extended pagination output that includes total_scope.
 * Used on list tools where filter-vs-tenant total disambiguation matters.
 */
export const PaginationWithScopeOutput = PaginationOutput.extend({
  total_scope: TotalScope.describe(
    "Whether `total` reflects the filtered-set size, the tenant-wide size, or is unknown. " +
    "'filtered' = filter was applied AND total is present; 'tenant' = no filter AND total is present; 'unknown' = total absent.",
  ),
});
```

- [ ] **Step 2: Update `swsd_list_incidents`'s handler to compute and emit applied_filters + total_scope.**

In `src/tools/incidents/listIncidents.ts`, change the structuredResult-building section to:

```ts
        const { body, pagination } = await ctx.client.get<unknown>('/incidents.json', params);
        const raw = Array.isArray(body) ? body : [];
        const incidents = raw
          .map(toIncidentSummary)
          .filter((x): x is NonNullable<typeof x> => x !== null);

        // Echo the applied filters back for in-band scope reasoning.
        const applied_filters: Record<string, unknown> = {};
        if (input.states) applied_filters.states = input.states;
        if (input.priorities) applied_filters.priorities = input.priorities;
        if (input.categories) applied_filters.categories = input.categories;
        if (input.assignee_email) applied_filters.assignee_email = input.assignee_email;
        if (input.requester_email) applied_filters.requester_email = input.requester_email;
        if (input.updated_from) applied_filters.updated_from = input.updated_from;
        if (input.updated_to) applied_filters.updated_to = input.updated_to;
        if (input.created_from) applied_filters.created_from = input.created_from;
        if (input.created_to) applied_filters.created_to = input.created_to;
        if (input.sites) applied_filters.sites = input.sites;
        if (input.departments) applied_filters.departments = input.departments;
        if (input.assigned_to_group !== undefined) applied_filters.assigned_to_group = input.assigned_to_group;
        if (input.state_is_not) applied_filters.state_is_not = input.state_is_not;
        if (input.sort_by) applied_filters.sort_by = input.sort_by;
        if (input.sort_order) applied_filters.sort_order = input.sort_order;
        if (input.query) applied_filters.query = input.query;

        const hasAnyFilter = Object.keys(applied_filters).length > 0;
        const total_scope: 'filtered' | 'tenant' | 'unknown' =
          pagination.total === undefined
            ? 'unknown'
            : hasAnyFilter
              ? 'filtered'
              : 'tenant';

        const filterDescription =
          hasAnyFilter
            ? `matching your filters (${Object.entries(applied_filters)
                .slice(0, 3)
                .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : String(v)}`)
                .join(', ')}${Object.keys(applied_filters).length > 3 ? ', ...' : ''})`
            : 'tenant-wide';
        const totalNote =
          pagination.total !== undefined ? ` of ${String(pagination.total)}` : '';
        const moreNote = pagination.has_more ? ', more available' : '';
        const summary = `Returned ${String(incidents.length)}${totalNote} ${filterDescription} incidents (page ${String(pagination.page)}${moreNote}).`;

        return structuredResult(
          {
            incidents,
            pagination: { ...pagination, total_scope },
            applied_filters,
          },
          summary,
        );
```

- [ ] **Step 3: Update the outputSchema for `swsd_list_incidents` to declare the new shape.**

In the same file, replace the existing `outputSchema` declaration with:

```ts
      outputSchema: z.object({
        incidents: z.array(z.object({
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
        })),
        pagination: PaginationWithScopeOutput,
        applied_filters: z.record(z.string(), z.unknown()).describe(
          'Echo of the filters applied to this query: empty object if none. Use this to reason about whether the result count reflects your filters or the tenant total.',
        ),
      }).shape,
```

(Add the import `import { PaginationWithScopeOutput } from '../../schemas/output.js';`, or replace the existing `PaginationOutput` import with this one, then drop the unused import.)

- [ ] **Step 4: Same treatment for `swsd_list_my_incidents`.**

The `assignee_email` is set internally; emit it in `applied_filters` so the model can see it was applied. The structure mirrors above.

- [ ] **Step 5: Typecheck + tests.**

Run: `npm run typecheck && npm test`
Expected: 252 tests pass. The SDK validates that the structured response matches the declared output schema; if there's a shape mismatch surface, the test would fail.

- [ ] **Step 6: Commit.**

```bash
git add src/schemas/output.ts \
        src/tools/incidents/listIncidents.ts \
        src/tools/incidents/listMyIncidents.ts
git commit -m "feat(incidents): add applied_filters echo + total_scope discriminator (closes brief's scope-ambiguity failure mode)"
```

---

## Task 7: docs-site narrative for applied_filters/total_scope

**Why:** The new response-shape extensions are meaningful enough to warrant a brief narrative in the docs site, separate from the per-tool tool-list bullet.

**Files:**
- Modify: `docs-site/src/content/docs/tools.md`

- [ ] **Step 1:** Add a short callout near the Incidents section explaining `applied_filters` + `total_scope`. Match the existing voice. Example outline:

> :::note[v2 NOTE: list responses echo your filters]
> Every list-shaped response includes an `applied_filters` block (verbatim echo of the filters used) and a `pagination.total_scope` discriminator (`filtered` | `tenant` | `unknown`). Use these to reason about whether a 25-incident result is "page 1 of 87 matching your filters" vs. "page 1 of 56,800 tenant-wide" without guessing.
> :::

- [ ] **Step 2: Run doc tests.**

Run: `npx vitest run tests/unit/docs/`
Expected: all pass.

- [ ] **Step 3: Commit.**

```bash
git add docs-site/src/content/docs/tools.md
git commit -m "docs(docs-site): document applied_filters + total_scope on list responses"
```

---

## Task 8: Final verification + CHANGELOG + PR

- [ ] **Step 1: Run pre-publish gate.**

```bash
npm run prepublishOnly
```

Expected: lint + typecheck + tests + build all pass.

- [ ] **Step 2: Update CHANGELOG.**

Append to the `## [Unreleased]` block in `CHANGELOG.md`:

```markdown
### Added (Tier 1: v2 identity & scope)

- New tool `swsd_get_me`: JWT-payload decode + `GET /users/{id}.json` + optional `GET /profile.json` enrichment. Returns the authenticated user's id, email, name, role, department, site, group_ids, and assignment status. **Call this first when the request mentions "me", "my", or "I"**; server INSTRUCTIONS now teach the model this pattern.
- New tool `swsd_list_my_incidents`: thin wrapper that internally calls `swsd_get_me` then `swsd_list_incidents` with `assignee_email = your email`. Same input shape as `swsd_list_incidents` minus the `assignee_email` parameter. Asana-style explicit-my-X pattern (Stream 4 research).
- `applied_filters` echo + `pagination.total_scope` discriminator (`filtered` | `tenant` | `unknown`) on `swsd_list_incidents` and `swsd_list_my_incidents` responses. Closes the brief's scope-ambiguity failure mode in-band: the model can now distinguish "25 of 87 matching your filters" from "25 of 56,800 tenant-wide" without guessing. **No comparable MCP server in the ecosystem ships this** as of May 2026 (Linear, GitHub, Atlassian, Asana, ServiceNow, Notion, Slack, Stripe: verified during v2 research).
- Server `INSTRUCTIONS` augmented with whoami-first guidance: model receives this in the MCP `initialize` response, mirroring GitHub's `serverInstructions` "Always call get_me first" pattern.
- New JWT decoder helper (`src/swsd/jwt.ts`): extracts user_ic + any other JWT claims locally, no HTTP cost. Defensive parsing returns null on any malformed input.

### Tests (Tier 1: v2 identity & scope)

- New `tests/unit/swsd/jwt.test.ts`: 8 edge cases (sample SWSD JWT, ESM extra claims, invalid base64, non-JSON payload, non-object payload, defensive null/undefined inputs).
- New `tests/unit/mappers/me.test.ts`: 8 edge cases on `toUserMeRecord` (full record projection, /profile.json enrichment, defensive null handling, non-numeric id rejection, group_ids filtering of non-numeric entries).
```

- [ ] **Step 3: Commit CHANGELOG.**

```bash
git add CHANGELOG.md
git commit -m "docs: CHANGELOG entry for v2 Tier 1 identity & scope"
```

- [ ] **Step 4: Push.**

```bash
git push -u origin feat/v2-identity-and-scope
```

- [ ] **Step 5: Open PR.**

```bash
gh pr create --base main --title "v2 Tier 1: identity (swsd_get_me + list_my_incidents) + applied_filters/total_scope" --body "$(cat <<'EOF'
## Summary

Closes the brief's two primary v2 failure modes: identity and scope.

### Tools added

- **swsd_get_me (new)**: JWT decode + `GET /users/{id}.json` + optional `/profile.json` enrichment. Returns id, email, name, role, department, site, group_ids, assignment status.
- **swsd_list_my_incidents (new)**: thin wrapper: get_me → list_incidents with assignee_email. Asana-style explicit my-X tool.

### Response-shape extensions

- **`applied_filters` echo + `pagination.total_scope` discriminator** on list responses. Closes the brief's scope-ambiguity failure mode in-band. No comparable MCP server in the ecosystem ships this: verified across Linear, GitHub, Atlassian, Asana, ServiceNow, Notion, Slack, Stripe.

### Server INSTRUCTIONS

Augmented with whoami-first guidance: mirrors GitHub's `serverInstructions` "Always call get_me first" pattern.

### Implementation discipline

Plan-driven via `docs/superpowers/plans/2026-05-07-v2-identity-and-scope.md`. Each task TDD'd where applicable. Two-stage code review per task.

### Test deltas

236 → 252 baseline:
- +8 in `tests/unit/swsd/jwt.test.ts`
- +8 in `tests/unit/mappers/me.test.ts`

### Tool count delta

24 → 26 (added `swsd_get_me` + `swsd_list_my_incidents`, both in all profiles).

## Test plan
- [x] `npm run lint`: clean
- [x] `npm run typecheck`: zero errors
- [x] `npm test`: 252/252 pass
- [x] `npm run build`: clean
- [x] `npm run prepublishOnly`: full gate passes
- [ ] Manual smoke against live tenant: `swsd_get_me` returns the token's user; `swsd_list_my_incidents` returns assigned incidents; `swsd_list_incidents` response includes applied_filters echo (deferred to PR reviewer)

Closes Plan B in `V2-PROPOSAL.md`.
EOF
)"
```

---

## Self-review checklist (run after writing this plan)

**Spec coverage:**
- [x] swsd_get_me tool with JWT + /users/{id}.json + /profile.json (Tasks 1, 2, 3)
- [x] Server INSTRUCTIONS augmentation (Task 4)
- [x] swsd_list_my_incidents thin wrapper (Task 5)
- [x] applied_filters echo + total_scope discriminator (Task 6)
- [x] Documentation (Tasks 7, 8)
- [x] Final verification + CHANGELOG + PR (Task 8)

**Placeholder scan:** No "TBD" / "implement later" stubs. Every code block contains the actual code.

**Type consistency:** `UserMeRecord` defined in Task 2 is referenced by name in Task 3 (mapper import) and Task 5 (list_my_incidents handler). `decodeJwtPayload` from Task 1 is imported in Tasks 3 and 5. `PaginationWithScopeOutput` extends `PaginationOutput` (Plan A): no name conflicts.

**File paths consistent:** every `Files:` block lists exact paths. New tests mirror source structure.

**Cross-task consistency:** Task 3 introduces `ctx.token` on `ToolContext`; Tasks 5 and any future identity-aware tools depend on this. Task 6's outputSchema replacement of `PaginationOutput` with `PaginationWithScopeOutput` is local to the two list-incidents tools: other list tools keep using PaginationOutput unchanged. Task 4's INSTRUCTIONS string is the 5th array element, appended after Plan C's 4th.
