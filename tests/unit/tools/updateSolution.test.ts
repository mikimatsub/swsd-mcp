import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerUpdateSolution } from '../../../src/tools/solutions/updateSolution.js';
import {
  makeFakeClient,
  makeCtx,
  getRegisteredTool,
  type FakeClient,
  type RegisteredToolInternals,
} from './_helpers/mockClient.js';

describe('swsd_update_solution — id_or_number resolution', () => {
  let server: McpServer;
  let client: FakeClient;
  let tool: RegisteredToolInternals;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    client = makeFakeClient();
    registerUpdateSolution(server, makeCtx(client));
    tool = getRegisteredTool(server, 'swsd_update_solution');
  });

  it('accepts a 3-4-digit number reference and resolves to id before updating', async () => {
    client.setLookupBody([{ id: 1849839, number: 397 }]);
    client.setPutResponse({ id: 1849839, number: 397, name: 'Renamed' });

    await tool.handler({ id: 397, name: 'Renamed' }, {});

    // 1) Resolver lookup against /solutions.json
    const lookup = client.calls.find((c) => c.type === 'get');
    expect(lookup?.path).toBe('/solutions.json');
    expect(lookup?.type === 'get' ? lookup.params : {}).toMatchObject({ query: 397 });

    // 2) PUT must hit the resolved id, NOT the input number
    const put = client.calls.find((c) => c.type === 'put');
    expect(put?.path).toBe('/solutions/1849839.json');
  });

  it('passes 7+-digit ids through without lookup', async () => {
    client.setPutResponse({ id: 1849839, number: 397, name: 'Renamed' });

    await tool.handler({ id: 1849839, name: 'Renamed' }, {});

    // No GET /solutions.json lookup for id-sized input.
    const lookup = client.calls.find(
      (c) => c.type === 'get' && c.path === '/solutions.json',
    );
    expect(lookup).toBeUndefined();

    // PUT goes directly to the id.
    const put = client.calls.find((c) => c.type === 'put');
    expect(put?.path).toBe('/solutions/1849839.json');
  });
});
