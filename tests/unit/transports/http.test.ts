import { once } from 'node:events';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { openSync, readSync, realpathSync } from 'node:fs';
import type * as FsModule from 'node:fs';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import * as config from '../../../src/config/env.js';
import { runHttp } from '../../../src/transports/http.js';

vi.mock('node:fs', async (importOriginal) => ({
  ...await importOriginal<typeof FsModule>(),
  realpathSync: vi.fn(() => 'synthetic.txt'),
  openSync: vi.fn(() => 123),
  fstatSync: vi.fn(() => ({ size: 9, isFile: () => true })),
  readSync: vi.fn((_fd, buffer: Buffer, offset: number, length: number, position: number) => {
    if (position >= 9) return 0;
    Buffer.from('synthetic').copy(buffer, offset, position, position + length);
    return length;
  }),
  closeSync: vi.fn(),
}));

const TOKEN = 'SYNTHETIC_TOKEN';
const servers: Server[] = [];
const originalListen = express.application.listen;
const toolCall = (name = 'swsd_get_server_info', args: Record<string, unknown> = {}) => JSON.stringify({
  jsonrpc: '2.0', id: 1234567, method: 'tools/call', params: { name, arguments: args },
});

async function start(overrides: Record<string, unknown> = {}): Promise<Server> {
  await runHttp(config.EnvSchema.parse({ SWSD_PROFILE: 'operations', SWSD_RETRY_MAX_ATTEMPTS: 0, ...overrides }));
  const server = servers.at(-1)!;
  if (!server.listening) await once(server, 'listening');
  return server;
}

async function post(server: Server, body = toolCall(), headers: Record<string, string> = {}) {
  return new Promise<{ status: number; text: string; contentType: string }>((resolve, reject) => {
    const req = request({
      hostname: '127.0.0.1', port: (server.address() as AddressInfo).port, path: '/mcp', method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json',
        accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25', ...headers,
      },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode!, text, contentType: res.headers['content-type'] ?? '' }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(body);
  });
}

function rpcResult(text: string) {
  const data = text.split('\n').find((line) => line.startsWith('data: '));
  return (JSON.parse(data ? data.slice(6) : text) as { result: Record<string, unknown> }).result;
}

