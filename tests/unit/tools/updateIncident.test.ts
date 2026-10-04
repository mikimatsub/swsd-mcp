import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerUpdateIncident } from '../../../src/tools/incidents/updateIncident.js';
import {
  makeFakeClient,
  makeCtx,
  getRegisteredTool,
  type FakeClient,
  type RegisteredToolInternals,
} from './_helpers/mockClient.js';

describe('swsd_update_incident — id_or_number resolution', () => {
  let server: McpServer;
  let client: FakeClient;
  let tool: RegisteredToolInternals;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    client = makeFakeClient();
    registerUpdateIncident(server, makeCtx(client));
    tool = getRegisteredTool(server, 'swsd_update_incident');
  });

  it('accepts a number reference and resolves to id before updating', async () => {
    client.setLookupBody([{ id: 180457930, number: 60310 }]);
    client.setPutResponse({ id: 180457930, number: 60310, name: 'Renamed' });

    await tool.handler({ id: 60310, name: 'Renamed' }, {});

    // 1) Resolver lookup against /incidents.json
    const lookup = client.calls.find((c) => c.type === 'get');
    expect(lookup?.path).toBe('/incidents.json');
    expect(lookup?.type === 'get' ? lookup.params : {}).toMatchObject({ query: 60310 });

    // 2) PUT must hit the resolved id, NOT the input number
    const put = client.calls.find((c) => c.type === 'put');
    expect(put?.path).toBe('/incidents/180457930.json');
  });

  it('passes 9-digit ids through without lookup', async () => {
    client.setPutResponse({ id: 180457930, number: 60310, name: 'Renamed' });

    await tool.handler({ id: 180457930, name: 'Renamed' }, {});

    // No GET /incidents.json lookup for id-sized input.
    const lookup = client.calls.find(
      (c) => c.type === 'get' && c.path === '/incidents.json',
    );
    expect(lookup).toBeUndefined();

    // PUT goes directly to the id.
    const put = client.calls.find((c) => c.type === 'put');
    expect(put?.path).toBe('/incidents/180457930.json');
  });
});
