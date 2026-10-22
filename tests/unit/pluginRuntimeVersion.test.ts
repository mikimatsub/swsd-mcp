import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped manifest JSON
type Json = any;
const readJson = (path: string): Json => JSON.parse(readFileSync(join(root, path), 'utf8')) as Json;

const serverVersion = readJson('package.json').version as string;
const recipe = readJson('plugins/swsd/runtime/package.json');
const lock = readJson('plugins/swsd/runtime/package-lock.json');
const common = readFileSync(join(root, 'plugins/swsd/scripts/Common.ps1'), 'utf8');
const plugin = readJson('plugins/swsd/.codex-plugin/plugin.json');
const mcpConfig = readFileSync(join(root, 'plugins/swsd/.mcp.json'), 'utf8');

const psVar = (name: string): string | undefined =>
  new RegExp(`\\$script:${name} = '([^']+)'`).exec(common)?.[1];

describe('Windows plugin runtime version', () => {
  it('pins the runtime recipe to the server package version', () => {
    expect(recipe.dependencies['swsd-mcp']).toBe(serverVersion);
    expect(recipe.version).toBe(serverVersion);
  });

  it('locks exactly the server package version', () => {
    expect(lock.packages[''].dependencies['swsd-mcp']).toBe(serverVersion);
    expect(lock.packages['node_modules/swsd-mcp'].version).toBe(serverVersion);
  });

  it('keeps the setup script expectation in step', () => {
    expect(psVar('SwsdPackageVersion')).toBe(serverVersion);
  });

  it('does not override the MCP SDK back to v1', () => {
    expect(recipe.overrides?.['@modelcontextprotocol/sdk']).toBeUndefined();
    expect(lock.packages['node_modules/@modelcontextprotocol/sdk']).toBeUndefined();
    expect(lock.packages['node_modules/@modelcontextprotocol/server']?.version).toMatch(/^2\./);
  });

  it('keeps the plugin client version consistent across manifest, launcher and setup', () => {
    const client = psVar('SwsdClientVersion');
    expect(plugin.version).toBe(client);
    expect(mcpConfig).toContain(`swsd-mcp/client/${client}/Start-Swsd.ps1`);
  });
});
