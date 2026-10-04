import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerListMyIncidents } from '../../../src/tools/incidents/listMyIncidents.js';
import {
  makeFakeClient,
  getRegisteredTool,
  type FakeClient,
  type RegisteredToolInternals,
} from './_helpers/mockClient.js';
import type { ToolContext } from '../../../src/config/toolRegistry.js';

/**
 * End-to-end behavior tests for swsd_list_my_incidents.
 *
 * The handler:
 *   1. Decodes the JWT to get the user id.
 *   2. Calls /users/{id}.json to get the email + assignment status.
 *   3. Calls /incidents.json WITHOUT assignee_email (it's silently ignored
 *      upstream — verified live 2026-05-08; sending it would mislead).
 *   4. Client-filters the response by assignee.email === me.email.
 *
 * Tests cover:
 *   - assignee_email is NOT in the server params (regression guard against
 *     re-introducing the silently-ignored filter)
 *   - updated_within alias still translates correctly
 *   - explicit updated_from wins over updated_within
 *   - falsifiable narrow-test: response with mixed assignees is filtered
 *     to only the rows matching me.email
 *   - available_for_assignment=false surfaces the caveat in the summary
 */

// Build a JWT with payload { user_id: 42 } - signature is opaque (not verified).
const HEADER = Buffer.from(JSON.stringify({ alg: 'HS512' })).toString('base64url');
const PAYLOAD = Buffer.from(JSON.stringify({ user_id: 42, generated_at: '2026-05-07' })).toString(
  'base64url',
);
const TEST_JWT = `${HEADER}.${PAYLOAD}.signature`;

function makeCtxWithJwt(client: FakeClient): ToolContext {
  return {
    client,
    profile: 'agent',
    env: {} as never,
    enabledTools: [],
    token: TEST_JWT,
  } satisfies ToolContext;
}

interface StructuredToolResult {
  structuredContent?: Record<string, unknown>;
}

describe('swsd_list_my_incidents - server-side params', () => {
  let server: McpServer;
  let client: FakeClient;
  let tool: RegisteredToolInternals;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    client = makeFakeClient();
    registerListMyIncidents(server, makeCtxWithJwt(client));
    tool = getRegisteredTool(server, 'swsd_list_my_incidents');

    // /users/42.json returns the authenticated user; everything else returns [].
    client.setBodyForPath(
      (path) => path === '/users/42.json',
      { id: 42, email: 'me@example.com' },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does NOT send assignee_email server-side (it is silently ignored upstream — see verified_swsd_api_quirks.md)', async () => {
    await tool.handler({ page: 1, per_page: 25 }, {});

    const get = client.calls.find((c) => c.type === 'get' && c.path === '/incidents.json');
    expect(get).toBeDefined();
    const params = get?.type === 'get' ? get.params : {};
    // Regression guard: assignee_email MUST NOT appear in the wire params.
    // Sending it would echo a misleading "filter applied" signal to the SWSD
    // server logs without actually narrowing anything.
    expect(params).not.toHaveProperty('assignee_email');
    // Page/per_page are still sent.
    expect(params.page).toBe(1);
    expect(params.per_page).toBe(25);
  });

  it('translates updated_within to updated_at greater_than before sending', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-07T12:00:00Z'));

    await tool.handler({ page: 1, per_page: 25, updated_within: '7d' }, {});

    const get = client.calls.find((c) => c.type === 'get' && c.path === '/incidents.json');
    expect(get).toBeDefined();
    const params = get?.type === 'get' ? get.params : {};
    expect(params.updated_at).toEqual(['greater_than', '2026-04-30']);
    expect(params).not.toHaveProperty('updated_within');
    expect(params).not.toHaveProperty('assignee_email');
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
    expect(params.updated_at).toEqual(['greater_than', '2026-01-01']);
    expect(params).not.toHaveProperty('updated_within');
  });
});

