import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerMyQueue } from '../../../src/tools/incidents/myQueue.js';
import {
  makeFakeClient,
  getRegisteredTool,
  type FakeClient,
  type RegisteredToolInternals,
} from './_helpers/mockClient.js';
import type { ToolContext } from '../../../src/config/toolRegistry.js';

const HEADER = Buffer.from(JSON.stringify({ alg: 'HS512' })).toString('base64url');
const PAYLOAD = Buffer.from(JSON.stringify({ user_id: 42, generated_at: '2026-06-01' })).toString(
  'base64url',
);
const TEST_JWT = `${HEADER}.${PAYLOAD}.signature`;

interface StructuredToolResult {
  structuredContent?: Record<string, unknown>;
}

function makeCtxWithJwt(client: FakeClient): ToolContext {
  return {
    client,
    profile: 'agent',
    env: {} as never,
    enabledTools: [],
    token: TEST_JWT,
  } satisfies ToolContext;
}

describe('swsd_my_queue - defaults to current user', () => {
  let server: McpServer;
  let client: FakeClient;
  let tool: RegisteredToolInternals;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
    server = new McpServer({ name: 'test', version: '0.0.0' });
    client = makeFakeClient();
    registerMyQueue(server, makeCtxWithJwt(client));
    tool = getRegisteredTool(server, 'swsd_my_queue');

    client.setBodyForPath(
      (path) => path === '/users/42.json',
      { id: 42, email: 'me@example.com' },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves JWT user and applies client-side assignee filter', async () => {
    client.setBodyForPath((path) => path === '/incidents.json', [
      { id: 1, name: 'mine', assignee: { email: 'me@example.com' }, due_at: '2026-06-03T12:00:00Z' },
      { id: 2, name: 'other', assignee: { email: 'other@example.com' }, due_at: '2026-06-03T12:00:00Z' },
    ]);

    const result = (await tool.handler({ page: 1, per_page: 25 }, {})) as StructuredToolResult;
    const sc = result.structuredContent ?? {};
    const incidents = sc.incidents as Array<{ id: number }>;
    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.id).toBe(1);
    const assigneeEmail = sc.assignee_email as string;
    expect(assigneeEmail).toBe('me@example.com');
  });

  it('includes risk computation on each row', async () => {
    client.setBodyForPath((path) => path === '/incidents.json', [
      { id: 1, name: 'overdue', assignee: { email: 'me@example.com' }, due_at: '2026-06-01T10:00:00Z' },
    ]);

    const result = (await tool.handler({ page: 1, per_page: 25 }, {})) as StructuredToolResult;
    const sc = result.structuredContent ?? {};
    const incidents = sc.incidents as Array<{ risk: string; minutes_to_breach: number }>;
    expect(incidents[0]?.risk).toBe('breached');
    expect(incidents[0]?.minutes_to_breach).toBe(-120);
  });

  it('sends state_is_not defaulting to Resolved,Closed', async () => {
    await tool.handler({ page: 1, per_page: 25, state_is_not: ['Resolved', 'Closed'] }, {});
    const get = client.calls.find((c) => c.type === 'get' && c.path === '/incidents.json');
    const params = get?.type === 'get' ? get.params : {};
    expect(params.state_is_not).toEqual(['Resolved', 'Closed']);
  });

  it('sends sort_by=due_at by default', async () => {
    await tool.handler({ page: 1, per_page: 25 }, {});
    const get = client.calls.find((c) => c.type === 'get' && c.path === '/incidents.json');
    const params = get?.type === 'get' ? get.params : {};
    expect(params.sort_by).toBe('due_at');
    expect(params.sort_order).toBe('ASC');
  });
});

describe('swsd_my_queue - group mode', () => {
  let server: McpServer;
  let client: FakeClient;
  let tool: RegisteredToolInternals;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
    server = new McpServer({ name: 'test', version: '0.0.0' });
    client = makeFakeClient();
    registerMyQueue(server, makeCtxWithJwt(client));
    tool = getRegisteredTool(server, 'swsd_my_queue');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses assigned_to_group server-side without JWT resolution when no assignee_email', async () => {
    client.setBodyForPath((path) => path === '/incidents.json', [
      { id: 1, name: 'group-ticket', assignee: { email: 'someone@example.com' }, due_at: '2026-06-03T12:00:00Z' },
    ]);

    const result = (await tool.handler(
      { page: 1, per_page: 25, assigned_to_group: 99 },
      {},
    )) as StructuredToolResult;

    const get = client.calls.find((c) => c.type === 'get' && c.path === '/incidents.json');
    const params = get?.type === 'get' ? get.params : {};
    expect(params.assigned_to).toBe(99);

    const usersCall = client.calls.find((c) => c.type === 'get' && c.path.startsWith('/users/'));
    expect(usersCall).toBeUndefined();

    const sc = result.structuredContent ?? {};
    const incidents = sc.incidents as Array<{ id: number }>;
    expect(incidents).toHaveLength(1);
  });
});

describe('swsd_my_queue - assignee_email override', () => {
  let server: McpServer;
  let client: FakeClient;
  let tool: RegisteredToolInternals;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
    server = new McpServer({ name: 'test', version: '0.0.0' });
    client = makeFakeClient();
    registerMyQueue(server, makeCtxWithJwt(client));
    tool = getRegisteredTool(server, 'swsd_my_queue');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses provided assignee_email instead of JWT user', async () => {
    client.setBodyForPath((path) => path === '/incidents.json', [
      { id: 1, name: 'colleague', assignee: { email: 'colleague@example.com' }, due_at: '2026-06-03T12:00:00Z' },
      { id: 2, name: 'me', assignee: { email: 'me@example.com' }, due_at: '2026-06-03T12:00:00Z' },
    ]);

    const result = (await tool.handler(
      { page: 1, per_page: 25, assignee_email: 'colleague@example.com' },
      {},
    )) as StructuredToolResult;

    const usersCall = client.calls.find((c) => c.type === 'get' && c.path.startsWith('/users/'));
    expect(usersCall).toBeUndefined();

    const sc = result.structuredContent ?? {};
    const incidents = sc.incidents as Array<{ id: number }>;
    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.id).toBe(1);
  });
});
