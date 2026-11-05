import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import { EnvSchema } from '../../../src/config/env.js';
import { PROFILE_TOOLS } from '../../../src/config/profiles.js';
import { registerTools } from '../../../src/config/toolRegistry.js';
import { UpdateTaskInput } from '../../../src/schemas/task.js';
import { createSwsdClient } from '../../../src/swsd/client.js';
import { SwsdHttpError, SwsdNetworkError } from '../../../src/swsd/errors.js';
import { registerUpdateTask } from '../../../src/tools/tasks/updateTask.js';
import { registerDeleteComment } from '../../../src/tools/comments/deleteComment.js';
import { registerDeleteTask } from '../../../src/tools/tasks/deleteTask.js';
import { registerDeleteTimeTrack } from '../../../src/tools/timeTracks/timeTrackTools.js';
import { getRegisteredTool, makeCtx, makeFakeClient } from './_helpers/mockClient.js';

const INCIDENT_ID = 195000010;
const INCIDENT_NUMBER = 4501;
const SUB_ID = 71;
const SECRET = 'synthetic-private-metadata';
type Mode = 'live' | 'dry-run' | 'disabled';

function setupUpdate(mode: Mode = 'live') {
  const client = makeFakeClient();
  client.setPutResponse({ id: SUB_ID, name: 'Synthetic task', is_complete: false });
  const server = new McpServer({ name: 'subresource-update-test', version: '0.0.0' });
  registerUpdateTask(server, makeCtx(client, { SWSD_WRITE_MODE: mode }));
  const tool = getRegisteredTool(server, 'swsd_update_task');
  const invoke = async (input: z.input<typeof UpdateTaskInput>) =>
    await tool.handler(UpdateTaskInput.parse(input), {}) as CallToolResult;
  return { client, tool, invoke, path: `/incidents/${String(INCIDENT_ID)}/tasks/${String(SUB_ID)}.json` };
}

const DELETES = [
  {
    kind: 'comment', name: 'swsd_delete_comment', register: registerDeleteComment,
    collection: 'comments', idField: 'comment_id', envelope: 'comment',
    raw: { id: SUB_ID, body: 'x'.repeat(120) + SECRET, user: { email: 'author@example.test', name: SECRET }, private_metadata: SECRET },
    identity: { id: SUB_ID, incident_id: INCIDENT_ID, author_email: 'author@example.test', body: 'x'.repeat(120) },
    minimal: { id: SUB_ID, incident_id: INCIDENT_ID, author_email: null, body: '' },
  },
  {
    kind: 'task', name: 'swsd_delete_task', register: registerDeleteTask,
    collection: 'tasks', idField: 'task_id', envelope: 'task',
    raw: { id: SUB_ID, name: 'Synthetic task', is_complete: false, description: SECRET, assignee: { email: 'assignee@example.test' } },
    identity: { id: SUB_ID, incident_id: INCIDENT_ID, name: 'Synthetic task', is_complete: false },
    minimal: { id: SUB_ID, incident_id: INCIDENT_ID, name: '', is_complete: null },
  },
  {
    kind: 'time track', name: 'swsd_delete_time_track', register: registerDeleteTimeTrack,
    collection: 'time_tracks', idField: 'time_track_id', envelope: 'time_track',
    raw: { id: SUB_ID, name: 'Synthetic work', minutes: '35', creator: { email: 'creator@example.test', name: SECRET }, private_metadata: SECRET },
    identity: { id: SUB_ID, incident_id: INCIDENT_ID, name: 'Synthetic work', minutes: 35, creator_email: 'creator@example.test' },
    minimal: { id: SUB_ID, incident_id: INCIDENT_ID, name: '', minutes: null, creator_email: null },
  },
] as const;

type DeleteCase = typeof DELETES[number];

