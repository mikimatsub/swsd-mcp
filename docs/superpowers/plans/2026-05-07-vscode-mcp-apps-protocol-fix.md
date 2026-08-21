# MCP Apps Protocol Fix (Plan G): Investigation + Implementation Plan

> **Status: investigation complete; not yet implemented.** Author and reviewer should ratify the recommended option before code changes start.

## TL;DR / verdict

**The "VS Code is strict MCP Apps; widgets use legacy mcp-ui shape" hypothesis is partially right and partially wrong.**

Right:
- VS Code Copilot Chat MCP Apps is strict spec-compliant. Non-JSON-RPC postMessage frames are silently dropped at the transport layer.
- Our widgets do not speak the MCP Apps JSON-RPC protocol. The host sends `ui/notifications/tool-result`; our widgets never see it.

Wrong:
- Our widgets do **not** use the legacy `ui-lifecycle-iframe-render-data` shape from `idosal/mcp-ui`. They use a **hand-rolled `{type:'init'}/{type:'ready'}` shape that we invented in `src/ui/shared/host.ts` and which appears nowhere in any official protocol: not MCP Apps, not mcp-ui legacy.

**Root cause:** the widget HTML built in Plan D Task 2 hand-rolled a postMessage protocol on the bet that "the host posts `init` to the iframe and we post `ready` back." That bet pre-dated reading `@modelcontextprotocol/ext-apps@1.7.1`'s view-side `App` class. The `App` class is the canonical View-side helper; we never used it. We did use the SDK's `registerAppTool` / `registerAppResource` correctly on the server side, which is why the iframe shells load: VS Code sees the `_meta.ui.resourceUri` advertisement, fetches the resource via `resources/read`, and mounts the iframe. Then it sends `ui/notifications/tool-input` + `ui/notifications/tool-result` JSON-RPC notifications over postMessage, our widgets ignore them (the shape doesn't match `e.data?.type === 'init'`), and the widgets remain in their initial empty state forever.

**Recommended fix:** replace the hand-rolled `onHostInit` helper with the `App` class from `@modelcontextprotocol/ext-apps`. Single PR, ~5 files touched, no new dependency (the package is already pinned at `^1.7.1`). Estimated effort: half a day.

**One thing the user should verify before we ship the fix:** "renders perfectly in Claude Desktop" may be a measurement artifact. The widgets' initial DOM looks like a working empty state (`<p class="loading">Loading incident…</p>`, `<p hidden>No custom fields…</p>`, empty `<tbody>`). If Claude Desktop is also strict (the SDK source says it should be), the iframe loads but the data never lands: same bug, different visual signature. **5-minute verification step in §3 below.**

---

## Section 1: What I verified vs what I couldn't verify

### Verified with direct evidence (high confidence)

| Claim | Evidence |
|---|---|
| MCP Apps spec mandates JSON-RPC 2.0 over postMessage between view and host | [MCP Apps Overview](https://modelcontextprotocol.io/extensions/apps/overview), [spec snapshot 2026-01-26](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx) |
| SEP-1865 was merged to main on Jan 28, 2026 with status `Final` | [SEP page](https://modelcontextprotocol.io/community/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp) |
| Required handshake: view sends `ui/initialize` request → receives `McpUiInitializeResult` → sends `ui/notifications/initialized` notification → host then sends `ui/notifications/tool-input` + `ui/notifications/tool-result` | [`apps.mdx` Lifecycle section](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx); [`@modelcontextprotocol/ext-apps@1.7.1/dist/src/app.d.ts`](https://github.com/modelcontextprotocol/ext-apps/blob/v1.7.1/src/app.ts); confirmed by reading `node_modules/@modelcontextprotocol/ext-apps/dist/src/app-bridge.d.ts` lines 130-1075 in the worktree |
| `@modelcontextprotocol/ext-apps@1.7.1` exposes a canonical View-side `App` class with events `toolinput`, `toolinputpartial`, `toolresult`, `toolcancelled`, `hostcontextchanged` | `dist/src/app.d.ts:AppEventMap` (line ~210); the package exports `.`, `./app-with-deps`, `./react`, `./react-with-deps`, `./app-bridge`, `./server`, `./schema.json` (verified via `cat node_modules/@modelcontextprotocol/ext-apps/package.json`) |
| `PostMessageTransport` (the canonical transport in the same SDK) silently drops messages where `event.data.jsonrpc !== "2.0"` | [`src/message-transport.ts` in ext-apps](https://github.com/modelcontextprotocol/ext-apps/blob/main/src/message-transport.ts): researcher quoted exact lines: `parsed.success ? this.onmessage?.(parsed.data) : event.data?.jsonrpc !== "2.0" && console.debug(...)` |
| VS Code Insiders shipped MCP Apps support Jan 26, 2026 with full spec compliance, no documented backward-compat | [VS Code blog post 2026-01-26](https://code.visualstudio.com/blogs/2026/01/26/mcp-apps-support) |
| Our widgets in `src/ui/shared/host.ts` post `{type:'ready'}` to `window.parent` and listen for `e.data?.type === 'init'` | [Direct read: `src/ui/shared/host.ts:42-51`](D:/Repos/Github/MCP-SWSD/.claude/worktrees/busy-bohr-e3e63f/src/ui/shared/host.ts): quoted in §2 below |
| All 4 UI tools (`getIncident`, `getSolution`, `listIncidents`, `describeCustomFields`) use `registerAppTool` + `registerAppResource` correctly server-side | Direct read of all 4 files: `_meta.ui.resourceUri` set, MIME type `text/html;profile=mcp-app`, e2e Test 7 confirms the wire shape via `tools/list` + `resources/read` |
| `@modelcontextprotocol/ext-apps@1.7.1` is the version we have in `package-lock.json` and `node_modules/` | `npm view ... version`; `cat node_modules/@modelcontextprotocol/ext-apps/package.json` |
| `idosal/mcp-ui`'s legacy shape uses `{type:'ui-lifecycle-iframe-ready'}` (child→parent) and `{type:'ui-lifecycle-iframe-render-data', payload:{renderData:{toolInput, toolOutput, ...}}}` (parent→child): NOT the same as our hand-rolled shape | [mcpui.dev/guide/mcp-apps](https://mcpui.dev/guide/mcp-apps) |
| `@mcp-ui/server` does NOT include a server-side translation layer; bridging happens iframe-side via the "Legacy MCP-UI Adapter" injected script | [@mcp-ui/server source](https://github.com/idosal/mcp-ui/blob/main/sdks/typescript/server/src/index.ts): exports `createUIResource`, `sendExperimentalRequest`, types, constants only |

### Could not verify directly (medium-low confidence; flagged with hypotheses)

| Claim | What I would need to verify | Best inference |
|---|---|---|
| **"Renders perfectly in Claude Desktop" is empirically true** (i.e., data actually arrives at the widget, not just the empty-state DOM) | A `console.log('message received', e.data)` inside `src/ui/shared/host.ts:43` running in Claude Desktop, OR DevTools attached to the Claude Desktop iframe | **Plausible but unverified.** Claude Desktop also uses the same SDK's strict transport per its public docs. The most likely explanation is measurement artifact: the widget's initial DOM (`<p class="loading">Loading incident…</p>`) looks like a passable empty-state and the actual `tool-result` data never lands. **5-min verification recommended**: see §3 |
| **Claude Desktop has an undocumented compat shim** that accepts the hand-rolled `{type:'init'}/{type:'ready'}` shape | Decompiling Claude Desktop's MCP host code (closed source) | **No evidence found.** Researcher searched the public ext-apps source + issue tracker. If a shim exists, it's either undocumented or in closed Claude code. The simpler hypothesis (measurement artifact) is the parsimonious explanation |
| **VS Code's host actually uses the canonical `PostMessageTransport`** (vs a custom strict-er or lenient-er one) | Inspecting VS Code's MCP Apps source (proprietary; Insiders source dump not public) | **Strongly likely.** VS Code's blog claims spec compliance; the SDK is the canonical reference; issue #634 shows VS Code returning Zod errors on schema violations consistent with strict transport behavior |
| **The exact JSON-RPC frames VS Code sends to our iframe** | Inspecting webview devtools in VS Code Insiders, OR adding diagnostic logging to the iframe message handler | Inferred from spec + SDK: `ui/notifications/tool-input` first (with the tool's input args), then `ui/notifications/tool-result` (with `content[]` + `structuredContent`). Could verify empirically as part of fix QA |

### Pushback on the original framing

The user's framed hypothesis ("widgets listen for `ui-lifecycle-iframe-render-data`") was **wrong about the specific event name**. Our widgets don't listen for `ui-lifecycle-iframe-render-data`; they listen for `e.data?.type === 'init'`. That's neither MCP Apps spec nor mcp-ui legacy: it's a hand-rolled shape we invented when writing `src/ui/shared/host.ts` in Plan D Task 2.

The directional intuition was correct: it IS a protocol mismatch with strict MCP Apps. But the fix is not "swap to mcp-ui legacy shape" or "add a legacy adapter": it's "stop using a hand-rolled shape and use the canonical `App` class."

---

## Section 2: Root cause: direct code evidence

**`src/ui/shared/host.ts:42-51`** (the hand-rolled bridge):

```ts
export function onHostInit<T>(handler: (msg: HostInitMessage<T>) => void): void {
  window.addEventListener('message', (e: MessageEvent) => {
    const msg = e.data as { type?: string };
    if (msg?.type === 'init') {
      handler(e.data as HostInitMessage<T>);
    }
  });
  window.parent?.postMessage({ type: 'ready' }, '*');
}
```

**What VS Code actually sends to the iframe** (per `@modelcontextprotocol/ext-apps@1.7.1/dist/src/app-bridge.d.ts`):

```jsonc
// First, after iframe load:
// VS Code waits for the iframe to send `ui/initialize` (it doesn't get one: our widget skips it)
// VS Code then sends `ui/notifications/tool-input`:
{
  "jsonrpc": "2.0",
  "method": "ui/notifications/tool-input",
  "params": { "arguments": { "id": 60310 } }
}
// And `ui/notifications/tool-result`:
{
  "jsonrpc": "2.0",
  "method": "ui/notifications/tool-result",
  "params": {
    "content": [{ "type": "text", "text": "Incident 60310: ..." }],
    "structuredContent": { "incident": { "id": 60310, "name": "Cannot access shared drive", ... } }
  }
}
```

**Our widget's filter at line 45**: `if (msg?.type === 'init')`. Neither of the JSON-RPC frames above has a `.type` property: they have a `.method` property. The filter rejects both. The widget never receives data.

**Why the iframe loads at all:** Plan D Task 2 wired the **server side** correctly via `registerAppTool` + `registerAppResource`. VS Code sees `_meta.ui.resourceUri = "ui://swsd/incident-detail.html"` in `tools/list`, sees the resource registered with MIME `text/html;profile=mcp-app` in `resources/list`, fetches the HTML via `resources/read`, and mounts an iframe with our HTML inside. The iframe shell + initial DOM render correctly: the `<p class="loading">Loading incident…</p>` placeholder is plain CSS+HTML, no data needed for that. Then the `tool-result` notification fires into the void.

**Why CSS rendering still works:** the dark theme + responsive layout in `src/ui/incident-detail/styles.css` etc. uses `light-dark()` CSS variables that resolve from the host's `color-scheme`. No JS handshake required for theming to render. So the iframe looks "almost right": just empty.

---

## Section 3: 5-minute verification before fixing: does Claude Desktop actually work?

The "renders perfectly in Claude Desktop" claim is the most consequential thing we have NOT verified. If it's true, there's an undocumented Claude-side path we're tripping. If it's a measurement artifact, the bug exists in BOTH hosts and the fix is required everywhere.

**Quick verification (pick one):**

**Option A**: Add diagnostic logging to the widget:

Edit `src/ui/shared/host.ts:43` temporarily:

```ts
window.addEventListener('message', (e: MessageEvent) => {
  console.log('[swsd-mcp widget] message received:', e.data);  // ← add this
  const msg = e.data as { type?: string };
  if (msg?.type === 'init') {
    handler(e.data as HostInitMessage<T>);
  }
});
```

Rebuild (`npm run build:ui`), restart Claude Desktop, call a UI tool, open the widget's DevTools (right-click → Inspect Element on the rendered iframe), look at console. If you see `[swsd-mcp widget] message received: { jsonrpc: "2.0", method: "ui/notifications/tool-result", ... }` AND the widget still shows actual incident data, there's some other code path receiving the data. If you only see those messages and the widget DOES show data: that's impossible per the code, so something is interpolating.

**Option B**: Look harder at Claude Desktop's behavior:

Open `swsd_get_incident` in Claude Desktop. Confirm:
- Title bar of the iframe shows the **specific incident name** (e.g., "Cannot access shared drive: File Server NYC1") and not just "SWSD Incident" (the static `<title>` in the bundle).
- The fields list (`Number`, `State`, `Priority`, etc.) shows actual values, not just labels.
- The "Open in SWSD ↗" link at the top-right has an actual URL (not absent or "#").

If any of those are missing/static, Claude Desktop is also broken: same as VS Code, just more visually plausible.

**This step is optional but high-value.** Worst case the user does both verifications and reports back; best case we learn something the researcher couldn't.

---

## Section 4: Options for fixing it

### Option A: Migrate widgets to canonical `App` class (recommended)

Replace `src/ui/shared/host.ts`'s hand-rolled `onHostInit` with the canonical `App` class from `@modelcontextprotocol/ext-apps` (already in `node_modules`). Each widget creates an `App`, sets `app.ontoolresult = handler`, calls `app.connect()`. Spec-compliant. Works in any MCP Apps host (Claude Desktop, VS Code, ChatGPT, Goose, M365 Copilot Chat).

**Pros:**
- Correct protocol, works everywhere MCP Apps is supported.
- Free upgrade path: when ext-apps adds new capabilities (host-context updates, theme tokens, sampling, callServerTool from view), we just consume them.
- Type safety: the `App` class is generic over tool input/output types; we get IDE help for the data shape.
- No back-compat baggage. Single protocol. Single source of truth.
- Minimal additional code: ~30 LOC of helper logic gets replaced with maybe ~20 LOC using the SDK.

**Cons:**
- Bundle size grows. `App` (with its dep on the MCP SDK + zod for schema validation) adds bytes per widget. **Concrete estimate: a representative `App`-using widget bundle from the official `examples/basic-server-vanillajs` is ~40-60 KB minified+gzipped (per researcher's review of the ext-apps demo bundles).** Our current widgets are 4-8 KB. So we'd land at 50-65 KB per widget, well within the 200 KB per-tool budget the build-artifact test enforces. Total `dist/ui/` goes from ~24 KB to ~250 KB. Not a deployment concern (npm tarball already 437 KB unpacked) but worth noting in the PR.
- Verify that Vite + `vite-plugin-singlefile` correctly inlines the SDK into the single-file HTML output. It should work because the plugin inlines all imported JavaScript, but the build still needs to be tested.
- The widget bundle now imports the MCP SDK's zod-flavored schema validation. Zod's JIT validation path requires CSP `unsafe-eval`; the spec mandates strict CSP on iframes which forbids that. ext-apps's `App` constructor handles this by setting `z.config({ jitless: true })` automatically (see [`AppOptions.allowUnsafeEval`](node_modules/@modelcontextprotocol/ext-apps/dist/src/app.d.ts:97): defaults to `false` which switches zod to non-JIT mode). So this is handled by the SDK; we just need to leave the default.

**Verdict: clear winner. Move forward with this option.**

### Option B: Speak both protocols (hand-rolled + spec)

Keep `onHostInit` for "back-compat" with the imagined Claude Desktop compat path AND add a parallel listener for `ui/notifications/tool-result` JSON-RPC frames.

**Pros:**
- Defensive against the unverified "Claude Desktop has its own shim" hypothesis.

**Cons:**
- We have **no evidence** any host actually sends `{type:'init'}` to our iframe. If the §3 verification shows Claude Desktop uses the same JSON-RPC protocol as VS Code, "back-compat" preserves nothing.
- Doubles the maintenance surface for no proven benefit.
- The hand-rolled path is a perpetual "what does this even do?" footgun for future contributors.

**Verdict: only justified if §3 verification proves the hand-rolled shape actually works somewhere. Default: don't do this.**

### Option C: Use idosal/mcp-ui legacy shape + their adapter

Switch our widgets to listen for `{type:'ui-lifecycle-iframe-render-data'}` (the legacy mcp-ui shape) and post `{type:'ui-lifecycle-iframe-ready'}`. Inject the mcp-ui Legacy Adapter into the iframe HTML so it translates between the legacy shape and MCP Apps JSON-RPC.

**Pros:**
- If we cared specifically about working with mcp-ui-aware tooling, this gets us into that ecosystem.

**Cons:**
- Adds `@mcp-ui/client` as a runtime dependency.
- Two layers of indirection: legacy adapter intercepts host JSON-RPC, translates to legacy shape, our widget consumes legacy shape. Each translation is a chance for drift.
- mcp-ui's legacy shape is itself deprecated; adapter is a back-compat bridge for OLD widgets, not a forward-looking choice for new code.
- Doesn't solve "our widgets are broken in spec-compliant hosts" any better than Option A: Option A goes direct to the spec.

**Verdict: not recommended. The adapter exists for migrating OLD mcp-ui widgets to MCP Apps hosts, not for greenfield code.**

### Option D: Roll back MCP Apps capability entirely; widgets become text-only

Drop `registerAppTool` + `registerAppResource`. Tools return only `content[]` + `structuredContent`. No iframe.

**Pros:**
- No protocol concerns. Works in every host the same way. Smaller npm tarball.

**Cons:**
- Throws away one of v2's flagship capabilities and the differentiation we documented in `V2-PROPOSAL.md` against the OSS competitor.
- Marketing regression: README badges, registry listing, docs all advertise MCP Apps support.
- Already-shipped public packages (`swsd-mcp@2.0.0`) advertised the capability. Yanking it would break the registry-listed expectations.

**Verdict: only justified if Option A turns out to be impossibly hard (it isn't).**

### Option E: Keep as-is, file a VS Code Insiders bug

**Verdict: incorrect framing.** VS Code's behavior is correct per the spec. Our widgets are wrong. Filing a bug would (rightly) get closed as "your widget doesn't speak MCP Apps."

---

## Section 5: Recommended option (with per-tool scoping)

**Option A, applied uniformly to all 4 UI-bearing tools.** No per-tool variation needed because all 4 use the same shared helper (`src/ui/shared/host.ts`) and the same scaffolding pattern.

The migration is a single helper rewrite + 4 minor widget edits.

**Estimated effort:** 2-4 hours including manual verification in two hosts. Single PR.

**Per-tool scope of changes:**

| Tool | Bundle | Changes |
|---|---|---|
| `swsd_get_incident` | `src/ui/incident-detail/` | `index.ts:onHostInit(...)` → `new App(...).ontoolresult = ...`; rest unchanged |
| `swsd_get_solution` | `src/ui/solution-detail/` | Same swap |
| `swsd_list_incidents` | `src/ui/incident-list/` | Same swap. Note: `ListPayload`'s `pagination` and `applied_filters` were extracted from `msg.data` directly; in the new model they're extracted from `result.params.structuredContent` |
| `swsd_describe_custom_fields` | `src/ui/custom-fields/` | Same swap |

Plus the shared helpers:

| File | Change |
|---|---|
| `src/ui/shared/host.ts` | **Replace entirely.** Drop `HostInitMessage` and `onHostInit`. Keep `applyHostThemeVariables` as-is OR replace with `applyHostStyleVariables` from `@modelcontextprotocol/ext-apps` (verify the API matches what we need). |
| `src/ui/shared/dom.ts` | **No change.** This is the safe-DOM `el` / `clear` helper from Plan D Task 1; protocol-agnostic. |
| `tests/unit/ui/dom.test.ts`, `format.test.ts`, `host.test.ts`, `incident-list.test.ts`, `custom-fields.test.ts` | **No change** to most. `host.test.ts` becomes much smaller (just tests for `applyHostThemeVariables`'s `--`-prefix guard), or we delete it if we adopt the SDK's `applyHostStyleVariables` instead. |
| `tests/unit/tools/*.ui.test.ts` (4 files) | **No change.** They assert the server-side registration shape (`_meta.ui.resourceUri`, resource-read callback). That part is correct and doesn't move. |
| `tests/unit/ui/build.test.ts` | **Maybe change** the 200 KB-per-bundle limit if we hit it. Current 200 KB is generous for plain widgets; `App`-using bundles will be ~50-65 KB. Should still pass. If a bundle approaches 200 KB, raise the budget OR investigate why the bundle is larger than the reference example. |

---

## Section 6: Migration / back-compat strategy

**Spec-level back-compat:** the fundamental v2 contract is preserved automatically. Every UI-bearing tool already returns `content[]` + `structuredContent` in addition to advertising `_meta.ui.resourceUri`. Hosts that don't support MCP Apps (Copilot Studio authoring chat, LM Studio, Claude Code CLI, etc.) silently ignore the UI advertisement and use the text + structured payload. **That's the spec's mandated text-only fallback** ([apps.mdx](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx): `"Servers SHOULD provide text-only fallback behavior for all UI-enabled tools."`: already in place). This plan does not touch the tool handlers; the text response is byte-identical.

**Host-level back-compat for the iframe channel:** the **only** concrete back-compat concern would be a host that:
1. Recognizes `_meta.ui.resourceUri` and loads the iframe, AND
2. Posts `{type:'init'}` data to the iframe (NOT `ui/notifications/tool-result`).

We have **no evidence** any host does (1)+(2). The user's reported "Claude Desktop works" is unverified at the data-arrival level; the canonical SDK source explicitly drops non-JSON-RPC postMessage. So removing the hand-rolled shape preserves nothing demonstrable. If §3 verification turns up a real exception (unlikely), we'll re-evaluate.

**v2.0.0 was published yesterday.** A v2.0.1 patch release with this fix is the right shape: it's a correctness bug, not a feature. SemVer-correct since no public API surface changes (server tool list / output schemas / npm bin contract are untouched).

**Registry update path:** after v2.0.1 ships to npm, run `mcp-publisher publish` again. The `server.json` only changes in `version` and `packages[0].version` (both bump 2.0.0 → 2.0.1). Re-submitting is documented in Plan F Task 5 Step 2.

---

## Section 7: File-by-file plan

### Task 1: Migrate `src/ui/shared/host.ts` to the canonical `App` class

**Files:**
- Modify: `src/ui/shared/host.ts`
- Modify: `tests/unit/ui/host.test.ts` (drop the now-irrelevant `onHostInit` test cases; keep theme-var tests if `applyHostThemeVariables` survives)
- Modify: `vite.config.ts` if needed for `@modelcontextprotocol/ext-apps` external/inline behavior
- Modify: `tsconfig.ui.json` if a new path mapping is needed (probably not: the package resolves natively)

**Step 1.** Read the canonical view-side example at `node_modules/@modelcontextprotocol/ext-apps/dist/src/app.d.ts` (we already have this: see §1 references) plus the `examples/basic-server-vanillajs/src/mcp-app.ts` reference (researcher pointed at this; pull it locally to verify exact shape).

**Step 2.** Replace `host.ts` with something like:

```ts
import { App, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import type { McpUiToolResultNotification, McpUiHostContextChangedNotification }
  from '@modelcontextprotocol/ext-apps';

/**
 * Create + connect an MCP App for a widget that consumes a single tool-result.
 *
 * Per spec 2026-01-26, the host sends `ui/notifications/tool-result` once
 * after the view sends `ui/notifications/initialized`. This helper wires
 * a single handler for that result and applies host theme tokens.
 */
export async function mountApp<T>(opts: {
  name: string;
  version: string;
  onResult: (structuredContent: T) => void;
}): Promise<App> {
  const app = new App({
    name: opts.name,
    version: opts.version,
  });

  app.ontoolresult = ({ structuredContent }) => {
    opts.onResult(structuredContent as T);
  };

  app.onhostcontextchanged = (ctx) => {
    if (ctx.styles) applyHostStyleVariables(ctx.styles);
  };

  await app.connect();

  // Apply initial host theme if available
  const ctx = app.getHostContext();
  if (ctx?.styles) applyHostStyleVariables(ctx.styles);

  return app;
}
```

Verify the actual signatures of `App`, `getHostContext`, `applyHostStyleVariables` against `node_modules/@modelcontextprotocol/ext-apps/dist/src/`: the snippet above is intent-level; we'll match the SDK exactly during implementation.

**Step 3.** Delete the old `onHostInit` and `HostInitMessage` exports. They're not used outside the 4 widgets.

**Step 4.** Update `tests/unit/ui/host.test.ts`. The current 4 tests pin `applyHostThemeVariables`'s `--`-prefix guard. If we keep our own `applyHostThemeVariables` (because the SDK's version may not have the same defensive guard), keep those tests. If we adopt `applyHostStyleVariables` from the SDK, replace those tests with one assertion that the SDK helper is callable + a comment explaining we're delegating validation to the SDK.

**Test sweep after step 4:**
```bash
npm run typecheck && npm test && npm run build
```

The build should still succeed. Expect bundle sizes to grow ~5-10×.

**Commit:**
```bash
git add src/ui/shared/host.ts tests/unit/ui/host.test.ts vite.config.ts
git commit -m "fix(ui): migrate widget bridge from hand-rolled init/ready to App class"
```

### Task 2: Migrate the 4 widget index.ts files

For each of `incident-detail`, `solution-detail`, `incident-list`, `custom-fields`:

**Step 1.** Replace the `onHostInit<Payload>(handler)` call with `mountApp<Payload>({...})`. The handler body stays identical. Existing payload-shape decisions (flat vs nested for incident-detail's `category`, `description_no_html` fallback for solution-detail, etc.) are preserved.

**Example: `src/ui/incident-detail/index.ts:42-67`** (current):

```ts
import { onHostInit, applyHostThemeVariables } from '../shared/host.js';
// ...
onHostInit<IncidentPayload>((msg) => {
  applyHostThemeVariables(msg.styles?.variables);
  render(msg.data.incident);
});
```

becomes:

```ts
import { mountApp } from '../shared/host.js';
// ...
mountApp<IncidentPayload>({
  name: 'swsd-mcp/incident-detail',
  version: '2.0.0',
  onResult: ({ incident }) => render(incident),
}).catch((err) => {
  console.error('Failed to connect MCP App:', err);
});
```

(Theme handling moves into `mountApp`; we don't need it per-widget anymore.)

**Step 2.** Each widget's `name` slug is unique (`swsd-mcp/incident-detail`, etc.) so the host can identify which view it's talking to in logs.

**Step 3.** Run `npm test` after each widget migration so failures localize to one diff.

**Test sweep after each widget:**
```bash
npm run build:ui   # rebuild that widget's bundle
npx vitest run tests/unit/tools/<that-tool>.ui.test.ts  # confirm the registration test still passes
```

**Commit per widget:**
```bash
git commit -m "fix(ui): wire incident-detail to MCP Apps tool-result events"
git commit -m "fix(ui): wire solution-detail to MCP Apps tool-result events"
git commit -m "fix(ui): wire incident-list to MCP Apps tool-result events"
git commit -m "fix(ui): wire custom-fields to MCP Apps tool-result events"
```

(Or one squash-style commit `fix(ui): migrate all 4 widgets to App class`. Maintainer's call.)

### Task 3: Manual QA in two hosts

**Step 1: VS Code Insiders.**
- Update the swsd-mcp install in VS Code's MCP config to point at the worktree's `dist/cli.js` (or use the registry'd npm path with a `dev` tag).
- Run a UI-bearing tool. Verify the iframe loads AND populates with data.
- Verify the filter/sort interactions on `incident-list` and `custom-fields` still work.
- Open VS Code's "MCP: Show Output" channel for the swsd server. Verify no errors.

**Step 2: Claude Desktop.**
- Same as Step 1 but in Claude Desktop.
- This is the validation that we haven't regressed Claude Desktop. If §3's verification was inconclusive, this is also the moment to definitively confirm Claude Desktop now works (it should: `App` speaks the spec, and Claude Desktop is documented as a spec-compliant host).

**Step 3: MCP Inspector.**
- `npm run inspect:stdio` to launch the official MCP Inspector at localhost. The Inspector renders MCP Apps UI bundles inline as a development convenience. Run each of the 4 UI tools and confirm the widget renders + populates.

### Task 4: Bump version + ship

**Step 1.** `npm version patch` (1.0.1 → 2.0.1, since we're after 2.0.0). This bumps `package.json` and creates a tag, but we don't push the tag yet.

**Step 2.** Update `server.json`'s `version` and `packages[0].version` to `"2.0.1"`.

**Step 3.** Add a CHANGELOG entry under `[Unreleased]` → cut to `[2.0.1] - 2026-05-08` (or whatever date) with a brief explanation:

```markdown
## [2.0.1] - 2026-05-08

### Fixed

- Widget UI bundles for the four MCP Apps-capable tools (`swsd_get_incident`,
  `swsd_get_solution`, `swsd_list_incidents`, `swsd_describe_custom_fields`)
  now use the canonical MCP Apps JSON-RPC protocol via the `App` class from
  `@modelcontextprotocol/ext-apps`. The previous hand-rolled `{type:'init'}` /
  `{type:'ready'}` postMessage shape was silently dropped by spec-compliant
  hosts (VS Code Insiders Copilot Chat, and likely Claude Desktop's data
  channel, though widgets there appeared to render due to identical empty-state
  DOM). No tool-handler changes; no API surface changes.
```

**Step 4.** Open release PR. CI runs. Spec/code review optional given the diff scope. Squash + tag.

**Step 5.** Publish workflow auto-fires on tag. After it lands, re-run `mcp-publisher publish` to update the registry's `version` field.

---

## Section 8: Test plan: proves both VS Code Insiders and Claude Desktop work before shipping

### Automated (in CI, must pass before merge)

| Test | Expected | Why it matters |
|---|---|---|
| `npm run typecheck` | clean | Catches any type drift in the App-class consumption |
| `npm test` | 416 passing (unchanged), maybe -3 from `host.test.ts` if we trim it | Catches any regression in unit-tested logic |
| `npm run build` | clean; 4 widget bundles emit; each <200 KB | Catches Vite bundling issues, especially around inlining the SDK with `vite-plugin-singlefile` |
| `tests/unit/tools/*.ui.test.ts` (4 files) | Each tool's registration test still asserts `_meta.ui.resourceUri = ui://swsd/<name>.html` and the resource-read callback returns the right MIME + sentinel substring | Confirms server-side wiring (already correct) is still correct |
| e2e smoke (`.research/v2/smoke-tests/mcp-e2e-smoke.mjs`) | 15/15, including Test 7's UI-metadata advertisement | Confirms wire shape on the server side |

### Manual (run before squash-merge)

| Step | Host | What to verify |
|---|---|---|
| 1 | VS Code Insiders Copilot Chat agent mode | Run `swsd_get_incident` against a known incident id. Iframe renders + fields populate (Number, State, Priority, Assignee, Requester, Category, Updated). "Open in SWSD ↗" link has the actual URL. |
| 2 | VS Code Insiders Copilot Chat agent mode | Run `swsd_list_incidents`. The table populates. Type into the filter input and confirm the rows narrow live. Click a column header and confirm the sort toggles. |
| 3 | VS Code Insiders Copilot Chat agent mode | Run `swsd_describe_custom_fields`. The card grid populates. Toggle "Active only" off and confirm inactive cards appear. Pick a scope from the dropdown and confirm the cards narrow. Click "▶ N values" on a picklist and confirm the values list expands. |
| 4 | VS Code Insiders Copilot Chat agent mode | Run `swsd_get_solution`. Same as step 1, solution shape. |
| 5 | Claude Desktop | Repeat steps 1-4. Each must populate with real data (verify by reading specific field values, NOT just "the iframe loaded"). |
| 6 | MCP Inspector (`npm run inspect:stdio`) | Repeat steps 1-4. The Inspector's iframe should populate. |
| 7 | LM Studio (or any non-MCP-Apps host) | Run any UI-bearing tool. Confirm the text + structured response appears in chat as before, with no errors. (We haven't regressed the text-only fallback.) |

### Rollback

If post-deploy any host shows a regression, the rollback is `npm deprecate swsd-mcp@2.0.1 "Use 2.0.2 (rollback) or 2.0.0 (pre-fix)"` and a follow-up release. The `server.json`'s `version` field can be re-submitted.

---

## Section 9: Open questions (pre-implementation review)

1. **Verification of "Claude Desktop works."** The single most important pre-implementation step is §3's 5-min check. If Claude Desktop is also broken (most likely), the urgency story is stronger: "v2.0.1 fixes UI rendering across all spec-compliant hosts." If Claude Desktop genuinely does work, the urgency story is "v2.0.1 fixes VS Code; Claude Desktop's path stays working too." Either is fine; the fix is the same; but the framing in the CHANGELOG / release notes differs.

2. **Bundle-size budget.** Current per-widget budget is 200 KB (set in Plan D Task 1 by `tests/unit/ui/build.test.ts`). Migration brings widgets from 4-8 KB to ~50-65 KB. Should comfortably pass. **Concrete verification step**: build one widget after Task 1 and check the byte count before doing the others.

3. **Whether to keep our `applyHostThemeVariables`.** The SDK exports `applyHostStyleVariables` from `@modelcontextprotocol/ext-apps`. Need to compare API + defensive behavior. If the SDK's version validates `--`-prefix natively, drop ours. If not, keep ours. (Trivial check during Task 1.)

4. **Whether to register `App.callServerTool` to support iframe-initiated tool calls in the future.** Out of scope for v2.0.1 (no widget needs it today), but the migration to `App` class makes this a 1-line addition for v2.1.

5. **Whether to revisit the "incident-list title doesn't update on filter change" deferred polish from Plan D Task 5 review.** Out of scope for this fix unless the rewrite makes it incidentally trivial.

---

## Section 10: Decision summary

| Question | Answer |
|---|---|
| Is the user's hypothesis correct? | **Partially.** The directional intuition (protocol mismatch) is right. The specific event-name claim (`ui-lifecycle-iframe-render-data`) is wrong: our shape is hand-rolled, not legacy mcp-ui. |
| Is VS Code's behavior a bug? | **No.** VS Code is spec-compliant; our widgets are wrong. |
| Does Claude Desktop have an undocumented compat shim? | **No evidence found.** Most parsimonious explanation: measurement artifact (initial DOM looks like a working empty state). 5-min verification recommended. |
| Should we ship a fix? | **Yes: Option A (migrate to canonical `App` class), as a v2.0.1 patch.** |
| Risk of regression for currently-working clients? | **Minimal.** Hosts without MCP Apps support (Copilot Studio, LM Studio, Claude Code CLI) use the spec-mandated text+structured fallback that's already in place and unchanged. Hosts with MCP Apps support move from "iframe shell + empty widget" to "iframe shell + populated widget." |
| What's the size of the change? | **~5 files, ~30-50 LOC net.** Single PR, ~2-4 hours including manual QA. |
| What's the version bump? | **2.0.0 → 2.0.1** (patch: fix only, no API surface change). |

**Ready for review.** Once approved, I'll start with §3's verification step (run diagnostic logging in Claude Desktop) before writing any production code, then proceed through Tasks 1-4 in order.
