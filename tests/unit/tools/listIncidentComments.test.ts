import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerListIncidentComments } from '../../../src/tools/comments/listIncidentComments.js';
import {
  makeFakeClient,
  makeCtx,
  getRegisteredTool,
  type FakeClient,
  type RegisteredToolInternals,
} from './_helpers/mockClient.js';

describe('swsd_list_incident_comments — id_or_number resolution', () => {
  let server: McpServer;
  let client: FakeClient;
  let tool: RegisteredToolInternals;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    client = makeFakeClient();
    registerListIncidentComments(server, makeCtx(client));
    tool = getRegisteredTool(server, 'swsd_list_incident_comments');
  });

  it('resolves a 5-digit number reference to id before listing comments', async () => {
    client.setBodyForPath(
      (p) => p === '/incidents.json',
      [{ id: 180457930, number: 60310 }],
    );
    client.setBodyForPath(
      (p) => p === '/incidents/180457930/comments.json',
      [],
    );

    await tool.handler({ incident_id: 60310, page: 1, per_page: 25 }, {});

    const lookup = client.calls.find((c) => c.path === '/incidents.json');
    expect(lookup).toBeDefined();
    expect(lookup?.type === 'get' ? lookup.params : {}).toMatchObject({
      query: 60310,
    });

    const list = client.calls.find(
      (c) => c.path === '/incidents/180457930/comments.json',
    );
    expect(list).toBeDefined();
  });
});
