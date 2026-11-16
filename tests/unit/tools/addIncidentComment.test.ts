import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { registerAddIncidentComment } from '../../../src/tools/comments/addIncidentComment.js';
import { AddIncidentCommentInput } from '../../../src/schemas/comment.js';
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

describe('swsd_add_incident_comment — notification callbacks', () => {
  const body = 'Hello!';
  const path = '/incidents/180457930/comments.json';

  function setup(mode: 'live' | 'dry-run' | 'disabled' = 'live') {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const client = makeFakeClient();
    registerAddIncidentComment(server, makeCtx(client, { SWSD_WRITE_MODE: mode }));
    const tool = getRegisteredTool(server, 'swsd_add_incident_comment');
    const invoke = async (input: unknown) =>
      await tool.handler(AddIncidentCommentInput.parse(input), {}) as CallToolResult;
    return { client, invoke };
  }

  it.each([undefined, false])('does not request callbacks when notify=%s', async (notify) => {
    const { client, invoke } = setup();
    client.setPostResponse({ id: 88888, body, is_private: false });

    const result = await invoke({ incident_id: 180457930, body, notify });

    expect(client.calls).toEqual([
      { type: 'post', path, body: { comment: { body, is_private: false } } },
    ]);
    expect(result.structuredContent).toMatchObject({ comment: { id: 88888 } });
    expect(result.content).toEqual([
      { type: 'text', text: 'Added public comment 88888 on incident 180457930.' },
    ]);
  });

  it.each([false, true])('requests callbacks after resolving the incident number with is_private=%s', async (is_private) => {
    const { client, invoke } = setup();
    client.setLookupBody([{ id: 180457930, number: 60310 }]);
    client.setRawResponse({ id: 88888, body, is_private });

    const result = await invoke({ incident_id: 60310, body, is_private, notify: true });

    expect(client.calls).toEqual([
      { type: 'get', path: '/incidents.json', params: { query: 60310, per_page: 25 } },
      { type: 'raw', path, init: { method: 'POST', query: { add_callbacks: true }, body: { comment: { body, is_private } } } },
    ]);
    expect(result.structuredContent).toMatchObject({ comment: { id: 88888, body, is_private } });
    expect(result.content).toEqual([
      { type: 'text', text: `Added ${is_private ? 'private' : 'public'} comment 88888 on incident 180457930. SWSD notification callbacks requested.` },
    ]);
  });

  it('previews callbacks on the resolved incident without sending a write in dry-run', async () => {
    const { client, invoke } = setup('dry-run');
    client.setLookupBody([{ id: 180457930, number: 60310 }]);

    const result = await invoke({ incident_id: 60310, body, is_private: true, notify: true });

    expect(result.structuredContent).toEqual({
      dry_run: true,
      request: { method: 'POST', path: `${path}?add_callbacks=true`, body: { comment: { body, is_private: true } } },
    });
    expect(client.calls).toEqual([
      { type: 'get', path: '/incidents.json', params: { query: 60310, per_page: 25 } },
    ]);
  });

  it('omits callbacks from the default dry-run preview', async () => {
    const { client, invoke } = setup('dry-run');

    const result = await invoke({ incident_id: 180457930, body });

    expect(result.structuredContent).toEqual({
      dry_run: true,
      request: { method: 'POST', path, body: { comment: { body, is_private: false } } },
    });
    expect(client.calls).toEqual([]);
  });

  it('blocks callback requests when writes are disabled', async () => {
    const { client, invoke } = setup('disabled');

    const result = await invoke({ incident_id: 180457930, body, notify: true });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('SWSD_WRITE_MODE=disabled') }),
    ]));
    expect(client.calls).toEqual([]);
  });

  it('defaults notify to false and rejects non-boolean opt-ins', () => {
    const input = { incident_id: 180457930, body };
    expect(AddIncidentCommentInput.parse(input).notify).toBe(false);
    for (const notify of ['true', 'false', 1, 0, null]) {
      expect(AddIncidentCommentInput.safeParse({ ...input, notify }).success).toBe(false);
    }
  });
});
