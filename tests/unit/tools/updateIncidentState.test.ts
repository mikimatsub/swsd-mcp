import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerUpdateIncidentState } from '../../../src/tools/incidents/updateIncidentState.js';
import {
  makeFakeClient,
  makeCtx,
  getRegisteredTool,
  type FakeClient,
  type RegisteredToolInternals,
} from './_helpers/mockClient.js';

describe('swsd_update_incident_state — id_or_number resolution', () => {
  let server: McpServer;
  let client: FakeClient;
  let tool: RegisteredToolInternals;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    client = makeFakeClient();
    registerUpdateIncidentState(server, makeCtx(client));
    tool = getRegisteredTool(server, 'swsd_update_incident_state');
  });

  it('resolves a 5-digit number reference to id before PUTing the state change', async () => {
    client.setLookupBody([{ id: 180457930, number: 60310 }]);
    client.setPutResponse({ id: 180457930, number: 60310, state: 'Resolved' });

    await tool.handler({ id: 60310, state: 'Resolved' }, {});

    const lookup = client.calls.find((c) => c.type === 'get');
    expect(lookup?.path).toBe('/incidents.json');
    expect(lookup?.type === 'get' ? lookup.params : {}).toMatchObject({
      query: 60310,
    });

    const put = client.calls.find((c) => c.type === 'put');
    expect(put?.path).toBe('/incidents/180457930.json');
  });
});
