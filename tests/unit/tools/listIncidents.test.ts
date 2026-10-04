import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerListIncidents } from '../../../src/tools/incidents/listIncidents.js';
import {
  makeFakeClient,
  makeCtx,
  getRegisteredTool,
  type FakeClient,
  type RegisteredToolInternals,
} from './_helpers/mockClient.js';

/**
 * End-to-end alias-translation tests for swsd_list_incidents.
 *
 * Asserts:
 *   1. `updated_within: '7d'` becomes `updated_at: ['greater_than', '<7-days-ago>']`
 *      in the GET params (the SWSD wire shape for `updated_from`).
 *   2. `updated_within` is NOT forwarded to the underlying client.
 *   3. Explicit `updated_from` wins over `updated_within` (no override).
 */
describe('swsd_list_incidents - updated_within alias', () => {
  let server: McpServer;
  let client: FakeClient;
  let tool: RegisteredToolInternals;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    client = makeFakeClient();
    registerListIncidents(server, makeCtx(client));
    tool = getRegisteredTool(server, 'swsd_list_incidents');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('translates updated_within to updated_at greater_than before sending', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-07T12:00:00Z'));

    await tool.handler(
      { page: 1, per_page: 25, updated_within: '7d' },
      {},
    );

    const get = client.calls.find((c) => c.type === 'get' && c.path === '/incidents.json');
    expect(get).toBeDefined();
    const params = get?.type === 'get' ? get.params : {};
    expect(params.updated_at).toEqual(['greater_than', '2026-04-30']);
    // updated_within is internal-only and must not leak to SWSD.
    expect(params).not.toHaveProperty('updated_within');
  });

  it('respects explicit updated_from over updated_within', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-07T12:00:00Z'));

    await tool.handler(
      {
        page: 1,
        per_page: 25,
        updated_within: '7d',
        updated_from: '2026-01-01',
      },
      {},
    );

    const get = client.calls.find((c) => c.type === 'get' && c.path === '/incidents.json');
    const params = get?.type === 'get' ? get.params : {};
    // The explicit value wins - NOT the 7-days-ago value.
    expect(params.updated_at).toEqual(['greater_than', '2026-01-01']);
    expect(params).not.toHaveProperty('updated_within');
  });
});

/**
 * Client-side party filter (assignee_email / requester_email).
 *
 * SWSD's /incidents.json silently ignores `assignee_email` and `requester_email`
 * (verified live 2026-05-08: a fake email returns the entire 56,829-row tenant).
 * The fix: don't send those filters server-side — apply them client-side after
 * the response lands. These tests pin down both the regression guard (params
 * don't include the broken filter) and the behavior (response is filtered).
 */
interface StructuredToolResult {
  structuredContent?: Record<string, unknown>;
}

describe('swsd_list_incidents - client-side party filter', () => {
  let server: McpServer;
  let client: FakeClient;
  let tool: RegisteredToolInternals;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    client = makeFakeClient();
    registerListIncidents(server, makeCtx(client));
    tool = getRegisteredTool(server, 'swsd_list_incidents');
  });

  it('does NOT send assignee_email / requester_email server-side (regression guard)', async () => {
    client.setLookupBody([]);
    await tool.handler(
      { page: 1, per_page: 25, assignee_email: 'a@x.com', requester_email: 'r@x.com' },
      {},
    );
    const get = client.calls.find((c) => c.type === 'get' && c.path === '/incidents.json');
    const params = get?.type === 'get' ? get.params : {};
    // Both broken filters MUST stay client-side.
    expect(params).not.toHaveProperty('assignee_email');
    expect(params).not.toHaveProperty('requester_email');
  });

  it('falsifiable narrow-test: client-side assignee_email filter narrows mixed response', async () => {
    client.setLookupBody([
      { id: 1, name: 'mine', assignee: { email: 'a@x.com' }, requester: { email: 'r@x.com' } },
      { id: 2, name: 'theirs', assignee: { email: 'b@x.com' }, requester: { email: 'r@x.com' } },
      { id: 3, name: 'unassigned', assignee: null, requester: { email: 'r@x.com' } },
      { id: 4, name: 'mine-uppercase', assignee: { email: 'A@X.com' }, requester: { email: 'r@x.com' } },
    ]);

    const result = (await tool.handler(
      { page: 1, per_page: 25, assignee_email: 'a@x.com' },
      {},
    )) as StructuredToolResult;

    const sc = result.structuredContent ?? {};
    const incidents = sc.incidents as Array<{ id: number }>;
    expect(incidents.map((i) => i.id).sort((a, b) => a - b)).toEqual([1, 4]);
    const scan = sc.scan as { client_filter_applied: boolean; matches_in_page: number; candidates_scanned: number };
    expect(scan.client_filter_applied).toBe(true);
    expect(scan.candidates_scanned).toBe(4);
    expect(scan.matches_in_page).toBe(2);
  });

  it('combined assignee_email AND requester_email — both must match', async () => {
    client.setLookupBody([
      // Match both
      { id: 1, name: 'both', assignee: { email: 'a@x.com' }, requester: { email: 'r@x.com' } },
      // Match assignee only
      { id: 2, name: 'asg-only', assignee: { email: 'a@x.com' }, requester: { email: 'other@x.com' } },
      // Match requester only
      { id: 3, name: 'req-only', assignee: { email: 'other@x.com' }, requester: { email: 'r@x.com' } },
      // Match neither
      { id: 4, name: 'neither', assignee: { email: 'x@x.com' }, requester: { email: 'y@x.com' } },
    ]);

    const result = (await tool.handler(
      { page: 1, per_page: 25, assignee_email: 'a@x.com', requester_email: 'r@x.com' },
      {},
    )) as StructuredToolResult;
    const incidents = (result.structuredContent?.incidents ?? []) as Array<{ id: number }>;
    expect(incidents.map((i) => i.id)).toEqual([1]);
  });

  it('client_filter_applied=false when no party filter is given (no behavior change)', async () => {
    client.setLookupBody([
      { id: 1, name: 'a', assignee: { email: 'a@x.com' }, requester: { email: 'r@x.com' } },
      { id: 2, name: 'b', assignee: { email: 'b@x.com' }, requester: { email: 's@x.com' } },
    ]);
    const result = (await tool.handler({ page: 1, per_page: 25 }, {})) as StructuredToolResult;
    const sc = result.structuredContent ?? {};
    const scan = sc.scan as { client_filter_applied: boolean; matches_in_page: number };
    expect(scan.client_filter_applied).toBe(false);
    // Without a party filter, all candidates pass through unchanged.
    expect(scan.matches_in_page).toBe(2);
  });
});