describe('swsd_list_my_incidents - client-side filter', () => {
  let server: McpServer;
  let client: FakeClient;
  let tool: RegisteredToolInternals;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    client = makeFakeClient();
    registerListMyIncidents(server, makeCtxWithJwt(client));
    tool = getRegisteredTool(server, 'swsd_list_my_incidents');
  });

  it('falsifiable narrow-test: filters mixed-assignee response down to me.email', async () => {
    // Configure /users/42.json AND a mixed-assignee /incidents.json response.
    client.setBodyForPath(
      (path) => path === '/users/42.json',
      { id: 42, email: 'me@example.com', available_for_assignment: true },
    );
    client.setBodyForPath((path) => path === '/incidents.json', [
      // Match: assignee email matches me
      { id: 1, number: 60384, name: 'mine', assignee: { email: 'me@example.com' }, requester: { email: 'a@x.com' } },
      // No match: assigned to someone else
      { id: 2, number: 60383, name: 'theirs', assignee: { email: 'other@example.com' }, requester: { email: 'b@x.com' } },
      // No match: unassigned
      { id: 3, number: 60382, name: 'unassigned', assignee: null, requester: { email: 'c@x.com' } },
      // Match: case-insensitive email match
      { id: 4, number: 60381, name: 'mine-uppercase', assignee: { email: 'ME@example.com' }, requester: { email: 'd@x.com' } },
      // No match: missing assignee field entirely
      { id: 5, number: 60380, name: 'no-assignee-field', requester: { email: 'e@x.com' } },
    ]);

    const result = (await tool.handler({ page: 1, per_page: 25 }, {})) as StructuredToolResult;

    // The structured response only contains rows where assignee.email matches me@example.com.
    const sc = result.structuredContent ?? {};
    const incidents = sc.incidents as Array<{ id: number; assignee_email?: string }>;
    expect(incidents).toHaveLength(2);
    expect(incidents.map((i) => i.id).sort((a, b) => a - b)).toEqual([1, 4]);
    // Both surviving rows expose assignee_email lowercased-equivalent to me.
    for (const inc of incidents) {
      expect(inc.assignee_email?.toLowerCase()).toBe('me@example.com');
    }
    // Scan accounting reflects the filter.
    const scan = sc.scan as { candidates_scanned: number; matches_in_page: number; unscanned_candidates_remain: boolean };
    expect(scan.candidates_scanned).toBe(5);
    expect(scan.matches_in_page).toBe(2);
    // applied_filters echoes the email actually used as the client-side filter.
    const applied = sc.applied_filters as { assignee_email?: string };
    expect(applied.assignee_email).toBe('me@example.com');
  });

  it('returns 0 results gracefully when no candidates match (falsifiable null-test)', async () => {
    client.setBodyForPath(
      (path) => path === '/users/42.json',
      { id: 42, email: 'me@example.com', available_for_assignment: true },
    );
    client.setBodyForPath((path) => path === '/incidents.json', [
      { id: 1, name: 'a', assignee: { email: 'someone-else@example.com' }, requester: { email: 'r@x.com' } },
      { id: 2, name: 'b', assignee: { email: 'another@example.com' }, requester: { email: 's@x.com' } },
    ]);

    const result = (await tool.handler({ page: 1, per_page: 25 }, {})) as StructuredToolResult;
    const sc = result.structuredContent ?? {};
    const incidents = sc.incidents as unknown[];
    expect(incidents).toHaveLength(0);
    const scan = sc.scan as { candidates_scanned: number; matches_in_page: number };
    expect(scan.candidates_scanned).toBe(2);
    expect(scan.matches_in_page).toBe(0);
  });

  it('surfaces the available_for_assignment=false caveat when the user cannot be assigned tickets', async () => {
    // n.yarling-style admin: Administrator role + available_for_assignment=false.
    // The user is asking a sensible question ("my tickets") but the answer is
    // structurally 0 — the tool should make this explicit, not return empty
    // with no explanation.
    client.setBodyForPath(
      (path) => path === '/users/42.json',
      { id: 42, email: 'admin@example.com', available_for_assignment: false },
    );
    client.setBodyForPath((path) => path === '/incidents.json', [
      { id: 1, name: 'a', assignee: { email: 'agent1@example.com' }, requester: { email: 'r@x.com' } },
    ]);

    const result = (await tool.handler({ page: 1, per_page: 25 }, {})) as {
      structuredContent?: Record<string, unknown>;
      content?: Array<{ type: string; text: string }>;
    };
    // Structured: 0 matches.
    const sc = result.structuredContent ?? {};
    const incidents = sc.incidents as unknown[];
    expect(incidents).toHaveLength(0);
    // Text summary: caveat mentions available_for_assignment AND points to the
    // workaround (assigned_to=<group_id>).
    const text = result.content?.[0]?.text ?? '';
    expect(text).toContain('available_for_assignment=false');
    expect(text).toContain('assigned_to');
  });
});
