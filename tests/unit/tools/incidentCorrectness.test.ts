import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerListIncidents } from '../../../src/tools/incidents/listIncidents.js';
import { registerListMyIncidents } from '../../../src/tools/incidents/listMyIncidents.js';
import { registerMyQueue } from '../../../src/tools/incidents/myQueue.js';
import { registerSlaRisk } from '../../../src/tools/incidents/slaRisk.js';
import { ListIncidentsInput } from '../../../src/schemas/incident.js';
import { ListMyIncidentsInput } from '../../../src/schemas/listMyIncidents.js';
import { MyQueueInput } from '../../../src/schemas/myQueue.js';
import { SlaRiskInput } from '../../../src/schemas/slaRisk.js';
import { PaginationWithScopeOutput } from '../../../src/schemas/output.js';
import { makeCtx, makeFakeClient, getRegisteredTool } from './_helpers/mockClient.js';

vi.mock('../../../src/utils/resolveCurrentUser.js', () => ({
  resolveCurrentUser: async () => ({
    ok: true, me: { id: 1234567, email: 'me@example.test', available_for_assignment: false },
  }),
}));

const tools = [
  { name: 'swsd_list_incidents', register: registerListIncidents, schema: ListIncidentsInput },
  { name: 'swsd_list_my_incidents', register: registerListMyIncidents, schema: ListMyIncidentsInput },
  { name: 'swsd_my_queue', register: registerMyQueue, schema: MyQueueInput },
  { name: 'swsd_sla_risk', register: registerSlaRisk, schema: SlaRiskInput },
];
const row = (id: number, assignee = 'me@example.test', requester = 'wanted@example.test') => ({
  id, name: `Synthetic incident ${String(id)}`, assignee: { email: assignee },
  requester: { email: requester }, due_at: '2026-11-05T12:00:00Z',
});
type Result = {
  isError?: boolean;
  content: Array<{ text: string }>;
  structuredContent: {
    incidents: Array<{ id: number }>;
    counts?: Record<string, number>;
    pagination: { total?: number; total_scope: string; matched_total?: number | null; next_page?: number };
    applied_filters: Record<string, unknown>;
    scan: { candidates_scanned: number; pages_scanned?: number; truncated?: boolean };
  };
};

function setup(config = tools[0]!, pages: unknown[] = [[row(1234567), row(1234568, 'other@example.test')]], total = 200) {
  const client = makeFakeClient();
  const get = vi.spyOn(client, 'get').mockImplementation(async (_path, params = {}) => {
    if (_path === '/requesters.json') return { body: [{ id: 99, description: 'wanted@example.test' }] as never, pagination: { page: 1, per_page: 100, has_more: false }, headers: new Headers() };
    const page = Number(params.page ?? 1);
    return {
      body: pages[(page - 1) % pages.length] as never,
      pagination: { page, per_page: Number(params.per_page ?? 25), total,
        has_more: page * Number(params.per_page ?? 25) < total, next_page: page + 1 },
      headers: new Headers(),
    };
  });
  const server = new McpServer({ name: 'synthetic', version: '0.0.0' });
  config.register(server, makeCtx(client));
  const tool = getRegisteredTool(server, config.name);
  return { tool, get, run: async (input: Record<string, unknown> = {}) =>
    await tool.handler(config.schema.parse(input), {}) as Result };
}

afterEach(() => vi.useRealTimers());

