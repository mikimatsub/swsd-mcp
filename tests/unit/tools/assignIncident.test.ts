import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerAssignIncident } from '../../../src/tools/incidents/assignIncident.js';
import {
  makeFakeClient,
  makeCtx,
  getRegisteredTool,
  type FakeClient,
  type RegisteredToolInternals,
} from './_helpers/mockClient.js';

describe('swsd_assign_incident — id_or_number resolution', () => {
  let server: McpServer;
  let client: FakeClient;
  let tool: RegisteredToolInternals;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    client = makeFakeClient();
    registerAssignIncident(server, makeCtx(client));
    tool = getRegisteredTool(server, 'swsd_assign_incident');
  });

  it('resolves a 5-digit number reference to id before PUTing', async () => {
    client.setLookupBody([{ id: 180457930, number: 60310 }]);
    client.setPutResponse({ id: 180457930, number: 60310 });

    await tool.handler({ id: 60310, assignee_email: 'agent@example.com' }, {});

    const lookup = client.calls.find((c) => c.type === 'get');
    expect(lookup?.path).toBe('/incidents.json');
    expect(lookup?.type === 'get' ? lookup.params : {}).toMatchObject({
      query: 60310,
    });

    const put = client.calls.find((c) => c.type === 'put');
    expect(put?.path).toBe('/incidents/180457930.json');
  });
});
