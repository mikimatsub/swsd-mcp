import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerGetSolution } from '../../../src/tools/solutions/getSolution.js';
import {
  makeFakeClient,
  makeCtx,
  getRegisteredTool,
  type FakeClient,
  type RegisteredToolInternals,
} from './_helpers/mockClient.js';

describe('swsd_get_solution — id_or_number resolution', () => {
  let server: McpServer;
  let client: FakeClient;
  let tool: RegisteredToolInternals;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    client = makeFakeClient();
    registerGetSolution(server, makeCtx(client));
    tool = getRegisteredTool(server, 'swsd_get_solution');
  });

  it('accepts a 3-4-digit number reference and resolves to id before fetching', async () => {
    // The user passes the human-facing solution number 397. The resolver must
    // issue GET /solutions.json?query=397 and the actual fetch must hit
    // /solutions/1849839.json (the resolved id), NOT /solutions/397.json.
    client.setBodyForPath(
      (p) => p === '/solutions.json',
      [{ id: 1849839, number: 397, name: 'KB article' }],
    );
    client.setBodyForPath(
      (p) => p === '/solutions/1849839.json',
      { id: 1849839, number: 397, name: 'KB article' },
    );

    await tool.handler({ id: 397, detail_level: 'short' }, {});

    // 1) Resolver lookup — query=397 against /solutions.json
    const lookup = client.calls[0];
    expect(lookup?.path).toBe('/solutions.json');
    expect(lookup?.type === 'get' ? lookup.params : {}).toMatchObject({ query: 397 });

    // 2) Actual fetch — uses the RESOLVED id, not the input number
    const fetched = client.calls[1];
    expect(fetched?.path).toBe('/solutions/1849839.json');
  });

  it('passes 7+-digit ids through without lookup', async () => {
    // 1849839 is already an id (>=7 digits) — resolver short-circuits.
    client.setBodyForPath(
      (p) => p === '/solutions/1849839.json',
      { id: 1849839, number: 397, name: 'KB article' },
    );

    await tool.handler({ id: 1849839, detail_level: 'short' }, {});

    // No /solutions.json lookup should happen for an id-sized input.
    const lookup = client.calls.find((c) => c.path === '/solutions.json');
    expect(lookup).toBeUndefined();

    // Single direct fetch.
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.path).toBe('/solutions/1849839.json');
  });
});