function setupDelete(config: DeleteCase, mode: Mode = 'live') {
  const client = makeFakeClient();
  client.setLookupBody([{ id: SUB_ID + 1, name: 'Other record' }, config.raw]);
  client.setDeleteResponse({ private_metadata: SECRET });
  const server = new McpServer({ name: 'subresource-delete-test', version: '0.0.0' });
  config.register(server, makeCtx(client, { SWSD_WRITE_MODE: mode }));
  const tool = getRegisteredTool(server, config.name);
  const schema = tool.inputSchema as z.ZodType;
  const input = { incident_id: INCIDENT_ID, [config.idField]: SUB_ID };
  const invoke = async (overrides: Record<string, unknown> = {}) =>
    await tool.handler(schema.parse({ ...input, ...overrides }), {}) as CallToolResult;
  const base = `/incidents/${String(INCIDENT_ID)}/${config.collection}`;
  const path = `${base}/${String(SUB_ID)}.json`;
  const listPath = `${base}.json`;
  const listCall = { type: 'get', path: listPath, params: { page: 1, per_page: 100 } };
  return { client, tool, schema, input, invoke, path, listPath, listCall };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('swsd_update_task', () => {
  const input = {
    incident_id: INCIDENT_ID, task_id: SUB_ID, name: 'Renamed synthetic task',
    assignee_email: 'assignee@example.test', due_at: '2030-01-02T03:04:05-05:00', is_complete: false,
  };
  const payload = {
    task: { name: input.name, assignee: { email: input.assignee_email }, due_at: input.due_at, is_complete: false },
  };

  it('previews the full payload in dry-run without a PUT', async () => {
    const { client, invoke, path } = setupUpdate('dry-run');
    const result = await invoke(input);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ dry_run: true, request: { method: 'PUT', path, body: payload } });
    expect(client.calls).toEqual([]);
  });

  it('blocks disabled writes', async () => {
    const { client, invoke } = setupUpdate('disabled');
    const result = await invoke(input);
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('SWSD_WRITE_MODE=disabled');
    expect(client.calls).toEqual([]);
  });

  it('sends the exact live payload and reports changed_fields', async () => {
    const { client, tool, invoke, path } = setupUpdate();
    client.setPutResponse({ task: { id: SUB_ID, name: input.name, is_complete: false, due_at: input.due_at } });
    const result = await invoke(input);
    expect(result.isError).toBeUndefined();
    expect(client.calls).toEqual([{ type: 'put', path, body: payload }]);
    expect(result.structuredContent).toMatchObject({
      task: { id: SUB_ID, name: input.name, is_complete: false, completed: false, due_at: input.due_at },
      changed_fields: ['name', 'due_at', 'assignee', 'is_complete'],
    });
    expect(tool.annotations).toEqual({ readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: false });
  });

  it.each([true, false])('sends is_complete=%s without adding omitted fields or translating to state', async (is_complete) => {
    const { client, invoke, path } = setupUpdate();
    client.setPutResponse({ id: SUB_ID, name: 'Synthetic task', is_complete });
    const result = await invoke({ incident_id: INCIDENT_ID, task_id: SUB_ID, is_complete });
    expect(client.calls).toEqual([{ type: 'put', path, body: { task: { is_complete } } }]);
    expect(result.structuredContent).toMatchObject({ task: { is_complete, completed: is_complete }, changed_fields: ['is_complete'] });
  });

  it('rejects an empty update before any incident lookup or write', async () => {
    const { client, invoke } = setupUpdate();
    const result = await invoke({ incident_id: INCIDENT_NUMBER, task_id: SUB_ID });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('No fields to update');
    expect(client.calls).toEqual([]);
  });

  it.each(['live', 'dry-run'] as const)('resolves an incident number before the %s request', async (mode) => {
    const { client, invoke, path } = setupUpdate(mode);
    client.setLookupBody([
      { id: INCIDENT_ID + 1, number: INCIDENT_NUMBER + 1, name: 'Substring collision 4501' },
      { id: INCIDENT_ID, number: INCIDENT_NUMBER },
    ]);
    const result = await invoke({ incident_id: INCIDENT_NUMBER, task_id: SUB_ID, name: input.name });
    expect(result.isError).toBeUndefined();
    expect(client.calls).toEqual([
      { type: 'get', path: '/incidents.json', params: { query: INCIDENT_NUMBER, per_page: 25 } },
      ...(mode === 'live' ? [{ type: 'put', path, body: { task: { name: input.name } } }] : []),
    ]);
    if (mode === 'dry-run') expect(result.structuredContent?.request).toEqual({ method: 'PUT', path, body: { task: { name: input.name } } });
  });

  it('reports an unresolved incident number without writing', async () => {
    const { client, invoke } = setupUpdate();
    const result = await invoke({ incident_id: INCIDENT_NUMBER, task_id: SUB_ID, name: input.name });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('No incident found with number');
    expect(client.calls).toEqual([{ type: 'get', path: '/incidents.json', params: { query: INCIDENT_NUMBER, per_page: 25 } }]);
  });

  it('accepts exact string bounds and rejects invalid fields', () => {
    const emailAtLimit = 'a'.repeat(64) + '@' + 'b'.repeat(63) + '.' + 'c'.repeat(63) + '.' + 'd'.repeat(63) + '.' + 'e'.repeat(63);
    expect(emailAtLimit.length).toBe(320);
    expect(UpdateTaskInput.safeParse({ ...input, name: 'x'.repeat(500), assignee_email: emailAtLimit }).success).toBe(true);
    for (const [field, value] of [
      ['name', ''], ['name', 'x'.repeat(501)], ['assignee_email', 'not-email'], ['assignee_email', 'x' + emailAtLimit],
      ['due_at', '2030-01-02'], ['due_at', '2030-02-30T00:00:00Z'], ['due_at', 'x'.repeat(65)], ['due_at', '2030-01-02T03:04:05'],
      ['is_complete', 'false'], ['is_complete', null],
      ...['incident_id', 'task_id'].flatMap((key) => [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, '71'].map((value) => [key, value])),
    ]) {
      expect(UpdateTaskInput.safeParse({ ...input, [field as string]: value }).success, String(field)).toBe(false);
    }
    expect(UpdateTaskInput.safeParse({ ...input, due_at: '2030-01-02T03:04:05Z' }).success).toBe(true);
  });

  it('maps a failed PUT without retrying or claiming success', async () => {
    const { client, invoke, path } = setupUpdate();
    const put = vi.spyOn(client, 'put').mockRejectedValue(new SwsdHttpError(503, 'Synthetic unavailable'));
    const result = await invoke(input);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(put).toHaveBeenCalledExactlyOnceWith(path, payload);
  });

  it('rejects an unparseable update response', async () => {
    const { client, invoke, path } = setupUpdate();
    client.setPutResponse({ task: null });
    const result = await invoke(input);
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('Could not parse updated-task');
    expect(client.calls).toEqual([{ type: 'put', path, body: payload }]);
  });
});

