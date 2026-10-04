import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerAddIncidentComment } from '../../../src/tools/comments/addIncidentComment.js';
import {
  makeFakeClient,
  makeCtx,
  getRegisteredTool,
  type FakeClient,
  type RegisteredToolInternals,
} from './_helpers/mockClient.js';

describe('swsd_add_incident_comment — id_or_number resolution', () => {
  let server: McpServer;
  let client: FakeClient;
  let tool: RegisteredToolInternals;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    client = makeFakeClient();
    registerAddIncidentComment(server, makeCtx(client));
    tool = getRegisteredTool(server, 'swsd_add_incident_comment');
  });

  it('accepts a number reference and resolves to id before posting', async () => {
    client.setLookupBody([{ id: 180457930, number: 60310 }]);
    client.setPostResponse({ id: 88888, body: 'Hello!', is_private: false });

    await tool.handler({ incident_id: 60310, body: 'Hello!', is_private: false }, {});

    // 1) Resolver lookup
    const lookup = client.calls.find((c) => c.type === 'get');
    expect(lookup?.path).toBe('/incidents.json');
    expect(lookup?.type === 'get' ? lookup.params : {}).toMatchObject({
      query: 60310,
    });

    // 2) POST hits the RESOLVED id's comments endpoint
    const post = client.calls.find((c) => c.type === 'post');
    expect(post?.path).toBe('/incidents/180457930/comments.json');
  });

  it('passes 9-digit ids through without lookup', async () => {
    client.setPostResponse({ id: 88888, body: 'Hello!', is_private: false });

    await tool.handler(
      { incident_id: 180457930, body: 'Hello!', is_private: false },
      {},
    );

    // No /incidents.json GET should happen.
    const lookup = client.calls.find(
      (c) => c.type === 'get' && c.path === '/incidents.json',
    );
    expect(lookup).toBeUndefined();

    // POST goes directly.
    const post = client.calls.find((c) => c.type === 'post');
    expect(post?.path).toBe('/incidents/180457930/comments.json');
  });
});
