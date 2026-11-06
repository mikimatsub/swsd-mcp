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

/**
 * Server-side requester filter (`requested_by`).
 *
 * SWSD honours `requested_by[]=<requester id>` on /incidents.json (verified
 * live 2026-11-05), but the requester id is not the user id, so
 * requester_email is resolved through /requesters.json first. An email that
 * resolves to no requester (or a failed lookup) falls back to the
 * client-side filter above.
 */
describe('swsd_list_incidents - server-side requester filter', () => {
  let server: McpServer;
  let client: FakeClient;
  let tool: RegisteredToolInternals;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    client = makeFakeClient();
    registerListIncidents(server, makeCtx(client));
    tool = getRegisteredTool(server, 'swsd_list_incidents');
  });

  function incidentsParams(c: FakeClient): Record<string, unknown> {
    const get = c.calls.find((call) => call.type === 'get' && call.path === '/incidents.json');
    return get?.type === 'get' ? get.params : {};
  }

  it('resolves requester_email via /requesters.json and sends requested_by server-side', async () => {
    client.setBodyForPath((p) => p === '/requesters.json', [
      { id: 501, user_id: 9001, name: 'Alice', description: 'Alice@Example.com' },
    ]);
    client.setBodyForPath((p) => p === '/incidents.json', [
      { id: 1, name: 'a', requester: { email: 'alice@example.com' } },
      { id: 2, name: 'b', requester: { email: 'ALICE@example.com' } },
    ]);

    const result = (await tool.handler(
      { page: 1, per_page: 25, requester_email: 'alice@example.com' },
      {},
    )) as StructuredToolResult;

    const lookup = client.calls.find((c) => c.type === 'get' && c.path === '/requesters.json');
    expect(lookup?.type === 'get' ? lookup.params : {}).toEqual({ email: 'alice@example.com' });
    const params = incidentsParams(client);
    expect(params.requested_by).toEqual([501]);
    expect(params).not.toHaveProperty('requester_email');

    const sc = result.structuredContent ?? {};
    expect((sc.incidents as Array<{ id: number }>).map((i) => i.id)).toEqual([1, 2]);
    expect(sc.applied_filters).toMatchObject({ requester_email: 'alice@example.com', requester_ids: [501] });
    const scan = sc.scan as { client_filter_applied: boolean; matches_in_page: number };
    expect(scan.client_filter_applied).toBe(false);
    expect(scan.matches_in_page).toBe(2);
  });

  it('sends every exact-match requester id and ignores rows for other emails', async () => {
    client.setBodyForPath((p) => p === '/requesters.json', [
      { id: 501, description: 'alice@example.com' },
      { id: 502, description: 'alice@example.com' },
      { id: 503, description: 'alice@example.com.au' },
      { id: '504', description: 'alice@example.com' },
      null,
    ]);

    await tool.handler({ page: 1, per_page: 25, requester_email: 'alice@example.com' }, {});

    expect(incidentsParams(client).requested_by).toEqual([501, 502]);
  });

  it('falls back to the client-side filter when no requester matches the email', async () => {
    client.setBodyForPath((p) => p === '/requesters.json', []);
    client.setBodyForPath((p) => p === '/incidents.json', [
      { id: 1, name: 'mine', requester: { email: 'r@x.com' } },
      { id: 2, name: 'theirs', requester: { email: 's@x.com' } },
    ]);

    const result = (await tool.handler(
      { page: 1, per_page: 25, requester_email: 'r@x.com' },
      {},
    )) as StructuredToolResult;

    expect(incidentsParams(client)).not.toHaveProperty('requested_by');
    const sc = result.structuredContent ?? {};
    expect((sc.incidents as Array<{ id: number }>).map((i) => i.id)).toEqual([1]);
    expect(sc.applied_filters).not.toHaveProperty('requester_ids');
    expect((sc.scan as { client_filter_applied: boolean }).client_filter_applied).toBe(true);
  });

  it('falls back to the client-side filter when the requester lookup fails', async () => {
    const failing: FakeClient = {
      ...client,
      get: async <T>(path: string, params: Record<string, unknown> = {}) => {
        if (path === '/requesters.json') throw new Error('lookup unavailable');
        return client.get<T>(path, params);
      },
    };
    const failingServer = new McpServer({ name: 'test', version: '0.0.0' });
    registerListIncidents(failingServer, makeCtx(failing));
    const failingTool = getRegisteredTool(failingServer, 'swsd_list_incidents');
    client.setBodyForPath((p) => p === '/incidents.json', [
      { id: 1, name: 'mine', requester: { email: 'r@x.com' } },
      { id: 2, name: 'theirs', requester: { email: 's@x.com' } },
    ]);

    const result = (await failingTool.handler(
      { page: 1, per_page: 25, requester_email: 'r@x.com' },
      {},
    )) as StructuredToolResult;

    expect(incidentsParams(client)).not.toHaveProperty('requested_by');
    const incidents = (result.structuredContent?.incidents ?? []) as Array<{ id: number }>;
    expect(incidents.map((i) => i.id)).toEqual([1]);
  });

  it('does not look up requesters when requester_email is not given', async () => {
    await tool.handler({ page: 1, per_page: 25 }, {});

    expect(client.calls.some((c) => c.path === '/requesters.json')).toBe(false);
    expect(incidentsParams(client)).not.toHaveProperty('requested_by');
  });
});