describe.each(DELETES)('$name', (config) => {
  it('declares the destructive description, annotations, and bounded ids', () => {
    const { tool, schema, input } = setupDelete(config);
    expect(tool.description).toMatch(/^DESTRUCTIVE/);
    expect(tool.annotations).toEqual({ readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: true });
    expect(schema.parse(input)).toEqual({ ...input, confirm: false });
    for (const field of ['incident_id', config.idField, 'confirm_id']) {
      for (const value of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, '71']) {
        expect(schema.safeParse({ ...input, [field]: value }).success, field).toBe(false);
      }
    }
    expect(schema.safeParse({ ...input, confirm: 'true' }).success).toBe(false);
  });

  it('blocks disabled mode before number resolution, list lookup, or DELETE', async () => {
    const { client, invoke } = setupDelete(config, 'disabled');
    const result = await invoke({ incident_id: INCIDENT_NUMBER, confirm: true, confirm_id: SUB_ID });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('SWSD_WRITE_MODE=disabled');
    expect(client.calls).toEqual([]);
  });

  it.each([
    { label: 'unconfirmed', confirmation: {} },
    { label: 'confirm false', confirmation: { confirm: false, confirm_id: SUB_ID } },
    { label: 'missing confirm_id', confirmation: { confirm: true } },
    { label: 'wrong confirm_id', confirmation: { confirm: true, confirm_id: SUB_ID + 1 } },
    { label: 'incident id as confirm_id', confirmation: { confirm: true, confirm_id: INCIDENT_ID } },
  ])('returns an identity-only preview when $label', async ({ confirmation }) => {
    const { client, invoke, path, listCall } = setupDelete(config);
    const result = await invoke(confirmation);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      confirmation_required: true, would_delete: config.identity,
      request: { method: 'DELETE', path }, hint: expect.stringContaining(`confirm_id:${String(SUB_ID)}`),
    });
    expect(JSON.stringify(result.content)).toContain('Ask the user');
    expect(JSON.stringify(result.content)).toContain('confirm:true');
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(client.calls).toEqual([listCall]);
  });

  it('previews dry-run even with matching confirmation', async () => {
    const { client, invoke, path, listCall } = setupDelete(config, 'dry-run');
    const result = await invoke({ confirm: true, confirm_id: SUB_ID });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      dry_run: true, would_delete: config.identity,
      request: { method: 'DELETE', path }, hint: expect.stringContaining(`confirm_id:${String(SUB_ID)}`),
    });
    expect(client.calls).toEqual([listCall]);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('returns not-found without DELETE when the sub-record is absent', async () => {
    const { client, invoke, listCall } = setupDelete(config);
    client.setLookupBody([{ ...config.raw, id: SUB_ID + 1 }]);
    const result = await invoke({ confirm: true, confirm_id: SUB_ID });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('not found on incident');
    expect(result.structuredContent).toBeUndefined();
    expect(client.calls).toEqual([listCall]);
  });

  it('fetches the list then sends one confirmed DELETE with an audit-friendly result', async () => {
    const { client, invoke, path, listCall } = setupDelete(config);
    const result = await invoke({ confirm: true, confirm_id: SUB_ID });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ deleted: true, record: config.identity, request: { method: 'DELETE', path } });
    expect(client.calls).toEqual([listCall, { type: 'delete', path }]);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('resolves the incident number while confirming the sub-record id', async () => {
    const { client, invoke, listPath, path, listCall } = setupDelete(config);
    client.setLookupBody([{ id: INCIDENT_ID + 1, number: INCIDENT_NUMBER + 1 }, { id: INCIDENT_ID, number: INCIDENT_NUMBER }]);
    client.setBodyForPath((p) => p === listPath, [config.raw]);
    const result = await invoke({ incident_id: INCIDENT_NUMBER, confirm: true, confirm_id: SUB_ID });
    expect(result.structuredContent).toEqual({ deleted: true, record: config.identity, request: { method: 'DELETE', path } });
    expect(client.calls).toEqual([
      { type: 'get', path: '/incidents.json', params: { query: INCIDENT_NUMBER, per_page: 25 } },
      listCall, { type: 'delete', path },
    ]);
  });

  it('accepts named list-row envelopes and numeric-string sub-record ids', async () => {
    const { client, invoke } = setupDelete(config);
    client.setLookupBody([{ [config.envelope]: { ...config.raw, id: String(SUB_ID) } }]);
    const result = await invoke();
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.would_delete).toEqual(config.identity);
  });

  it('does not invent missing optional identity data', async () => {
    const { client, invoke } = setupDelete(config);
    client.setLookupBody([{ id: SUB_ID }]);
    const result = await invoke();
    expect(result.structuredContent?.would_delete).toEqual(config.minimal);
  });

  it('finds a sub-record on a later list page', async () => {
    const { client, invoke, listPath } = setupDelete(config);
    const get = vi.spyOn(client, 'get')
      .mockResolvedValueOnce({ body: [{ ...config.raw, id: SUB_ID + 1 }], headers: new Headers(), pagination: { page: 1, per_page: 100, has_more: true, next_page: 2 } })
      .mockResolvedValueOnce({ body: [config.raw], headers: new Headers(), pagination: { page: 2, per_page: 100, has_more: false } });
    const result = await invoke();
    expect(result.structuredContent?.would_delete).toEqual(config.identity);
    expect(get.mock.calls).toEqual([[listPath, { page: 1, per_page: 100 }], [listPath, { page: 2, per_page: 100 }]]);
    expect(client.calls).toEqual([]);
  });

  it('reports not-found only after reaching the last list page', async () => {
    const { client, invoke, listPath } = setupDelete(config);
    const get = vi.spyOn(client, 'get')
      .mockResolvedValueOnce({ body: [{ ...config.raw, id: SUB_ID + 1 }], headers: new Headers(), pagination: { page: 1, per_page: 100, has_more: true } })
      .mockResolvedValueOnce({ body: [], headers: new Headers(), pagination: { page: 2, per_page: 100, has_more: false } });
    const result = await invoke({ confirm: true, confirm_id: SUB_ID });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('not found on incident');
    expect(get.mock.calls).toEqual([[listPath, { page: 1, per_page: 100 }], [listPath, { page: 2, per_page: 100 }]]);
    expect(client.calls).toEqual([]);
  });

  it.each([null, 'invalid', { id: SUB_ID }])('rejects a malformed parent list: %s', async (body) => {
    const { client, invoke, listCall } = setupDelete(config);
    client.setLookupBody(body);
    const result = await invoke({ confirm: true, confirm_id: SUB_ID });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('Could not verify');
    expect(client.calls).toEqual([listCall]);
  });

  it('maps upstream list errors without sending DELETE', async () => {
    const { client, invoke, listPath } = setupDelete(config);
    const get = vi.spyOn(client, 'get').mockRejectedValue(new SwsdHttpError(404, 'Synthetic missing incident'));
    const result = await invoke({ confirm: true, confirm_id: SUB_ID });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('Not found: Synthetic missing incident');
    expect(get).toHaveBeenCalledExactlyOnceWith(listPath, { page: 1, per_page: 100 });
    expect(client.calls).toEqual([]);
  });

  it.each([
    [new SwsdHttpError(403, 'Synthetic forbidden'), 'Forbidden.'],
    [new SwsdHttpError(503, 'Synthetic unavailable'), 'SWSD server error (503)'],
    [new SwsdNetworkError(new Error('Synthetic network failure')), 'Network error contacting SWSD'],
  ])('maps upstream DELETE errors without retrying: %s', async (error, message) => {
    const { client, invoke, path, listCall } = setupDelete(config);
    const remove = vi.spyOn(client, 'delete').mockRejectedValue(error);
    const result = await invoke({ confirm: true, confirm_id: SUB_ID });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(JSON.stringify(result.content)).toContain(message);
    expect(remove).toHaveBeenCalledExactlyOnceWith(path);
    expect(client.calls).toEqual([listCall]);
  });

  it.each([204, 503])('sends one bodyless HTTP DELETE when upstream returns %s', async (status) => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify([config.raw]), { headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(status === 204 ? null : 'Synthetic unavailable', { status }));
    vi.stubGlobal('fetch', fetchMock);
    const env = EnvSchema.parse({ SWSD_WRITE_MODE: 'live', SWSD_RETRY_MAX_ATTEMPTS: 3, SWSD_BASE_URL: 'https://api.samanage.com' });
    const client = createSwsdClient({ env, token: SECRET });
    const server = new McpServer({ name: 'subresource-http-test', version: '0.0.0' });
    config.register(server, makeCtx(client, env));
    const result = await getRegisteredTool(server, config.name).handler({ incident_id: INCIDENT_ID, [config.idField]: SUB_ID, confirm: true, confirm_id: SUB_ID }, {}) as CallToolResult;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`https://api.samanage.com/incidents/${String(INCIDENT_ID)}/${config.collection}/${String(SUB_ID)}.json`);
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('DELETE');
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBeUndefined();
    if (status === 204) expect(result.structuredContent?.deleted).toBe(true);
    else {
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
    }
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});

