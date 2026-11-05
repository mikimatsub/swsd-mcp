import { mkdirSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', () => ({ mkdirSync: vi.fn(), writeFileSync: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('SWSD_TOKEN', 'SYNTHETIC_TOKEN');
  vi.stubEnv('SWSD_BASE_URL', 'https://api.samanage.com');
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  vi.spyOn(process, 'exit').mockReturnValue(undefined as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function runDump(): Promise<string> {
  await import('../../../scripts/dump-custom-fields.js');
  // The entry point starts main asynchronously and catches its own failures.
  await vi.waitFor(() => expect(process.exit).toHaveBeenCalled());
  await new Promise<void>((resolve) => setImmediate(resolve));
  return vi.mocked(process.stderr.write).mock.calls.map(([text]) => String(text)).join('') +
    vi.mocked(process.stdout.write).mock.calls.map(([text]) => String(text)).join('');
}

describe('custom-field dump diagnostics', () => {
  it('rejects a newline token before fetch without printing it', async () => {
    vi.stubEnv('SWSD_TOKEN', 'SYNTHETIC_TOKEN\nBAD');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('SYNTHETIC_TOKEN\nBAD')));
    const output = await runDump();
    expect(fetch).not.toHaveBeenCalled();
    expect(output).toBe('Custom-field dump failed. Check configuration and network connectivity.\n');
    expect(mkdirSync).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('prints status only for an upstream failure without reading or printing its body', async () => {
    const response = new Response('Authorization: Bearer SYNTHETIC_TOKEN', { status: 400 });
    const readBody = vi.spyOn(response, 'text');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    const output = await runDump();
    expect(output).toContain('Custom-field request failed (HTTP 400).');
    expect(output).not.toContain('SYNTHETIC_TOKEN');
    expect(readBody).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('never prints a raw thrown network message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('SYNTHETIC_TOKEN password=SYNTHETIC_PASSWORD')));
    const output = await runDump();
    expect(output).toContain('Custom-field dump failed.');
    expect(output).not.toContain('SYNTHETIC_');
  });
});
