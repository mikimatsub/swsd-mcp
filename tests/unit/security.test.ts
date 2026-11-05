import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CallToolResult, Transport } from '@modelcontextprotocol/server';
import { EnvSchema } from '../../src/config/env.js';
import { createSwsdClient } from '../../src/swsd/client.js';
import { mapSwsdError, SwsdNetworkError } from '../../src/swsd/errors.js';
import { structuredResult } from '../../src/mcp/output.js';
import { redactSecrets, redactTransport, INVALID_TOKEN_MESSAGE } from '../../src/utils/secrets.js';

const TOKEN = 'SYNTHETIC_TOKEN';
const env = EnvSchema.parse({ SWSD_RETRY_MAX_ATTEMPTS: 0 });

afterEach(() => { vi.unstubAllGlobals(); });

describe('credential redaction', () => {
  it.each(['SYNTHETIC_TOKEN\nBAD', 'SYNTHETIC TOKEN', ' SYNTHETIC_TOKEN', 'SYNTHETIC_TOKEN\t', 'SYNTHETIC_TOKEN\u0000', 'SYNTHETIC_TOKEN\u007f', 'SYNTHETIC_TOKEN\u0085'])('rejects malformed tokens before fetch with a fixed non-echoing error (%j)', async (token) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = createSwsdClient({ env, token });
    const result = await client.get('/incidents/1234567.json').catch(mapSwsdError);
    expect(result).toEqual({ isError: true, content: [{ type: 'text', text: `Unexpected error: ${INVALID_TOKEN_MESSAGE}` }] });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([400, 404, 422, 500])('redacts reflected credentials in upstream HTTP %i error bodies', async (status) => {
    for (const json of [true, false]) {
      const body = { errors: { description: [TOKEN], nested: [{ aUtHoRiZaTiOn: 'Basic SYNTHETIC_AUTH', 'x-SwSd-ToKeN': 'SYNTHETIC_OTHER', password: 'SYNTHETIC_PASSWORD', clientSecret: 'SYNTHETIC_SECRET' }] } };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
        json ? JSON.stringify(body) : `Echo ${TOKEN}\nAuthorization: Basic SYNTHETIC_AUTH\nX-SWSD-Token: SYNTHETIC_OTHER\nPassword=SYNTHETIC_PASSWORD\nclientSecret: SYNTHETIC_SECRET`,
        { status, headers: { 'content-type': json ? 'application/json' : 'text/plain' } },
      )));
      const client = createSwsdClient({ env, token: TOKEN });
      let error: unknown;
      try { await client.get('/incidents/1234567.json'); } catch (err) { error = err; }
      const result = mapSwsdError(error);
      expect(result.isError).toBe(true);
      expect(JSON.stringify({ error, result })).not.toMatch(/SYNTHETIC_(?:TOKEN|AUTH|OTHER|PASSWORD|SECRET)/);
      expect(JSON.stringify(result)).toContain('[REDACTED]');
    }
  });

  it('sanitizes network messages and their retained causes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(`Connection ${TOKEN}; Authorization: Bearer SYNTHETIC_OTHER`)));
    const client = createSwsdClient({ env, token: TOKEN });
    try {
      await client.get('/incidents/1234567.json');
      expect.unreachable('expected network failure');
    } catch (err) {
      expect(err).toBeInstanceOf(SwsdNetworkError);
      const error = err as SwsdNetworkError;
      expect(error.message).toContain('[REDACTED]');
      expect(error.message).not.toContain('SYNTHETIC_');
      expect(String(error.cause)).not.toContain('SYNTHETIC_');
      expect(JSON.stringify(mapSwsdError(error))).not.toContain('SYNTHETIC_');
    }
  });

  it('redacts case-insensitive secret-like keys nested in arrays and serialized JSON', () => {
    const value = { harmless: 'keep', nested: [{ AUTHORIZATION: 'SYNTHETIC_AUTH', Bearer: 'SYNTHETIC_BEARER',
      'X-SWSD-Token': 'SYNTHETIC_OTHER', access_token: 'SYNTHETIC_ACCESS', Password: 'SYNTHETIC_PASSWORD',
      clientSecret: { value: 'SYNTHETIC_SECRET' }, apiKey: 'SYNTHETIC_KEY', echo: TOKEN }] };
    const redacted = redactSecrets(value, TOKEN);
    expect(redacted.harmless).toBe('keep');
    expect(Object.values(redacted.nested[0]!)).toEqual(Array(8).fill('[REDACTED]'));
    expect(JSON.parse(redactSecrets(JSON.stringify(value), TOKEN))).toEqual(redacted);
    expect(value.nested[0]?.echo).toBe(TOKEN);
  });

  it('sanitizes structuredResult credential fields before protocol output', () => {
    expect(structuredResult({ nested: [{ Authorization: 'SYNTHETIC_AUTH' }] }, 'Bearer SYNTHETIC_OTHER'))
      .toEqual({ content: [{ type: 'text', text: 'Bearer [REDACTED]' }], structuredContent: { nested: [{ Authorization: '[REDACTED]' }] } });
  });

  it('redacts unexpected errors and both result forms per transport without changing RPC ids', async () => {
    for (const token of [TOKEN, 'SYNTHETIC_SECOND_TOKEN']) {
      const send = vi.fn().mockResolvedValue(undefined);
      const transport = redactTransport({ send } as unknown as Transport, token);
      const result: CallToolResult = { content: [{ type: 'text', text: `Echo ${token}` }], structuredContent: { echo: token, nested: [{ AUTHORIZATION: 'SYNTHETIC_OTHER' }] } };
      await transport.send({ jsonrpc: '2.0', id: token, result });
      expect(send.mock.calls[0]?.[0]).toEqual({ jsonrpc: '2.0', id: token, result: {
        content: [{ type: 'text', text: 'Echo [REDACTED]' }], structuredContent: { echo: '[REDACTED]', nested: [{ AUTHORIZATION: '[REDACTED]' }] },
      } });
      await transport.send({ jsonrpc: '2.0', id: 1234567, result: mapSwsdError(new Error(`Unexpected ${token}`)) });
      await transport.send({ jsonrpc: '2.0', id: 1234567, error: { code: -32603, message: `Unexpected ${token}` } });
      expect(JSON.stringify(send.mock.calls.slice(1))).not.toContain(token);
      expect(result.structuredContent?.echo).toBe(token);
    }
  });
});