describe('incident correctness', () => {
  it('intersects requester and current assignee case-insensitively', async () => {
    const { run, get } = setup(tools[1], [[
      row(1234567, 'ME@example.test', 'WANTED@example.test'),
      row(1234569, 'other@example.test'),
    ]]);
    const { structuredContent: sc } = await run({ requester_email: 'wanted@example.test' });
    expect(sc.incidents.map(i => i.id)).toEqual([1234567]);
    expect(sc.applied_filters.requester_email).toBe('wanted@example.test');
    expect(get.mock.calls[0]?.[1]).not.toHaveProperty('requester_email');
  });

  it.each(tools)('$name keeps candidate totals upstream after local filtering', async config => {
    const { run } = setup(config);
    const { structuredContent: sc } = await run({ assignee_email: 'me@example.test' });
    expect(sc.incidents.map(i => i.id)).toEqual([1234567]);
    expect(sc.pagination).toMatchObject({ total: 200, total_scope: 'upstream', matched_total: null });
    expect(PaginationWithScopeOutput.safeParse(sc.pagination).success).toBe(true);
  });

  it.each(tools)('$name counts matches only when the full candidate set was scanned', async config => {
    const { run } = setup(config, [[row(1234567), row(1234568, 'other@example.test')]], 2);
    const { structuredContent: sc } = await run({ assignee_email: 'me@example.test' });
    expect(sc.pagination).toMatchObject({ total: 2, total_scope: 'upstream', matched_total: 1 });
  });

  it.each(tools)('$name leaves matched total unknown on a final page starting after page one', async config => {
    const { run } = setup(config, [[row(1234567)]], 26);
    const { structuredContent: sc } = await run({ page: 2, assignee_email: 'me@example.test' });
    expect(sc.pagination.matched_total).toBeNull();
  });

  it.each(tools)('$name omits sort and display options from applied filters', async config => {
    const { run } = setup(config);
    const { structuredContent: sc } = await run({
      sort_by: 'updated_at', sort_order: 'DESC', at_risk_within_hours: 12, include_no_due_date: true,
    });
    for (const field of ['sort_by', 'sort_order', 'at_risk_within_hours', 'include_no_due_date']) {
      expect(sc.applied_filters).not.toHaveProperty(field);
    }
    if (config.name === 'swsd_list_incidents') expect(sc.pagination.total_scope).toBe('tenant');
  });

  it.each(tools)('$name rejects unexpected incident list shapes', async config => {
    const { run } = setup(config, [{ unexpected: [] }]);
    expect((await run()).isError).toBe(true);
  });

  it.each(tools)('$name does not claim empty filter arrays were applied', async config => {
    const { run, get } = setup(config);
    const { structuredContent: sc } = await run({
      states: [], priorities: [], categories: [], sites: [], departments: [], state_is_not: [],
    });
    for (const field of ['states', 'priorities', 'categories', 'sites', 'departments', 'state_is_not']) {
      expect(sc.applied_filters).not.toHaveProperty(field);
    }
    for (const field of ['state', 'priority', 'category', 'site', 'department', 'state_is_not']) {
      expect(get.mock.calls[0]?.[1]).not.toHaveProperty(field);
    }
    if (config.name === 'swsd_list_incidents') expect(sc.pagination.total_scope).toBe('tenant');
  });

  it.each(tools)('$name sends a date-only cutoff upstream and applies the hour locally', async config => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T20:30:00Z'));
    const { run, get } = setup(config, [[
      { ...row(1234567), updated_at: '2026-11-04T19:45:00Z' },
      { ...row(1234568), updated_at: '2026-11-04T19:00:00Z' },
      row(1234569),
    ]]);
    const { structuredContent: sc } = await run({ updated_within: '1h' });
    expect(get.mock.calls[0]?.[1]?.updated_at).toEqual(['greater_than', '2026-11-03']);
    expect(sc.incidents.map(i => i.id)).toEqual([1234567]);
    expect(sc.applied_filters.updated_from).toBe('2026-11-04T19:30:00.000Z');
    expect(sc.pagination.total_scope).toBe('upstream');
  });

  it.each(tools)('$name passes date-only updated_from through without local filtering', async config => {
    const { run, get } = setup(config, [[row(1234567)]]);
    const { structuredContent: sc } = await run({ updated_from: '2026-11-01' });
    expect(get.mock.calls[0]?.[1]?.updated_at).toEqual(['greater_than', '2026-11-01']);
    expect(sc.incidents.map(i => i.id)).toEqual([1234567]);
  });

  it('recommends the public assigned_to_group parameter in both group hints', async () => {
    const { tool, run } = setup(tools[1]);
    expect(tool.description).toContain('assigned_to_group=<group_id>');
    const result = await run();
    expect(result.content[0]?.text).toContain('assigned_to_group=<group_id>');
    expect(ListIncidentsInput.parse({ assigned_to_group: 1234567 }).assigned_to_group).toBe(1234567);
  });

  it('collects SLA matches across pages and marks a result cap as truncated', async () => {
    const { run, get } = setup(tools[3], [[row(1234567, 'other@example.test')], [row(1234568)], [row(1234569)]], 4);
    const { structuredContent: sc } = await run({ per_page: 1, max_results: 2, assignee_email: 'me@example.test' });
    expect(get).toHaveBeenCalledTimes(3);
    expect(sc.incidents.map(i => i.id)).toEqual([1234568, 1234569]);
    expect(sc.scan).toMatchObject({ pages_scanned: 3, candidates_scanned: 3, truncated: true });
    expect(sc.pagination).toMatchObject({ next_page: 4, matched_total: null });
  });

  it('stops the SLA scan at ten pages even when no rows match', async () => {
    const { run, get } = setup(tools[3], [[row(1234567, 'other@example.test')]], 100);
    const { structuredContent: sc } = await run({ per_page: 1, max_results: 2, assignee_email: 'me@example.test' });
    expect(get).toHaveBeenCalledTimes(10);
    expect(sc.incidents).toEqual([]);
    expect(sc.scan).toMatchObject({ pages_scanned: 10, truncated: true });
    expect(sc.pagination.next_page).toBe(11);
  });

  it('does not scan beyond the last supported SLA page', async () => {
    const { run, get } = setup(tools[3], [[]], 20000);
    const { structuredContent: sc } = await run({ page: 10000, per_page: 1, max_results: 2 });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0]?.[1]?.page).toBe(10000);
    expect(sc.pagination.matched_total).toBeNull();
    expect(sc.scan).toMatchObject({ pages_scanned: 1, truncated: true });
  });

  it('keeps the full SLA matched total when only the display cap truncates a complete scan', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T20:30:00Z'));
    const { run, get } = setup(tools[3], [[
      row(1234567),
      { ...row(1234568), due_at: '2026-11-04T19:30:00Z' },
      { ...row(1234569), due_at: '2026-11-03T19:30:00Z' },
    ]], 3);
    const { structuredContent: sc } = await run({ max_results: 1 });
    expect(get).toHaveBeenCalledTimes(1);
    expect(sc.incidents.map(i => i.id)).toEqual([1234569]);
    expect(sc.counts).toEqual({ breached: 1 });
    expect(sc.pagination.matched_total).toBe(3);
    expect(sc.scan).toMatchObject({ pages_scanned: 1, truncated: true });
  });

  it('reports a complete SLA scan without truncation and excludes no-due rows from matched total', async () => {
    const { run, get } = setup(tools[3], [[{ id: 1234567, name: 'No due date' }], [row(1234568)]], 2);
    const { structuredContent: sc } = await run({ per_page: 1, max_results: 10 });
    expect(get).toHaveBeenCalledTimes(2);
    expect(sc.incidents.map(i => i.id)).toEqual([1234568]);
    expect(sc.pagination).toMatchObject({ total_scope: 'upstream', matched_total: 1 });
    expect(sc.scan).toMatchObject({ pages_scanned: 2, truncated: false });
  });
});
