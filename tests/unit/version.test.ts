import { describe, expect, it } from 'vitest';
import packageJson from '../../package.json' with { type: 'json' };
import { SERVER_VERSION } from '../../src/mcp/server.js';

describe('version metadata', () => {
  it('keeps the runtime MCP server version aligned with package.json', () => {
    expect(SERVER_VERSION).toBe(packageJson.version);
  });
});
