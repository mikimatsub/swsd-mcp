import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const distUi = resolve(process.cwd(), 'dist', 'ui');

/**
 * Sentinel substring expected in each bundled HTML — picked to match the
 * `<title>` of each UI's index.html. If a bundle is empty / shells out to a
 * placeholder we want to know.
 */
const BUNDLES: Array<{ name: string; sentinel: string }> = [
  { name: 'incident-detail', sentinel: 'SWSD Incident' },
  { name: 'solution-detail', sentinel: 'SWSD Solution' },
  { name: 'incident-list', sentinel: 'SWSD Incidents' },
  { name: 'custom-fields', sentinel: 'SWSD Custom Fields' },
  { name: 'comment-thread', sentinel: 'SWSD Comments' },
  { name: 'audit-timeline', sentinel: 'SWSD Audit Timeline' },
  { name: 'catalog-item-form', sentinel: 'SWSD Catalog Item Form' },
];

describe('UI build artifacts', () => {
  for (const { name, sentinel } of BUNDLES) {
    it(`emits a single-file ${name}.html bundle under dist/ui/`, () => {
      const path = resolve(distUi, `${name}.html`);
      expect(existsSync(path)).toBe(true);
      const html = readFileSync(path, 'utf8');
      expect(html).toContain(sentinel);
      // Every bundle must work in an isolated MCP frame without external assets.
      expect(html).not.toMatch(/<script\b[^>]*\bsrc\s*=/i);
      expect(html).not.toMatch(/<link\b[^>]*\bhref=["'][^"']+\.css(?:\?[^"']*)?["']/i);
    });

    it(`${name}.html stays under the 500 KB single-tool budget`, () => {
      // Budget rationale: bundles include the full @modelcontextprotocol/ext-apps
      // App class (which transitively pulls the MCP SDK + zod) for spec-compliant
      // postMessage JSON-RPC. Empirical bundle size at v2.0.1 is ~340 KB raw
      // (~80 KB gzipped). The 500 KB ceiling guards against runaway accidental
      // bloat (e.g., lodash full import) while accommodating normal SDK growth.
      // Revisit if ext-apps publishes a slimmer App-only entrypoint.
      const path = resolve(distUi, `${name}.html`);
      const bytes = statSync(path).size;
      expect(bytes).toBeLessThan(500_000);
    });
  }
});
