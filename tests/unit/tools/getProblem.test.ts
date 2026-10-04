import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { registerGetProblem } from '../../../src/tools/problems/getProblem.js';
import {
  makeFakeClient,
  makeCtx,
  getRegisteredTool,
  type FakeClient,
  type RegisteredToolInternals,
} from './_helpers/mockClient.js';

describe('swsd_get_problem', () => {
  let server: McpServer;
  let client: FakeClient;
  let tool: RegisteredToolInternals;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    client = makeFakeClient();
    registerGetProblem(server, makeCtx(client));
    tool = getRegisteredTool(server, 'swsd_get_problem');
  });

  it('resolves a 4-digit number reference and fetches the resolved id', async () => {
    // Resolver-then-fetch: 4421 (number) → 195000001 (id), then GET problem.
    client.setBodyForPath(
      (p) => p === '/problems.json',
      [{ id: 195000001, number: 4421, name: 'Recurring database lag' }],
    );
    client.setBodyForPath(
      (p) => p === '/problems/195000001.json',
      {
        id: 195000001,
        number: 4421,
        name: 'Recurring database lag',
        state: 'In Progress',
      },
    );

    const result = (await tool.handler(
      { id: 4421, detail_level: 'short' },
      {},
    )) as CallToolResult;

    // 1) Resolver lookup hits /problems.json with query=4421
    const lookup = client.calls.find((c) => c.path === '/problems.json');
    expect(lookup).toBeDefined();
    expect(lookup?.type === 'get' ? lookup.params : {}).toMatchObject({ query: 4421 });

    // 2) Detail fetch uses the RESOLVED 9-digit id, NOT the input number
    const fetched = client.calls.find((c) => c.path === '/problems/195000001.json');
    expect(fetched).toBeDefined();
    // Default detail_level "short" → no layout=long param
    expect(fetched?.type === 'get' ? fetched.params : {}).toEqual({});

    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as {
      problem: { id: number; name: string; state: string };
    };
    expect(sc.problem).toMatchObject({
      id: 195000001,
      name: 'Recurring database lag',
      state: 'In Progress',
    });
  });

  it('passes 9-digit ids through without lookup and adds layout=long when detail_level is long', async () => {
    client.setBodyForPath(
      (p) => p === '/problems/195000001.json',
      {
        id: 195000001,
        name: 'Recurring database lag',
      },
    );

    await tool.handler({ id: 195000001, detail_level: 'long' }, {});

    // No /problems.json (resolver lookup) call — 9-digit input is id-sized.
    const lookup = client.calls.find((c) => c.path === '/problems.json');
    expect(lookup).toBeUndefined();

    // Single direct fetch with layout=long
    const fetched = client.calls.find((c) => c.path === '/problems/195000001.json');
    expect(fetched?.type === 'get' ? fetched.params : {}).toMatchObject({
      layout: 'long',
    });
  });
});
