import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerGetIncident } from '../../../src/tools/incidents/getIncident.js';
import {
  makeFakeClient,
  makeCtx,
  getRegisteredTool,
  type FakeClient,
  type RegisteredToolInternals,
} from './_helpers/mockClient.js';

describe('swsd_get_incident — id_or_number resolution', () => {
  let server: McpServer;
  let client: FakeClient;
  let tool: RegisteredToolInternals;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    client = makeFakeClient();
    registerGetIncident(server, makeCtx(client));
    tool = getRegisteredTool(server, 'swsd_get_incident');
  });

  it('accepts a number reference and resolves to id before fetching', async () => {
    // The user passes the human-facing 5-digit number 60310. The resolver
    // must issue GET /incidents.json?query=60310 and then the actual fetch
    // must hit /incidents/180457930.json (the resolved id), NOT
    // /incidents/60310.json (which would 404 — see SWSD quirk in MEMORY.md).
    client.setBodyForPath(
      (p) => p === '/incidents.json',
      [{ id: 180457930, number: 60310, name: 'Sample ticket' }],
    );
    client.setBodyForPath(
      (p) => p === '/incidents/180457930.json',
      { id: 180457930, number: 60310, name: 'Sample ticket' },
    );

    await tool.handler({ id: 60310, detail_level: 'short' }, {});

    // 1) Resolver lookup — query=60310 against /incidents.json
    const lookup = client.calls[0];
    expect(lookup?.path).toBe('/incidents.json');
    expect(lookup?.type === 'get' ? lookup.params : {}).toMatchObject({ query: 60310 });

    // 2) Actual fetch — uses the RESOLVED 9-digit id, not the input number
    const fetched = client.calls[1];
    expect(fetched?.path).toBe('/incidents/180457930.json');
  });

  it('passes 9-digit ids through without lookup', async () => {
    // The user passes 180457930 directly — this is already an id (>=7 digits)
    // and should hit /incidents/180457930.json with NO preliminary lookup.
    client.setBodyForPath(
      (p) => p === '/incidents/180457930.json',
      { id: 180457930, number: 60310, name: 'Sample ticket' },
    );

    await tool.handler({ id: 180457930, detail_level: 'short' }, {});

    // No /incidents.json lookup should happen for an id-sized input.
    const lookup = client.calls.find((c) => c.path === '/incidents.json');
    expect(lookup).toBeUndefined();

    // Single direct fetch.
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.path).toBe('/incidents/180457930.json');
  });
});
