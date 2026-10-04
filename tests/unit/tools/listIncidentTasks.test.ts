import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { registerListIncidentTasks } from '../../../src/tools/tasks/listIncidentTasks.js';
import {
  makeFakeClient,
  makeCtx,
  getRegisteredTool,
  type FakeClient,
  type RegisteredToolInternals,
} from './_helpers/mockClient.js';

describe('swsd_list_incident_tasks', () => {
  let server: McpServer;
  let client: FakeClient;
  let tool: RegisteredToolInternals;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    client = makeFakeClient();
    registerListIncidentTasks(server, makeCtx(client));
    tool = getRegisteredTool(server, 'swsd_list_incident_tasks');
  });

  it('resolves a 5-digit number reference and maps task rows', async () => {
    // Resolver-then-fetch: 60310 (number) → 180457930 (id), then GET tasks.
    client.setBodyForPath(
      (p) => p === '/incidents.json',
      [{ id: 180457930, number: 60310 }],
    );
    client.setBodyForPath(
      (p) => p === '/incidents/180457930/tasks.json',
      [
        {
          id: 12345,
          name: 'Verify backup integrity',
          description: '<p>Run checksum.</p>',
          state: 'New',
          position: 1,
          assignee: { id: 9001, name: 'Alex Agent', email: 'alex@example.com' },
          due_at: '2026-06-15T17:00:00Z',
          created_at: '2026-05-01T10:00:00Z',
          updated_at: '2026-05-01T10:00:00Z',
        },
        {
          id: 12346,
          name: 'Notify requester',
          state: 'Completed',
          position: 2,
          assignee: null,
          due_at: null,
        },
      ],
    );

    const result = (await tool.handler(
      { incident_id: 60310 },
      {},
    )) as CallToolResult;

    // Resolver lookup happened
    const lookup = client.calls.find((c) => c.path === '/incidents.json');
    expect(lookup).toBeDefined();
    expect(lookup?.type === 'get' ? lookup.params : {}).toMatchObject({
      query: 60310,
    });

    // Tasks fetch hits the RESOLVED 9-digit id
    const fetched = client.calls.find(
      (c) => c.path === '/incidents/180457930/tasks.json',
    );
    expect(fetched).toBeDefined();

    // Mapped output shape — completed flag synthesized from state, not wire
    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as {
      tasks: Array<{ id: number; name: string; state: string; completed: boolean }>;
      count: number;
      incident_id: number;
    };
    expect(sc.count).toBe(2);
    expect(sc.incident_id).toBe(180457930);
    expect(sc.tasks[0]).toMatchObject({
      id: 12345,
      name: 'Verify backup integrity',
      state: 'New',
      completed: false,
    });
    expect(sc.tasks[1]).toMatchObject({
      id: 12346,
      name: 'Notify requester',
      state: 'Completed',
      completed: true,
    });
  });

  it('returns a tool error when SWSD returns 500', async () => {
    // Fail the tasks fetch with a 5xx; resolver path passes-through (id-sized).
    const { SwsdHttpError } = await import('../../../src/swsd/errors.js');
    const failingClient = makeFakeClient();
    // Override the GET to throw for the tasks path; the id is id-sized so no
    // resolver lookup happens.
    const origGet = failingClient.get.bind(failingClient);
    failingClient.get = async <T,>(path: string, params: Record<string, unknown> = {}) => {
      if (path === '/incidents/180457930/tasks.json') {
        throw new SwsdHttpError(500, 'boom');
      }
      return origGet<T>(path, params);
    };

    const failingServer = new McpServer({ name: 'test', version: '0.0.0' });
    registerListIncidentTasks(failingServer, makeCtx(failingClient));
    const failingTool = getRegisteredTool(failingServer, 'swsd_list_incident_tasks');
    const result = (await failingTool.handler(
      { incident_id: 180457930 },
      {},
    )) as CallToolResult;

    expect(result.isError).toBe(true);
    const text = result.content?.[0];
    expect(text?.type).toBe('text');
    if (text?.type === 'text') {
      expect(text.text).toMatch(/server error/i);
    }
  });
});
