/**
 * Documentation contract tests for copilot-studio/README.md.
 *
 * The copilot-studio/README.md has its own "Files" table listing each
 * Swagger YAML's profile name and tool count. This is the same drift
 * surface as the main README's Profiles table, but for a separate
 * audience (Copilot Studio users importing connectors).
 *
 * If a test fails: the table is stale relative to PROFILE_TOOLS.
 * Update copilot-studio/README.md, never edit the test.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROFILE_TOOLS } from '../../../src/config/profiles.js';

const COPILOT_README = readFileSync(resolve('copilot-studio/README.md'), 'utf-8');

describe('copilot-studio/README.md documentation contract', () => {
  describe('Files table', () => {
    for (const profile of Object.keys(PROFILE_TOOLS) as (keyof typeof PROFILE_TOOLS)[]) {
      it(`${profile}.swagger.yaml row shows the correct tool count`, () => {
        const expected = PROFILE_TOOLS[profile].length;
        // Match: | `triage.swagger.yaml` | `triage` | 8 | description |
        const row = COPILOT_README.match(
          new RegExp(`\\|\\s*\`${profile}\\.swagger\\.yaml\`\\s*\\|\\s*\`${profile}\`\\s*\\|\\s*(\\d+)\\s*\\|`),
        );
        expect(row, `Missing or malformed Files-table row for ${profile}.swagger.yaml`).not.toBeNull();
        const documented = Number(row![1]);
        expect(documented).toBe(expected);
      });
    }
  });
});
