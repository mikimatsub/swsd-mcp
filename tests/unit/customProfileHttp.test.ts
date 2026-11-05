import { once } from 'node:events';
import { request, type Server } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnvSchema } from '../../src/config/env.js';
import { runHttp } from '../../src/transports/http.js';

const originalListen = express.application.listen;
let server: Server | undefined;
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'swsd-profile-http-'));
  vi.spyOn(express.application, 'listen').mockImplementation(function (this: express.Express) {
    server = originalListen.call(this, 0, '127.0.0.1');
    return server;
  });
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
});
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    server = undefined;
  }
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

async function listTools(): Promise<string[]> {
  const response = await new Promise<string>((resolve, reject) => {
    const req = request({
      hostname: '127.0.0.1', port: (server!.address() as AddressInfo).port, path: '/mcp', method: 'POST',
      headers: { authorization: 'Bearer SYNTHETIC_TOKEN', 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { text += chunk; });
      res.on('end', () => res.statusCode === 200 ? resolve(text) : reject(new Error(`HTTP ${res.statusCode}: ${text}`)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
  });
  const data = response.split('\n').find(line => line.startsWith('data: '));
  const parsed = JSON.parse(data ? data.slice(6) : response) as { result: { tools: { name: string }[] } };
  return parsed.result.tools.map(tool => tool.name);
}

describe('custom profile HTTP startup', () => {
  it.each([
    {}, { SWSD_TOOLS: 'swsd_typo' }, { SWSD_PROFILE_FILE: 'missing-synthetic-profile.json' },
  ])('rejects invalid selection before listening: %j', async overrides => {
    await expect(runHttp(EnvSchema.parse({ SWSD_PROFILE: 'custom', ...overrides }))).rejects.toThrow(/Custom profile has no valid tools|Invalid SWSD_PROFILE_FILE/);
    expect(express.application.listen).not.toHaveBeenCalled();
  });

  it('reads and validates the file once at startup, before any requests', async () => {
    const path = join(dir, 'profile.json');
    writeFileSync(path, JSON.stringify({ name: 'Synthetic HTTP', version: 1, tools: ['swsd_get_server_info', 'swsd_typo'] }));
    await runHttp(EnvSchema.parse({ SWSD_PROFILE: 'custom', SWSD_PROFILE_FILE: path, SWSD_TOOLS: 'swsd_health_check' }));
    if (!server!.listening) await once(server!, 'listening');
    expect(process.stderr.write).toHaveBeenCalledWith('Unknown custom profile tools (skipped): "swsd_typo"\n');
    writeFileSync(path, 'invalid JSON after startup');
    expect(await listTools()).toEqual(['swsd_health_check', 'swsd_get_server_info']);
    expect(await listTools()).toEqual(['swsd_health_check', 'swsd_get_server_info']);
    const warnings = vi.mocked(process.stderr.write).mock.calls.filter(([message]) => String(message).includes('Unknown custom profile'));
    expect(warnings).toHaveLength(1);
  });
});
