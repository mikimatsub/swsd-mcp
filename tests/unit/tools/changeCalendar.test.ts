import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { ChangeCalendarInput, ChangeCalendarOutput } from '../../../src/schemas/changeCalendar.js';
import { registerChangeCalendar } from '../../../src/tools/records/changeCalendar.js';
import { registerTools } from '../../../src/config/toolRegistry.js';
import { PROFILE_TOOLS } from '../../../src/config/profiles.js';
import { SwsdHttpError } from '../../../src/swsd/errors.js';
import { makeFakeClient, makeCtx, getRegisteredTool } from './_helpers/mockClient.js';
import fixture from '../mappers/fixtures/change-calendar-api.json';

const row = { ...fixture.change.change, id: 1, name: 'Database patch', state: 'Scheduled',
  planned_start_at: '2026-11-10T09:00:00Z', planned_end_at: '2026-11-10T11:00:00Z' };
const window = { from: '2026-11-10', to: '2026-11-11' };
function setup() {
  const client = makeFakeClient();
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerChangeCalendar(server, makeCtx(client, { SWSD_WRITE_MODE: 'disabled' }));
  const tool = getRegisteredTool(server, 'swsd_change_calendar');
  const call = async (input: Record<string, unknown> = {}) => await tool.handler(ChangeCalendarInput.parse(input), {}) as CallToolResult;
  return { client, server, tool, call };
}
afterEach(() => vi.useRealTimers());

describe('change calendar schema', () => {
  it('defaults both kinds and bounded scan sizes', () => {
    expect(ChangeCalendarInput.parse({})).toEqual({ kinds: ['change', 'release'], max_pages: 3, per_page: 100 });
    expect(ChangeCalendarInput.parse({ max_pages: 10, per_page: 1, from: '2026-11-10', to: '2026-11-11T09:00:00-05:00' }).max_pages).toBe(10);
  });
  it.each([{ kinds: [] }, { kinds: ['incident'] }, { max_pages: 11 }, { max_pages: 0 }, { max_pages: 1.5 }, { per_page: 101 }, { per_page: 0 },
    { from: '2026-02-30' }, { to: 'tomorrow' }, { from: '2026-11-10T09:00:00' }, { assignee_email: 'bad' }, { group_assignee_id: 0 }])('rejects invalid input %j', input => {
    expect(ChangeCalendarInput.safeParse(input).success).toBe(false);
  });
});

