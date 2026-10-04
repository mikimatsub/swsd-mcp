import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { registerCreateProblem } from '../../../src/tools/problems/createProblem.js';
import {
  makeFakeClient,
  makeCtx,
  getRegisteredTool,
  type FakeClient,
  type RegisteredToolInternals,
} from './_helpers/mockClient.js';

describe('swsd_create_problem', () => {
  let server: McpServer;
  let client: FakeClient;
  let tool: RegisteredToolInternals;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    client = makeFakeClient();
    registerCreateProblem(server, makeCtx(client));
    tool = getRegisteredTool(server, 'swsd_create_problem');
  });

  it('POSTs /problems.json with the {problem: {...}} envelope and nested-lookup shapes', async () => {
    client.setPostResponse({
      id: 195000010,
      number: 4501,
      name: 'Mail queue backlog',
      state: 'New',
      priority: 'High',
      category: { id: 1, name: 'Performance' },
      requester: { id: 9001, email: 'pat@example.com' },
      assignee: { id: 9100, email: 'sam@example.com' },
    });

    const result = (await tool.handler(
      {
        name: 'Mail queue backlog',
        description: 'Backlog over 10k messages every Monday morning.',
        priority: 'High',
        category: 'Performance',
        subcategory: 'Email',
        assignee_email: 'sam@example.com',
        requester_email: 'pat@example.com',
      },
      {},
    )) as CallToolResult;

    // Single POST to /problems.json
    const post = client.calls.find((c) => c.type === 'post');
    expect(post?.path).toBe('/problems.json');

    // Body uses the {problem: {...}} envelope and nested-lookup shapes for
    // assignee/requester/category/subcategory.
    expect(post?.type === 'post' ? post.body : {}).toEqual({
      problem: {
        name: 'Mail queue backlog',
        description: 'Backlog over 10k messages every Monday morning.',
        priority: 'High',
        category: { name: 'Performance' },
        subcategory: { name: 'Email' },
        assignee: { email: 'sam@example.com' },
        requester: { email: 'pat@example.com' },
      },
    });

    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as {
      problem: { id: number; name: string };
    };
    expect(sc.problem).toMatchObject({
      id: 195000010,
      name: 'Mail queue backlog',
    });
  });

  it('omits optional fields from the payload when not provided', async () => {
    client.setPostResponse({
      id: 195000011,
      name: 'Bare problem',
      state: 'New',
    });

    await tool.handler(
      { name: 'Bare problem' }, // only name is required
      {},
    );

    const post = client.calls.find((c) => c.type === 'post');
    // Only `name` should appear in the envelope — no other keys.
    expect(post?.type === 'post' ? post.body : {}).toEqual({
      problem: { name: 'Bare problem' },
    });
  });

  it('returns a tool error when SWSD returns a body without a numeric id', async () => {
    client.setPostResponse('not an object');

    const result = (await tool.handler(
      { name: 'Will fail' },
      {},
    )) as CallToolResult;

    expect(result.isError).toBe(true);
    const text = result.content?.[0];
    expect(text?.type).toBe('text');
    if (text?.type === 'text') {
      expect(text.text.toLowerCase()).toMatch(/parse|response/i);
    }
  });
});
