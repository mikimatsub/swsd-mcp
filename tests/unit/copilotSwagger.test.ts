import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { KNOWN_PROFILES } from '../../src/config/env.js';

const COPILOT_DIR = resolve('copilot-studio');

describe('Copilot Studio Swagger artifacts', () => {
  for (const profile of KNOWN_PROFILES) {
    describe(`${profile}.swagger.yaml`, () => {
      const path = resolve(COPILOT_DIR, `${profile}.swagger.yaml`);

      it('exists in copilot-studio/', () => {
        expect(existsSync(path)).toBe(true);
      });

      const content = existsSync(path) ? readFileSync(path, 'utf-8') : '';

      it('declares Swagger 2.0 (string-quoted, not numeric)', () => {
        expect(content).toMatch(/^swagger: '2\.0'/m);
      });

      it('includes the Copilot agentic protocol extension on the POST /mcp operation', () => {
        expect(content).toContain('x-ms-agentic-protocol: mcp-streamable-1.0');
      });

      it('declares X-SWSD-Token apiKey auth in the header', () => {
        expect(content).toMatch(/type: apiKey/);
        expect(content).toMatch(/in: header/);
        expect(content).toMatch(/name: X-SWSD-Token/);
      });

      it('targets the /mcp endpoint over HTTPS only', () => {
        expect(content).toMatch(/\/mcp:/);
        expect(content).toMatch(/schemes:[\s\S]*- https/);
        expect(content).not.toMatch(/- http\b/);
      });

      it('mentions the profile name in the title', () => {
        expect(content).toMatch(new RegExp(`title:.*${profile} profile`));
      });

      it('uses the placeholder host (must be edited before import)', () => {
        expect(content).toContain('REPLACE_WITH_YOUR_HOST');
      });

      it('uses operationId InvokeMCP (Copilot Studio expects a stable operationId)', () => {
        expect(content).toContain('operationId: InvokeMCP');
      });

      it('declares both 401 and 403 response codes', () => {
        expect(content).toMatch(/'401':/);
        expect(content).toMatch(/'403':/);
      });
    });
  }
});
