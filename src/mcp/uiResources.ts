import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// At runtime: this file is `dist/mcp/uiResources.js`, so the sibling `ui` dir
// under `dist/` is at `<__dirname>/../ui`. That's the production path.
// At test time (vitest evaluates the .ts source directly), `__dirname` points
// to `src/mcp/`, where the sibling `ui` dir contains source — not the built
// HTML — so we also try `<process.cwd()>/dist/ui` as a fallback (tests run
// from the repo root after `npm run build:ui`).
const RUNTIME_UI_DIR = resolve(__dirname, '..', 'ui');
const FALLBACK_UI_DIR = resolve(process.cwd(), 'dist', 'ui');

/**
 * Allowed UI bundle slugs.
 *
 * Closed allowlist — `loadUiResource(name)` rejects any `name` not in this
 * set. Defends against path-traversal attacks (e.g. `../../etc/passwd`) if
 * `name` ever flows from untrusted input. Today every caller is hardcoded
 * (`registerGetIncident` calls `loadUiResource('incident-detail')`, etc.),
 * but the function is exported and could be misused; the allowlist removes
 * that concern entirely.
 *
 * Mirrors `UI_TOOLS` in `scripts/ui-tools.mjs` — keep in sync. There's no
 * import-from-mjs path that works in both production tsc + test vitest, so
 * the list is duplicated. The `tests/unit/ui/build.test.ts` BUNDLES array
 * + `npm run build:ui` are the canonical drift-detectors: a slug present
 * here but missing from UI_TOOLS won't have a built bundle, so
 * `loadUiResource` will throw a build-hint error at startup.
 */
const ALLOWED_UI_NAMES = new Set<string>([
  'incident-detail',
  'solution-detail',
  'incident-list',
  'custom-fields',
  'comment-thread',
  'audit-timeline',
  'catalog-item-form',
  'sla-risk',
  'change-calendar',
]);

const cache = new Map<string, string>();

/**
 * Loads an inlined UI bundle produced by `npm run build:ui`.
 *
 * @param name - Bundle slug WITHOUT the `.html` extension. Must be one of
 *   the slugs in `ALLOWED_UI_NAMES` (closed allowlist; rejected names never
 *   touch the filesystem).
 * @returns The full inlined HTML string ready to ship as an MCP resource —
 *   `vite-plugin-singlefile` has already inlined every `<script>` and `<link>`.
 * @throws If `name` is not in the allowlist (the rejected name is included
 *   in the error message), or if the bundle file is missing (with a
 *   build-hint message pointing at `npm run build:ui`).
 *
 * Reads are cached for the process lifetime; the file is read from disk only
 * the first time a given `name` is requested.
 */
export function loadUiResource(name: string): string {
  // Closed allowlist guard: defense in depth against path-traversal even if
  // a future caller ever plumbs untrusted input through `name`. This is
  // checked BEFORE any path resolution / fs call so a malicious `name` never
  // touches the filesystem.
  if (!ALLOWED_UI_NAMES.has(name)) {
    throw new Error(
      `UI resource name "${name}" is not in the allowlist. ` +
        `Permitted: ${[...ALLOWED_UI_NAMES].join(', ')}.`,
    );
  }

  const cached = cache.get(name);
  if (cached !== undefined) return cached;

  const candidates = [
    resolve(RUNTIME_UI_DIR, `${name}.html`),
    resolve(FALLBACK_UI_DIR, `${name}.html`),
  ];
  const path = candidates.find((p) => existsSync(p));
  if (!path) {
    throw new Error(
      `UI resource "${name}" not found at ${candidates.join(' or ')}. Did you run "npm run build:ui"?`,
    );
  }
  const html = readFileSync(path, 'utf8');
  cache.set(name, html);
  return html;
}

/** Internal — leading underscore signals not-public-API; used only by uiResources tests to reset state between cases. */
export function _resetCacheForTests(): void {
  cache.clear();
}
