import { describe, expect, it } from 'vitest';
import packageJson from '../../package.json' with { type: 'json' };
import packageLock from '../../package-lock.json' with { type: 'json' };
import serverJson from '../../server.json' with { type: 'json' };
import { SERVER_VERSION } from '../../src/mcp/server.js';
import { PROFILE_TOOLS } from '../../src/config/profiles.js';

describe('version metadata', () => {
  it('keeps the runtime MCP server version aligned with package.json', () => {
    expect(SERVER_VERSION).toBe(packageJson.version);
  });

  it('keeps both npm lockfile version surfaces aligned with package.json', () => {
    expect(packageLock.version).toBe(packageJson.version);
    expect(packageLock.packages[''].version).toBe(packageJson.version);
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

  it('keeps MCP Registry profile counts aligned with PROFILE_TOOLS without a token', () => {
    const expected = Object.fromEntries(
      Object.entries(PROFILE_TOOLS).map(([profile, tools]) => [profile, new Set(tools).size]),
    );
    for (const entry of serverJson.packages) {
      const profile = entry.environmentVariables.find(variable => variable.name === 'SWSD_PROFILE');
      expect(profile?.choices?.slice().sort()).toEqual(Object.keys(expected).sort());
      const counts = Object.fromEntries(
        [...(profile?.description ?? '').matchAll(/'([a-z]+)' \((\d+)\b/g)]
          .map(([, name, count]) => [name, Number(count)]),
      );
      expect(counts).toEqual(expected);
    }
  });
});