describe('swsd_change_calendar', () => {
  it('reports total conflicts separately from capped details and scan truncation', async () => {
    const { client, call } = setup();
    client.setLookupBody(Array.from({ length: 22 }, (_, index) => ({
      id: 1234567 + index, name: 'Synthetic scheduled change', state: 'Scheduled',
      planned_start_at: '2026-11-10T09:00:00Z', planned_end_at: '2026-11-10T11:00:00Z',
      group_assignee: { id: 1234567, name: 'Synthetic group' },
    })));
    const result = await call({ ...window, kinds: ['change'] });
    const data = ChangeCalendarOutput.parse(result.structuredContent);
    expect(data.conflicts).toHaveLength(200);
    expect(data).toMatchObject({ conflict_count: 231, conflicts_truncated: true, scan: { truncated: false } });
    expect(data.items.map(i => i.conflict_count)).toEqual(Array<number>(22).fill(21));
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('231 conflicts') });
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('200 conflict details shown') });
  });
  it('rejects malformed list payloads rather than reporting an empty calendar', async () => {
    const { client, call } = setup();
    client.setLookupBody({ unexpected: [] });
    const result = await call({ ...window, kinds: ['change'] });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });
  it('scans both kinds with pagination only, stopping independently at has_more false', async () => {
    const { client, call } = setup();
    client.setBodyForPath(p => p === '/changes.json', [row]);
    client.setBodyForPath(p => p === '/releases.json', [{ ...row, name: 'Release patch' }]);
    const result = await call(window);
    expect(client.calls).toEqual([
      { type: 'get', path: '/changes.json', params: { page: 1, per_page: 100 } },
      { type: 'get', path: '/releases.json', params: { page: 1, per_page: 100 } },
    ]);
    const data = ChangeCalendarOutput.parse(result.structuredContent);
    expect(data.items.map(i => [i.kind, i.id, i.conflict_count])).toEqual([['change', 1, 1], ['release', 1, 1]]);
    expect(data.conflicts[0]?.reasons).toEqual(['shared CI: 100', 'same group: Helpdesk Team']);
    expect(data.scan).toEqual({ pages_fetched: { change: 1, release: 1 }, rows_scanned: 2, unscheduled: 0, truncated: false });
  });
  it('continues past nonmatching pages and reports a capped scan honestly', async () => {
    const { client, call } = setup();
    const get = client.get;
    vi.spyOn(client, 'get').mockImplementation(async (path, params) => {
      const result = await get(path, params);
      return { ...result, body: params?.page === 1 ? [{ ...row, name: 'No match' }] : [row], pagination: { ...result.pagination, has_more: true } };
    });
    const result = await call({ ...window, kinds: ['change', 'change'], max_pages: 2, per_page: 1, query: 'PATCH' });
    expect(client.calls.map(c => c.type === 'get' ? c.params : null)).toEqual([{ page: 1, per_page: 1 }, { page: 2, per_page: 1 }]);
    expect(result.structuredContent).toMatchObject({ items: [{ id: 1 }], scan: { pages_fetched: { change: 2, release: 0 }, rows_scanned: 2, truncated: true } });
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('Scan truncated') });
  });
  it('does not mark the final allowed page truncated when has_more is false', async () => {
    const { client, call } = setup();
    const get = client.get;
    vi.spyOn(client, 'get').mockImplementation(async (path, params) => {
      const result = await get(path, params);
      return { ...result, body: [row], pagination: { ...result.pagination, has_more: params?.page === 1 } };
    });
    const result = await call({ ...window, kinds: ['release'], max_pages: 2 });
    expect(client.calls).toHaveLength(2);
    expect(result.structuredContent).toMatchObject({ items: [{ kind: 'release' }], scan: { pages_fetched: { change: 0, release: 2 }, truncated: false } });
  });
  it('keeps per-kind page limits independent and preserves truncation across kinds', async () => {
    const { client, call } = setup();
    const get = client.get;
    vi.spyOn(client, 'get').mockImplementation(async (path, params) => {
      const result = await get(path, params);
      return { ...result, body: [row], pagination: { ...result.pagination, has_more: path === '/changes.json' } };
    });
    const data = ChangeCalendarOutput.parse((await call({ ...window, max_pages: 2 })).structuredContent);
    expect(client.calls.map(c => c.type === 'get' ? [c.path, c.params.page] : null))
      .toEqual([['/changes.json', 1], ['/changes.json', 2], ['/releases.json', 1]]);
    expect(data.scan).toEqual({ pages_fetched: { change: 2, release: 1 }, rows_scanned: 3, unscheduled: 0, truncated: true });
    expect(data.items).toHaveLength(2);
    expect(data.conflicts).toHaveLength(1);
  });
  it('applies every client filter together without forwarding undocumented parameters', async () => {
    const { client, call } = setup();
    client.setLookupBody([row, { ...row, id: 2, state: 'Closed' }, { ...row, id: 3, assignee: { email: 'other@example.com' } },
      { ...row, id: 4, group_assignee: { id: 99 } }, { ...row, id: 5, name: 'Unrelated', description: 'Database patch' },
      { ...row, id: 6, state: 'New' }, { ...row, id: 7, assignee: null }, { ...row, id: 8, group_assignee: null }]);
    const filters = { ...window, kinds: ['change'], states: ['SCHEDULED', 'CLOSED'], state_is_not: ['closed'], assignee_email: 'JOHN.DOE@email.com', group_assignee_id: 1, query: 'PATCH' };
    const result = await call(filters);
    const data = ChangeCalendarOutput.parse(result.structuredContent);
    expect(data.items.map(i => i.id)).toEqual([1]);
    expect(data.applied_filters).toEqual({ ...filters, from: '2026-11-10T00:00:00.000Z', to: '2026-11-11T00:00:00.000Z' });
    expect(client.calls).toEqual([{ type: 'get', path: '/changes.json', params: { page: 1, per_page: 100 } }]);
  });
  it('uses window overlap, excludes touching edges and counts unscheduled before filtering', async () => {
    const { client, call } = setup();
    client.setLookupBody([
      row,
      { ...row, id: 2, planned_start_at: '2026-11-09T23:30:00Z', planned_end_at: undefined },
      { ...row, id: 3, planned_start_at: '2026-11-09T23:00:00Z', planned_end_at: undefined },
      { ...row, id: 4, planned_start_at: '2026-11-11T00:00:00Z', planned_end_at: undefined },
      { ...row, id: 5, planned_start_at: null, state: 'Other' }, { ...row, id: 6, planned_start_at: 'bad' },
    ]);
    const data = ChangeCalendarOutput.parse((await call({ ...window, kinds: ['change'] })).structuredContent);
    expect(data.items.map(i => i.id)).toEqual([2, 1]);
    expect(data.days.map(d => d.date)).toEqual(['2026-11-09', '2026-11-10']);
    expect(data.scan).toMatchObject({ rows_scanned: 6, unscheduled: 2 });
  });
  it('uses a fixed UTC default window and handles empty list payloads', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T23:00:00-05:00'));
    const { client, call } = setup();
    client.setLookupBody([]);
    const data = ChangeCalendarOutput.parse((await call()).structuredContent);
    expect(data.window).toEqual({ from: '2026-11-05T00:00:00.000Z', to: '2026-12-05T00:00:00.000Z' });
    expect(data.items).toEqual([]);
    expect(data.scan.rows_scanned).toBe(0);
  });
  it('rejects an inverted window before any upstream request', async () => {
    const { client, call } = setup();
    expect((await call({ from: '2026-11-11', to: '2026-11-10' })).isError).toBe(true);
    expect(client.calls).toEqual([]);
  });
  it('returns an upstream error rather than a partial success when a later kind fails', async () => {
    const { client, call } = setup();
    const get = client.get;
    vi.spyOn(client, 'get').mockImplementation(async (path, params) => {
      if (path === '/releases.json') throw new SwsdHttpError(403, 'Forbidden');
      return get(path, params);
    });
    const result = await call(window);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('Forbidden') });
  });
  it('registers read-only annotations and a self-contained app resource', async () => {
    const { tool, server } = setup();
    expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true });
    expect(tool).toMatchObject({ _meta: { ui: { resourceUri: 'ui://swsd/change-calendar.html' } } });
    const internals = server as unknown as { _registeredResources: Record<string, { readCallback: () => { contents: { uri: string; mimeType: string; text: string }[] } }> };
    const resource = await internals._registeredResources['ui://swsd/change-calendar.html']!.readCallback();
    expect(resource.contents[0]).toMatchObject({ uri: 'ui://swsd/change-calendar.html', mimeType: 'text/html;profile=mcp-app', text: expect.stringContaining('SWSD Change Calendar') });
  });
  it.each(['triage', 'agent', 'operations', 'knowledge'] as const)('registers once only in the intended %s profile', profile => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const ctx = makeCtx(makeFakeClient(), { SWSD_ENABLE_EXTRAS: [] });
    ctx.profile = profile;
    registerTools(server, ctx);
    const expected = ['agent', 'operations'].includes(profile) ? 1 : 0;
    expect(ctx.enabledTools.filter(t => t === 'swsd_change_calendar')).toHaveLength(expected);
    expect(ctx.enabledTools.length).toBe(PROFILE_TOOLS[profile].length);
    expect(new Set(ctx.enabledTools).size).toBe(ctx.enabledTools.length);
  });
});