describe('sub-resource identity compatibility and profiles', () => {
  it('uses legacy task state when is_complete is absent and prefers an explicit boolean', async () => {
    const { client, invoke } = setupDelete(DELETES[1]);
    client.setLookupBody([{ id: SUB_ID, name: 'Synthetic task', state: 'Completed' }]);
    expect((await invoke()).structuredContent?.would_delete).toMatchObject({ is_complete: true });
    client.setLookupBody([{ id: SUB_ID, name: 'Synthetic task', state: 'Completed', is_complete: false }]);
    expect((await invoke()).structuredContent?.would_delete).toMatchObject({ is_complete: false });
  });

  it('uses the existing minutes_parsed mapper when minutes is absent', async () => {
    const { client, invoke } = setupDelete(DELETES[2]);
    client.setLookupBody([{ id: SUB_ID, name: 'Synthetic work', minutes_parsed: 0 }]);
    expect((await invoke()).structuredContent?.would_delete).toMatchObject({ minutes: 0, creator_email: null });
  });

  it('registers update_task with update_task_state and deletes only through delete profiles', () => {
    for (const profile of ['triage', 'agent', 'knowledge', 'operations'] as const) {
      const server = new McpServer({ name: 'subresource-profile-test', version: '0.0.0' });
      const ctx = makeCtx(makeFakeClient(), { SWSD_ENABLE_EXTRAS: [] });
      ctx.profile = profile;
      registerTools(server, ctx);
      const names: readonly string[] = PROFILE_TOOLS[profile];
      expect(names.includes('swsd_update_task')).toBe(names.includes('swsd_update_task_state'));
      expect(ctx.enabledTools.includes('swsd_update_task')).toBe(names.includes('swsd_update_task_state'));
      for (const { name } of DELETES) {
        const enabled = profile === 'operations';
        expect(names.includes(name), profile + ':' + name).toBe(enabled);
        expect(ctx.enabledTools.includes(name), profile + ':' + name).toBe(enabled);
        if (enabled) expect(getRegisteredTool(server, name)).toBeDefined();
      }
    }
  });
});
