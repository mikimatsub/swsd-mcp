import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The Windows plugin installs the *published* swsd-mcp package, so its runtime
// pin must equal the latest version on npm (not the root version, which can be
// ahead during a release PR). The registry check needs network access; set
// SWSD_OFFLINE=1 to skip it. When npm is unreachable it degrades to offline
// checks: the pin is a registry-resolved exact version not ahead of the root.

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
const pin = recipe.dependencies['swsd-mcp'] as string;

const psVar = (name: string): string | undefined =>
  new RegExp(`\\$script:${name} = '([^']+)'`).exec(common)?.[1];

const semver = /^(\d+)\.(\d+)\.(\d+)$/;
const compare = (a: string, b: string): number => {
  const pa = semver.exec(a)!.slice(1).map(Number);
  const pb = semver.exec(b)!.slice(1).map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
};

type Registry = { latest: string; versions: string[] } | undefined;
const fetchRegistry = async (): Promise<Registry> => {
  if (process.env.SWSD_OFFLINE) return undefined;
  try {
    const response = await fetch('https://registry.npmjs.org/swsd-mcp', {
      headers: { accept: 'application/vnd.npm.install-v1+json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as Json;
    return { latest: body['dist-tags'].latest as string, versions: Object.keys(body.versions) };
  } catch {
    return undefined;
  }
};
const registry = await fetchRegistry();
if (!registry) console.warn('npm registry unreachable or SWSD_OFFLINE set; skipping published-version check.');

describe('Windows plugin runtime version', () => {
  it('pins an exact version that is not ahead of the server package', () => {
    expect(pin).toMatch(semver);
    expect(recipe.version).toBe(pin);
    expect(compare(pin, serverVersion)).toBeLessThanOrEqual(0);
  });

  it('locks exactly the pinned version from the npm registry', () => {
    expect(lock.packages[''].dependencies['swsd-mcp']).toBe(pin);
    const locked = lock.packages['node_modules/swsd-mcp'];
    expect(locked.version).toBe(pin);
    expect(locked.resolved).toBe(`https://registry.npmjs.org/swsd-mcp/-/swsd-mcp-${pin}.tgz`);
    expect(locked.integrity).toMatch(/^sha512-/);
  });

  it('keeps the setup script expectation in step with the pin', () => {
    expect(psVar('SwsdPackageVersion')).toBe(pin);
  });

  it.skipIf(!registry)('pins the latest published swsd-mcp version', () => {
    expect(registry!.versions).toContain(pin);
    expect(pin).toBe(registry!.latest);
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