beforeEach(() => {
  vi.spyOn(express.application, 'listen').mockImplementation(function (this: express.Express) {
    const server = originalListen.call(this, 0, '127.0.0.1');
    servers.push(server);
    return server;
  });
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"id":1234567}', {
    headers: { 'content-type': 'application/json' },
  })));
  vi.mocked(openSync).mockClear();
  vi.mocked(readSync).mockClear();
  vi.mocked(realpathSync).mockClear();
});

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('HTTP security boundary', () => {
  const attachment = toolCall('swsd_upload_attachment', {
    parent_type: 'incidents', parent_id: 1234567, file_name: 'synthetic.txt', file_path: 'synthetic.txt',
  });

  it.each(['http', 'stdio'])('rejects file_path before any filesystem access with input transport %s', async (transport) => {
    const result = await post(await start({ SWSD_TRANSPORT: transport }), attachment);
    expect(result.status).toBe(200);
    expect(rpcResult(result.text)).toMatchObject({ isError: true, content: [{ type: 'text', text: expect.stringContaining('file_path') }] });
    expect(realpathSync).not.toHaveBeenCalled();
    expect(openSync).not.toHaveBeenCalled();
    expect(readSync).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('CLI-selected HTTP rejects file_path before any filesystem access', async () => {
    vi.spyOn(config, 'parseEnv').mockReturnValue(config.EnvSchema.parse({ SWSD_PROFILE: 'operations' }));
    const argv = process.argv;
    try {
      process.argv = ['node', 'swsd-mcp', '--transport=http'];
      await import('../../../src/cli.js');
      const server = servers.at(-1)!;
      if (!server.listening) await once(server, 'listening');
      const result = await post(server, attachment);
      expect(rpcResult(result.text)).toMatchObject({ isError: true });
      expect(realpathSync).not.toHaveBeenCalled();
      expect(openSync).not.toHaveBeenCalled();
      expect(readSync).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      process.argv = argv;
    }
  });

  it('shares a quota across Bearer casing and surrounding token spaces', async () => {
    const server = await start({ SWSD_RATE_LIMIT_MAX: 2 });
    expect((await post(server)).status).toBe(200);
    expect((await post(server, toolCall(), { authorization: `bearer   ${TOKEN}` })).status).toBe(200);
    expect((await post(server, toolCall(), { authorization: `BEARER ${TOKEN}` })).status).toBe(429);
  });

  it('shares the X-SWSD-Token quota when ignored Authorization rotates', async () => {
    const server = await start({ SWSD_RATE_LIMIT_MAX: 2 });
    for (const [i, status] of [200, 200, 429].entries()) {
      expect((await post(server, toolCall(), { authorization: `ignored-${i}`, 'x-swsd-token': TOKEN })).status).toBe(status);
    }
  });

  it('uses one IP bucket for missing and invalid credentials before parsing JSON', async () => {
    const server = await start({ SWSD_RATE_LIMIT_MAX: 2 });
    for (const [authorization, status] of [['', 401], ['Bearer SYNTHETIC TOKEN', 401], ['ignored', 429]] as const) {
      expect((await post(server, '{invalid', { authorization })).status).toBe(status);
    }
  });

  it.each(['http://attacker.example.test', 'null', '', 'http://localhost.attacker.example.test', 'ftp://localhost', 'http://localhost/path', 'http://user@localhost'])('rejects untrusted Origin %s by default', async (origin) => {
    const result = await post(await start(), toolCall(), { origin });
    expect(result.status).toBe(403);
    expect(result.text).toBe('{"error":"Origin not allowed."}');
  });

  it.each(['http://localhost', 'https://localhost:12345', 'http://127.0.0.1:12345', 'https://[::1]:12345'])('accepts loopback Origin %s', async (origin) => {
    expect((await post(await start(), toolCall(), { origin })).status).toBe(200);
  });

  it('honors an explicit Origin allowlist and permits requests without Origin', async () => {
    const server = await start({ SWSD_ALLOWED_ORIGINS: 'https://mcp.example.test' });
    expect((await post(server, toolCall(), { origin: 'https://mcp.example.test' })).status).toBe(200);
    expect((await post(server, toolCall(), { origin: 'http://localhost' })).status).toBe(403);
    expect((await post(server)).status).toBe(200);
  });

  it('validates exact Host headers only when SWSD_ALLOWED_HOSTS is configured', async () => {
    const server = await start({ SWSD_ALLOWED_HOSTS: 'mcp.example.test, localhost:12345' });
    expect((await post(server, toolCall(), { host: 'mcp.example.test' })).status).toBe(200);
    expect((await post(server, toolCall(), { host: 'localhost:12345', origin: 'http://localhost:43210' })).status).toBe(200);
    for (const host of ['attacker.example.test', 'localhost:54321', '']) {
      const result = await post(server, toolCall(), { host });
      expect(result.status).toBe(403);
      expect(result.text).toBe('{"error":"Host not allowed."}');
    }
    expect((await post(await start(), toolCall(), { host: 'mcp.example.test' })).status).toBe(200);
    expect(express.application.listen).toHaveBeenCalledWith(3000, expect.any(Function));
  });

  it.each([
    ['malformed JSON', '{"SYNTHETIC_BODY":', 400, 'INVALID_JSON', 'Malformed JSON request.'],
    ['oversized JSON', JSON.stringify({ SYNTHETIC_BODY: 'x'.repeat(4 * 1024 * 1024) }), 413, 'PAYLOAD_TOO_LARGE', 'Request payload too large.'],
  ])('returns bounded generic JSON and safe logs for %s', async (_name, body, status, code, message) => {
    const server = await start();
    const result = await post(server, body as string);
    expect(result.status).toBe(status);
    expect(result.contentType).toContain('application/json');
    expect(JSON.parse(result.text)).toEqual({ error: { code, message } });
    expect(result.text.length).toBeLessThan(150);
    const log = vi.mocked(process.stderr.write).mock.calls.map(([text]) => String(text)).join('');
    expect(log).toBe(`HTTP request failed: ${JSON.stringify({ status, code })}\n`);
    expect(log).not.toContain('SYNTHETIC_BODY');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns generic JSON and safe metadata for unexpected handler errors', async () => {
    vi.spyOn(McpServer.prototype, 'connect').mockRejectedValueOnce(new Error(`SYNTHETIC_BODY ${TOKEN}`));
    const result = await post(await start());
    expect(result.status).toBe(500);
    expect(JSON.parse(result.text)).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' } });
    expect(vi.mocked(process.stderr.write).mock.calls).toEqual([['HTTP request failed: {"status":500,"code":"INTERNAL_ERROR"}\n']]);
  });

  it('redacts nested detail credentials and the active token in content and structuredContent', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      id: 1234567, name: `Synthetic ${TOKEN}`, nested: [{ Authorization: 'Basic SYNTHETIC_CREDENTIAL',
        'X-SWSD-Token': 'SYNTHETIC_OTHER', clientSecret: 'SYNTHETIC_SECRET', plain: TOKEN }],
    }), { headers: { 'content-type': 'application/json' } }));
    const result = await post(await start(), toolCall('swsd_get_incident', { id: 1234567 }));
    expect(result.status).toBe(200);
    expect(rpcResult(result.text)).toMatchObject({
      content: [{ type: 'text', text: 'Incident 1234567: Synthetic [REDACTED]' }],
      structuredContent: { incident: { nested: [{ Authorization: '[REDACTED]', 'X-SWSD-Token': '[REDACTED]', clientSecret: '[REDACTED]', plain: '[REDACTED]' }] } },
    });
    expect(result.text).not.toMatch(/SYNTHETIC_(?:TOKEN|CREDENTIAL|OTHER|SECRET)/);
  });

  it('redacts active tokens from dry-run output independently for concurrent HTTP callers', async () => {
    const server = await start({ SWSD_WRITE_MODE: 'dry-run' });
    await Promise.all([TOKEN, 'SYNTHETIC_SECOND_TOKEN'].map(async (token) => {
      const result = await post(server, toolCall('swsd_upload_attachment', {
        parent_type: 'incidents', parent_id: 1234567, file_name: `${token}.txt`,
        content_base64: Buffer.from('synthetic').toString('base64'),
      }), { authorization: `Bearer ${token}` });
      expect(result.status).toBe(200);
      expect(rpcResult(result.text)).toMatchObject({
        content: [{ type: 'text', text: expect.stringContaining('[REDACTED].txt') }],
        structuredContent: { dry_run: true, request: { body: { file: { attachment: { file_name: '[REDACTED].txt' } } } } },
      });
      expect(result.text).not.toContain(token);
    }));
    expect(fetch).not.toHaveBeenCalled();
  });
});
