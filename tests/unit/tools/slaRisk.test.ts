import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerSlaRisk } from '../../../src/tools/incidents/slaRisk.js';
import {
  makeFakeClient,
  getRegisteredTool,
  type FakeClient,
  type RegisteredToolInternals,
} from './_helpers/mockClient.js';
import type { ToolContext } from '../../../src/config/toolRegistry.js';

interface StructuredToolResult {
  structuredContent?: Record<string, unknown>;
}

function makeCtx(client: FakeClient): ToolContext {
  return {
    client,
    profile: 'agent',
    env: {} as never,
    enabledTools: [],
    token: '',
  } satisfies ToolContext;
}

describe('swsd_sla_risk - server-side params', () => {
  let server: McpServer;
  let client: FakeClient;
  let tool: RegisteredToolInternals;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    client = makeFakeClient();
    registerSlaRisk(server, makeCtx(client));
    tool = getRegisteredTool(server, 'swsd_sla_risk');
  });

  it('sends sort_by=due_at and sort_order=ASC to the API', async () => {
    await tool.handler({ page: 1, per_page: 25 }, {});
    const get = client.calls.find((c) => c.type === 'get' && c.path === '/incidents.json');
    expect(get).toBeDefined();
    const params = get?.type === 'get' ? get.params : {};
    expect(params.sort_by).toBe('due_at');
    expect(params.sort_order).toBe('ASC');
  });

  it('sends state_is_not defaulting to Resolved,Closed', async () => {
    await tool.handler({ page: 1, per_page: 25, state_is_not: ['Resolved', 'Closed'] }, {});
    const get = client.calls.find((c) => c.type === 'get' && c.path === '/incidents.json');
    const params = get?.type === 'get' ? get.params : {};
    expect(params.state_is_not).toEqual(['Resolved', 'Closed']);
  });

  it('translates updated_within to updated_at greater_than', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));

    await tool.handler({ page: 1, per_page: 25, updated_within: '7d' }, {});

    const get = client.calls.find((c) => c.type === 'get' && c.path === '/incidents.json');
    const params = get?.type === 'get' ? get.params : {};
    expect(params.updated_at).toEqual(['greater_than', '2026-05-25']);
    vi.useRealTimers();
  });
});

describe('swsd_sla_risk - risk computation and sorting', () => {
  let server: McpServer;
  let client: FakeClient;
  let tool: RegisteredToolInternals;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
    server = new McpServer({ name: 'test', version: '0.0.0' });
    client = makeFakeClient();
    registerSlaRisk(server, makeCtx(client));
    tool = getRegisteredTool(server, 'swsd_sla_risk');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('computes risk buckets correctly and sorts breached first', async () => {
    client.setBodyForPath((path) => path === '/incidents.json', [
      { id: 1, name: 'ok', due_at: '2026-06-03T12:00:00Z' },
      { id: 2, name: 'breached', due_at: '2026-06-01T10:00:00Z' },
      { id: 3, name: 'critical', due_at: '2026-06-01T14:00:00Z' },
      { id: 4, name: 'warning', due_at: '2026-06-02T08:00:00Z' },
      { id: 5, name: 'no-due' },
    ]);

    const result = (await tool.handler(
      { page: 1, per_page: 25, include_no_due_date: true },
      {},
    )) as StructuredToolResult;

    const sc = result.structuredContent ?? {};
    const incidents = sc.incidents as Array<{ id: number; risk: string }>;
    expect(incidents.map((i) => i.risk)).toEqual([
      'breached',
      'critical',
      'warning',
      'ok',
      'no_due_date',
    ]);
  });

  it('marks rows carrying sla_violations as breached even when due_at is in the future', async () => {
    client.setBodyForPath((path) => path === '/incidents.json', [
      {
        id: 7,
        name: 'violated',
        due_at: '2026-06-03T12:00:00Z',
        sla_violations: [{ name: 'Time to first response', violation_type: 'response' }],
      },
    ]);

    const result = (await tool.handler({ page: 1, per_page: 25 }, {})) as StructuredToolResult;
    const incidents = (result.structuredContent ?? {}).incidents as Array<{
      risk: string;
      sla_violations: unknown[];
    }>;
    expect(incidents[0]?.risk).toBe('breached');
    expect(incidents[0]?.sla_violations).toHaveLength(1);
  });

  it('excludes no_due_date by default', async () => {
    client.setBodyForPath((path) => path === '/incidents.json', [
      { id: 1, name: 'has-due', due_at: '2026-06-03T12:00:00Z' },
      { id: 2, name: 'no-due' },
    ]);

    const result = (await tool.handler({ page: 1, per_page: 25 }, {})) as StructuredToolResult;
    const sc = result.structuredContent ?? {};
    const incidents = sc.incidents as Array<{ id: number }>;
    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.id).toBe(1);
  });

  it('returns correct counts per risk level', async () => {
    client.setBodyForPath((path) => path === '/incidents.json', [
      { id: 1, name: 'b1', due_at: '2026-06-01T10:00:00Z' },
      { id: 2, name: 'b2', due_at: '2026-06-01T09:00:00Z' },
      { id: 3, name: 'c1', due_at: '2026-06-01T14:00:00Z' },
      { id: 4, name: 'ok1', due_at: '2026-06-05T12:00:00Z' },
    ]);

    const result = (await tool.handler({ page: 1, per_page: 25 }, {})) as StructuredToolResult;
    const sc = result.structuredContent ?? {};
    const counts = sc.counts as Record<string, number>;
    expect(counts.breached).toBe(2);
    expect(counts.critical).toBe(1);
    expect(counts.ok).toBe(1);
  });
});

describe('swsd_sla_risk - client-side assignee filter', () => {
  let server: McpServer;
  let client: FakeClient;
  let tool: RegisteredToolInternals;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
    server = new McpServer({ name: 'test', version: '0.0.0' });
    client = makeFakeClient();
    registerSlaRisk(server, makeCtx(client));
    tool = getRegisteredTool(server, 'swsd_sla_risk');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('filters by assignee_email case-insensitively client-side', async () => {
    client.setBodyForPath((path) => path === '/incidents.json', [
      { id: 1, name: 'mine', assignee: { email: 'Me@Example.com' }, due_at: '2026-06-03T12:00:00Z' },
      { id: 2, name: 'other', assignee: { email: 'other@example.com' }, due_at: '2026-06-03T12:00:00Z' },
    ]);

    const result = (await tool.handler(
      { page: 1, per_page: 25, assignee_email: 'me@example.com' },
      {},
    )) as StructuredToolResult;

    const sc = result.structuredContent ?? {};
    const incidents = sc.incidents as Array<{ id: number }>;
    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.id).toBe(1);
    const scan = sc.scan as { client_filter_applied: boolean };
    expect(scan.client_filter_applied).toBe(true);
  });
});
