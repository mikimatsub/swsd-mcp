import { describe, expect, it } from 'vitest';
import packageJson from '../../package.json' with { type: 'json' };
import serverJson from '../../server.json' with { type: 'json' };
import { SERVER_VERSION } from '../../src/mcp/server.js';

describe('version metadata', () => {
  it('keeps the runtime MCP server version aligned with package.json', () => {
    expect(SERVER_VERSION).toBe(packageJson.version);
  });

  it('keeps MCP Registry package versions aligned with package.json', () => {
    expect(serverJson.version).toBe(packageJson.version);
    for (const entry of serverJson.packages) {
      expect(entry.version).toBe(packageJson.version);
    }
  });

  it('keeps the MCP Registry description within its 100-character limit', () => {
    expect(serverJson.description.length).toBeLessThanOrEqual(100);
  });
});
