/**
 * Documentation contract tests for README.md and the docs-site configuration
 * page.
 *
 * Asserts that the human-maintained facts match the single source of truth
 * in src/. These tests exist because the tool-count drift bug (PR #11) showed
 * that documented claims about counts/lists/defaults silently rot when the
 * underlying code changes.
 *
 * **Scope split (changed in the v2.1 docs overhaul):**
 *
 * The README intentionally documents only the high-signal env vars
 * (SWSD_TOKEN, SWSD_BASE_URL, SWSD_PROFILE, SWSD_WRITE_MODE) — everything else lives in
 * `docs-site/src/content/docs/configuration.md`, which is the canonical
 * full env-var reference. The Configuration-tables tests below enforce:
 *   - The README's high-signal rows match EnvSchema defaults.
 *   - Every other EnvSchema key (minus SKIP) is documented in the docs-site
 *     configuration.md with a default that matches EnvSchema.
 * This keeps the no-drift guarantee while letting the README stay focused.
 *
 * If a test here fails, you have two options:
 *   1. The doc is stale — update it.
 *   2. The source genuinely changed — update the doc to match.
 * In either case, never edit the test to make it pass.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROFILE_TOOLS } from '../../../src/config/profiles.js';
import { EnvSchema, KNOWN_PROFILES } from '../../../src/config/env.js';

const README = readFileSync(resolve('README.md'), 'utf-8');
const CONFIG_DOC = readFileSync(
  resolve('docs-site/src/content/docs/configuration.md'),
  'utf-8',
);

/** Vars that the README's slim configuration table is responsible for. */
const README_ESSENTIALS = new Set(['SWSD_BASE_URL', 'SWSD_PROFILE', 'SWSD_WRITE_MODE']);

describe('README documentation contract', () => {
  describe('Profiles table', () => {
    for (const profile of KNOWN_PROFILES) {
      it(`${profile} row shows the correct tool count`, () => {
        const expected = PROFILE_TOOLS[profile].length;
        // Match: | `triage` | description | 8 |
        const row = README.match(new RegExp(`\\|\\s*\`${profile}\`\\s*\\|[^|]+\\|\\s*(\\d+)\\s*\\|`));
        expect(row, `Missing or malformed Profiles-table row for "${profile}"`).not.toBeNull();
        const documented = Number(row![1]);
        expect(documented).toBe(expected);
      });
    }
  });

  describe('"Tools" header', () => {
    const headerMatch = README.match(/^## Tools \((\d+) across (\d+) categories\)/m);

    it('exists in the expected format', () => {
      expect(headerMatch, 'Could not find "## Tools (N across M categories)" header').not.toBeNull();
    });

    it('total count matches PROFILE_TOOLS.full.length', () => {
      const documented = Number(headerMatch![1]);
      expect(documented).toBe(PROFILE_TOOLS.full.length);
    });

    it('category count matches the number of category rows in the table', () => {
      const documentedCategories = Number(headerMatch![2]);
      // Extract the table that immediately follows the "## Tools" header.
      const toolsSection = README.match(/^## Tools[^]*?(?=^## )/m);
      expect(toolsSection, 'Could not extract Tools section').not.toBeNull();
      // Count rows that look like: | **Category** | tools... |
      const categoryRows = toolsSection![0].match(/^\|\s*\*\*[^*]+\*\*\s*\|/gm) ?? [];
      expect(categoryRows.length).toBe(documentedCategories);
    });
  });

  describe('Tools-by-category table', () => {
    const toolsSection = README.match(/^## Tools[^]*?(?=^## )/m)?.[0] ?? '';
    const documentedTools = new Set<string>();
    for (const m of toolsSection.matchAll(/`(swsd_[a-z_]+)`/g)) {
      documentedTools.add(m[1]!);
    }

    const fullProfileTools = new Set<string>(PROFILE_TOOLS.full);

    it('lists every tool registered in the full profile', () => {
      const missing = [...fullProfileTools].filter((t) => !documentedTools.has(t));
      expect(missing, `Tools missing from README "Tools" table: ${missing.join(', ')}`).toEqual([]);
    });

    it('does not list any tool that is not in the full profile', () => {
      const extra = [...documentedTools].filter((t) => !fullProfileTools.has(t));
      expect(extra, `README "Tools" table lists tools not registered in any profile: ${extra.join(', ')}`).toEqual([]);
    });
  });

  describe('Configuration tables', () => {
    // Parse with empty input to get all schema-level defaults.
    const defaults = EnvSchema.parse({}) as Record<string, unknown>;

    /**
     * Cases where we deliberately do NOT cross-check documented defaults:
     * - SWSD_TOKEN: no schema default; "Required" semantic varies by transport
     * - SWSD_ENABLE_EXTRAS / SWSD_ALLOWED_ORIGINS: optional CSV transforms;
     *   schema parses to [] but the docs correctly show em-dash for "unset"
     */
    const SKIP = new Set(['SWSD_TOKEN', 'SWSD_ENABLE_EXTRAS', 'SWSD_ALLOWED_ORIGINS']);

    /**
     * Match a Configuration-table row in markdown:
     *   | `KEY` | `default` | notes |   ← preferred backtick-wrapped form
     *   | `KEY` | default   | notes |   ← bare-token form
     *   | `KEY` | _(empty)_ | notes |   ← italic placeholder
     */
    function findRowDefault(text: string, key: string): string | null {
      const m = text.match(new RegExp(`\\|\\s*\`${key}\`\\s*\\|\\s*\`?([^|\`]+?)\`?\\s*\\|`));
      return m ? m[1]!.trim() : null;
    }

    describe('README essentials', () => {
      // The README only documents the highest-signal vars; the rest live in
      // the docs-site configuration page (asserted in the next describe).
      for (const key of README_ESSENTIALS) {
        if (SKIP.has(key)) continue;
        const expected = defaults[key];
        if (expected === undefined) continue;
        it(`README default for ${key} matches EnvSchema default (${String(expected)})`, () => {
          const documented = findRowDefault(README, key);
          expect(documented, `Missing Configuration-table row for "${key}" in README.md`).not.toBeNull();
          expect(documented).toBe(String(expected));
        });
      }
    });

    describe('docs-site full reference', () => {
      // Every EnvSchema key (minus SKIP) must be documented in
      // docs-site/src/content/docs/configuration.md with a default matching
      // EnvSchema. This is the no-drift guarantee for the canonical reference.
      for (const key of Object.keys(EnvSchema.shape)) {
        if (SKIP.has(key)) continue;
        const expected = defaults[key];
        if (expected === undefined) continue;
        it(`docs-site default for ${key} matches EnvSchema default (${String(expected)})`, () => {
          const documented = findRowDefault(CONFIG_DOC, key);
          expect(
            documented,
            `Missing Configuration-table row for "${key}" in docs-site/src/content/docs/configuration.md`,
          ).not.toBeNull();
          expect(documented).toBe(String(expected));
        });
      }
    });

    it('README links to the canonical docs-site configuration page', () => {
      // Defensive: if someone later removes the link out, the contract that
      // README intentionally trims to essentials breaks silently.
      expect(
        README.match(/mcp-swsd\.pages\.dev\/configuration/i),
        'README should link to https://mcp-swsd.pages.dev/configuration/ for the full env-var reference',
      ).not.toBeNull();
    });
  });
});
