import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { registerTicketStats } from '../../../src/tools/incidents/ticketStats.js';
import { TicketStatsInput, TicketStatsOutput } from '../../../src/schemas/ticketStats.js';
import { PROFILE_TOOLS } from '../../../src/config/profiles.js';
import { SwsdHttpError, SwsdNetworkError } from '../../../src/swsd/errors.js';
import { makeCtx, makeFakeClient, getRegisteredTool } from './_helpers/mockClient.js';
import fixture from '../../../screenshots/fixtures/ticket-stats.json';

const window = { from: '2026-10-28T12:00:00.000Z', to: '2026-11-04T12:00:00.000Z' };
const row = (id: number, extra: Record<string, unknown> = {}) => ({
  id, name: 'Acme Corp ticket ' + String(id), state: 'Assigned', priority: 'High',
  created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-02T10:00:00Z',
  assignee: { id: 1, email: 'jane.doe@acme.example' }, category: { name: 'Software' }, ...extra,
});
const page = (body: unknown, has_more = false, next_page?: number) => ({
  body, pagination: { page: 1, per_page: 25, has_more, next_page }, headers: new Headers(),
});
let client: ReturnType<typeof makeFakeClient>;
let server: McpServer;
let tool: ReturnType<typeof getRegisteredTool>;
async function stats(input: Record<string, unknown> = {}) {
  const result = await tool.handler(input, {}) as { structuredContent: unknown; isError?: boolean };
  expect(result.isError).not.toBe(true);
  return TicketStatsOutput.parse(result.structuredContent);
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(window.to));
  client = makeFakeClient();
  server = new McpServer({ name: 'test', version: '0.0.0' });
  registerTicketStats(server, makeCtx(client));
  tool = getRegisteredTool(server, 'swsd_ticket_stats');
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('swsd_ticket_stats aggregation', () => {
  it('deduplicates the scans and aggregates current state, priority, assignee, category, and SLA risk', async () => {
    client.setLookupBody([
      row(1, { due_at: '2026-11-01T00:00:00Z' }),
      row(2, { state: 'In Progress', sla_violations: [{ name: 'Response', violation_type: 'response' }], assignee: null }),
      row(3, { state: 'Resolved', resolved_at: '2026-11-01T12:00:00Z', due_at: '2026-10-31T00:00:00Z', assignee: { email: 'JANE.DOE@acme.example' } }),
      row(4, { state: 'Closed', resolved_at: '2026-11-01T16:00:00Z', priority: 'Low', category: null }),
      row(5, { created_at: '2026-10-01T12:00:00Z', state: 'On Hold', priority: 'Low', assignee: { id: 99 } }),
      null, { name: 'invalid id' },
    ]);
    const out = await stats();
    expect(out.totals).toEqual({ total: 5, open: 3, resolved_in_window: 2, created_in_window: 4, breached: 2, unassigned: 1 });
    expect(out.by_state).toHaveLength(5);
    expect(out.by_priority).toEqual([{ priority: 'High', count: 3 }, { priority: 'Low', count: 2 }]);
    expect(out.by_assignee).toEqual([{ email: 'jane.doe@acme.example', count: 3 }]);
    expect(out.by_category).toEqual([{ category: 'Software', count: 4 }, { category: 'Uncategorized', count: 1 }]);
    expect(out.median_resolution_hours).toBe(4);
    expect(out.scan).toEqual({ pages_scanned: 2, truncated: false });
  });
  it('includes older updated tickets and newly created tickets updated after the window; uses exclusive to', async () => {
    client.setLookupBody([
      row(1, { created_at: window.from, updated_at: '2026-11-05T00:00:00Z' }),
      row(2, { created_at: '2026-10-01T00:00:00Z', updated_at: window.from, resolved_at: window.from, state: 'Resolved' }),
      row(3, { created_at: window.to, updated_at: window.to }),
      row(4, { created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' }),
      row(5, { created_at: 'bad', updated_at: 'bad' }),
    ]);
    const out = await stats();
    expect(out.totals).toMatchObject({ total: 2, created_in_window: 1, resolved_in_window: 1 });
  });
  it('uses only actual valid resolution timestamps and nonnegative durations, with odd/even medians', async () => {
    client.setLookupBody([
      row(1, { resolved_at: '2026-11-01T12:00:00Z' }),
      row(2, { resolved_at: '2026-11-01T16:00:00Z' }),
      row(3, { resolved_at: '2026-11-01T20:00:00Z' }),
      row(4, { state: 'Resolved', resolved_at: 'not-a-date' }),
      row(5, { state: 'Closed' }),
      row(6, { resolved_at: '2026-11-01T09:00:00Z' }),
      row(7, { created_at: 'bad', resolved_at: '2026-11-01T14:00:00Z' }),
      row(8, { resolved_at: window.to }),
    ]);
    const out = await stats();
    expect(out.median_resolution_hours).toBe(6);
    expect(out.totals.resolved_in_window).toBe(5);
    client.setLookupBody([row(9, { state: 'Resolved' })]);
    expect((await stats()).median_resolution_hours).toBeNull();
    expect((await stats()).totals.resolved_in_window).toBe(0);
  });
  it('returns deterministic top tens, including prototype-like labels safely', async () => {
    client.setLookupBody(Array.from({ length: 12 }, (_, i) => row(i + 1, {
      assignee: { email: String(i).padStart(2, '0') + '@acme.example' },
      category: { name: i === 0 ? '__proto__' : 'Category ' + String(i).padStart(2, '0') },
    })));
    const out = await stats();
    expect(out.by_assignee).toHaveLength(10);
    expect(out.by_assignee[0]).toEqual({ email: '00@acme.example', count: 1 });
    expect(out.by_category).toHaveLength(10);
    expect(out.by_category).toContainEqual({ category: '__proto__', count: 1 });
  });
  it('treats group-only assignments as unassigned individuals and tolerates missing labels', async () => {
    client.setLookupBody([row(1, { state: null, priority: null, category: null, assignee: { id: 5, is_user: false, email: 'it@acme.example' } })]);
    const out = await stats();
    expect(out.totals.unassigned).toBe(1);
    expect(out.by_assignee).toEqual([]);
    expect(out.by_state).toEqual([{ state: 'Unknown', count: 1 }]);
    expect(out.by_priority).toEqual([{ priority: 'Unknown', count: 1 }]);
  });
  it('returns an empty result with null median', async () => {
    const out = await stats();
    expect(Object.values(out.totals)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(out.median_resolution_hours).toBeNull();
    expect(out.by_state).toEqual([]);
  });
});

describe('swsd_ticket_stats paging and filters', () => {
  it('defaults to the last seven days, 25 rows, and sends separate date filters plus group ID', async () => {
    const out = await stats({ assigned_to_group: 17 });
    expect(out.window).toEqual(window);
    expect(client.calls).toEqual([
      { type: 'get', path: '/incidents.json', params: { created_from: window.from, created_to: window.to, assigned_to: 17, page: 1, per_page: 25 } },
      { type: 'get', path: '/incidents.json', params: { updated_at: ['greater_than', window.from], updated_to: window.to, assigned_to: 17, page: 1, per_page: 25 } },
    ]);
  });
  it('normalizes offsets and date-only input; defaults from relative to an explicit to', async () => {
    expect((await stats({ from: '2026-11-01', to: '2026-11-02T03:00:00+03:00' })).window)
      .toEqual({ from: '2026-11-01T00:00:00.000Z', to: '2026-11-02T00:00:00.000Z' });
    expect((await stats({ to: '2026-11-02' })).window.from).toBe('2026-10-26T00:00:00.000Z');
    expect((await stats({ from: '2026-11-01' })).window.to).toBe(window.to);
  });
  it('shares a hard default five-page budget between alternating queries and reports truncation', async () => {
    const get = vi.spyOn(client, 'get').mockResolvedValue(page([row(1)], true));
    const out = await stats();
    expect(get).toHaveBeenCalledTimes(5);
    expect(get.mock.calls.map(c => c[1]?.page)).toEqual([1, 1, 2, 2, 3]);
    expect(out.scan).toEqual({ pages_scanned: 5, truncated: true });
    expect(out.totals.total).toBe(1);
  });
  it('continues a remaining scan, follows next_page, and stops at exhaustion', async () => {
    const get = vi.spyOn(client, 'get')
      .mockResolvedValueOnce(page([row(1)], true, 3))
      .mockResolvedValueOnce(page([row(1), row(2)]))
      .mockResolvedValueOnce(page([row(3)]));
    const out = await stats({ per_page: 100, max_pages: 10 });
    expect(get.mock.calls.map(c => c[1]?.page)).toEqual([1, 1, 3]);
    expect(get.mock.calls.every(c => c[1]?.per_page === 100)).toBe(true);
    expect(out.scan).toEqual({ pages_scanned: 3, truncated: false });
    expect(out.totals.total).toBe(3);
  });
  it('marks an unstarted second scan truncated even when the first scan was empty', async () => {
    expect((await stats({ max_pages: 1 })).scan).toEqual({ pages_scanned: 1, truncated: true });
    expect(client.calls).toHaveLength(1);
  });
  it('retains the newer duplicate instead of counting it twice', async () => {
    vi.spyOn(client, 'get').mockResolvedValueOnce(page([row(1, { state: 'Resolved', updated_at: '2026-11-03T00:00:00Z' })]))
      .mockResolvedValueOnce(page([row(1)]));
    expect((await stats()).totals).toMatchObject({ total: 1, open: 0 });
  });
});

describe('swsd_ticket_stats validation and errors', () => {
  it.each([
    { max_pages: 0 }, { max_pages: 11 }, { max_pages: 1.5 }, { per_page: 0 }, { per_page: 101 },
    { per_page: 1.5 }, { assigned_to_group: 0 }, { assigned_to_group: -1 }, { assigned_to_group: 1.5 },
    { from: 'yesterday' }, { from: '2026-02-30' }, { to: '2026-11-04T12:00:00' }, { from: 'x'.repeat(65) },
  ])('rejects out-of-bounds input %j before network access', async (input) => {
    expect(TicketStatsInput.safeParse(input).success).toBe(false);
    expect(await tool.handler(input, {})).toMatchObject({ isError: true });
    expect(client.calls).toHaveLength(0);
  });
  it.each([
    { from: window.to, to: window.to }, { from: window.to, to: window.from },
  ])('rejects empty or reversed windows %j before network access', async input => {
    expect(await tool.handler(input, {})).toMatchObject({ isError: true });
    expect(client.calls).toHaveLength(0);
  });
  it('accepts inclusive numeric input bounds and schema defaults', () => {
    expect(TicketStatsInput.parse({})).toEqual({ max_pages: 5, per_page: 25 });
    expect(TicketStatsInput.safeParse({ max_pages: 1, per_page: 1, assigned_to_group: 1 }).success).toBe(true);
    expect(TicketStatsInput.safeParse({ max_pages: 10, per_page: 100 }).success).toBe(true);
  });
  it.each([new SwsdHttpError(403, 'Forbidden'), new SwsdHttpError(429, '', '10'), new SwsdNetworkError(new Error('offline'))])('maps API failures without partial success', async error => {
    vi.spyOn(client, 'get').mockResolvedValueOnce(page([row(1)])).mockRejectedValueOnce(error);
    const result = await tool.handler({}, {}) as { isError?: boolean; structuredContent?: unknown };
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });
  it('rejects unexpected list envelopes instead of claiming an empty scan', async () => {
    client.setLookupBody({ incidents: [] });
    expect(await tool.handler({}, {})).toMatchObject({ isError: true });
  });
  it('validates the Acme fixture and rejects unknown output keys at every object level', () => {
    expect(TicketStatsOutput.safeParse(fixture).success).toBe(true);
    for (const bad of [
      { ...fixture, extra: true }, { ...fixture, totals: { ...fixture.totals, extra: 1 } },
      { ...fixture, window: { ...fixture.window, extra: 1 } }, { ...fixture, scan: { ...fixture.scan, extra: 1 } },
      { ...fixture, by_state: [{ state: 'New', count: 1, extra: 1 }] },
      { ...fixture, by_priority: [{ priority: 'High', count: 1, extra: 1 }] },
      { ...fixture, by_assignee: [{ email: 'jane.doe@acme.example', count: 1, extra: 1 }] },
      { ...fixture, by_category: [{ category: 'Software', count: 1, extra: 1 }] },
    ]) expect(TicketStatsOutput.safeParse(bad).success).toBe(false);
    expect(z.toJSONSchema(TicketStatsOutput).additionalProperties).toBe(false);
  });
  it('has read-only annotations, a strict registered output schema, matching profiles and a readable widget resource', async () => {
    expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
    for (const names of Object.values(PROFILE_TOOLS)) {
      expect((names as readonly string[]).includes('swsd_ticket_stats')).toBe((names as readonly string[]).includes('swsd_sla_risk'));
    }
    const internals = server as unknown as {
      _registeredTools: Record<string, { _meta: { ui: { resourceUri: string } }; outputSchema: typeof TicketStatsOutput }>;
      _registeredResources: Record<string, { readCallback: (uri: URL) => Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> }>;
    };
    const registered = internals._registeredTools.swsd_ticket_stats!;
    expect(registered.outputSchema).toBe(TicketStatsOutput);
    const uri = registered._meta.ui.resourceUri;
    expect(uri).toBe('ui://swsd/ticket-stats.html');
    const resource = await internals._registeredResources[uri]!.readCallback(new URL(uri));
    expect(resource.contents[0]).toMatchObject({ uri, mimeType: 'text/html;profile=mcp-app' });
    expect(resource.contents[0]?.text).toContain('SWSD Ticket Stats');
  });
});
