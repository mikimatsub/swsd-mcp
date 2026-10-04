import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { registerListProblems } from '../../../src/tools/problems/listProblems.js';
import {
  makeFakeClient,
  makeCtx,
  getRegisteredTool,
  type FakeClient,
  type RegisteredToolInternals,
} from './_helpers/mockClient.js';

describe('swsd_list_problems', () => {
  let server: McpServer;
  let client: FakeClient;
  let tool: RegisteredToolInternals;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    client = makeFakeClient();
    registerListProblems(server, makeCtx(client));
    tool = getRegisteredTool(server, 'swsd_list_problems');
  });

  it('GETs /problems.json with structured filters and maps the rows', async () => {
    client.setBodyForPath(
      (p) => p === '/problems.json',
      [
        {
          id: 195000001,
          number: 4421,
          name: 'Recurring database lag',
          state: 'In Progress',
          priority: 'High',
          category: { id: 1, name: 'Performance' },
          subcategory: { id: 11, name: 'Database' },
          description: '<p>Latency spikes every Monday.</p>',
          description_no_html: 'Latency spikes every Monday.',
          requester: { id: 9001, name: 'Pat User', email: 'pat@example.com' },
          assignee: { id: 9100, name: 'Sam Engineer', email: 'sam@example.com' },
          created_at: '2026-04-01T10:00:00Z',
          updated_at: '2026-05-01T10:00:00Z',
          href_account_domain: 'https://example.samanage.com/problems/195000001',
        },
        {
          // Defensive: bare wire shape with only id + name (e.g. tenant returned a partial row)
          id: 195000002,
          name: 'Email queue backlog',
        },
      ],
    );

    const result = (await tool.handler(
      {
        page: 1,
        per_page: 25,
        state: ['In Progress'],
        priority: ['High'],
        assignee_email: 'sam@example.com',
        query: 'database',
      },
      {},
    )) as CallToolResult;

    // GET captured to /problems.json with the structured params (NOT collapsed
    // into a single string). state and priority are arrays per SWSD repeated-key
    // convention.
    const get = client.calls.find((c) => c.path === '/problems.json');
    expect(get).toBeDefined();
    expect(get?.type === 'get' ? get.params : {}).toMatchObject({
      page: 1,
      per_page: 25,
      state: ['In Progress'],
      priority: ['High'],
      assignee_email: 'sam@example.com',
      query: 'database',
    });

    // Both rows mapped — even the bare one without optional fields.
    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as {
      problems: Array<{
        id: number;
        name: string;
        state?: string;
        priority?: string;
        category?: string;
        subcategory?: string;
        url?: string;
        requester?: { email?: string };
      }>;
      pagination: { total_scope: string };
      applied_filters: Record<string, unknown>;
    };
    expect(sc.problems).toHaveLength(2);
    expect(sc.problems[0]).toMatchObject({
      id: 195000001,
      number: 4421,
      name: 'Recurring database lag',
      state: 'In Progress',
      priority: 'High',
      category: 'Performance',
      subcategory: 'Database',
      url: 'https://example.samanage.com/problems/195000001',
    });
    expect(sc.problems[0]?.requester?.email).toBe('pat@example.com');
    // Bare row still produces a valid summary
    expect(sc.problems[1]).toMatchObject({
      id: 195000002,
      name: 'Email queue backlog',
    });

    // applied_filters reflects what the agent passed in
    expect(sc.applied_filters).toMatchObject({
      state: ['In Progress'],
      priority: ['High'],
      assignee_email: 'sam@example.com',
      query: 'database',
    });
    // total_scope is "unknown" because the fake client doesn't surface a total
    expect(sc.pagination.total_scope).toBe('unknown');
  });

  it('omits unset filters from both the GET params and applied_filters echo', async () => {
    client.setBodyForPath((p) => p === '/problems.json', []);

    await tool.handler({ page: 1, per_page: 25 }, {});

    const get = client.calls.find((c) => c.path === '/problems.json');
    expect(get).toBeDefined();
    const params = get?.type === 'get' ? get.params : {};
    // Only page and per_page should be sent; no filter keys.
    expect(params).toEqual({ page: 1, per_page: 25 });
  });
});
