import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import { EnvSchema } from '../../../src/config/env.js';
import { PROFILE_TOOLS } from '../../../src/config/profiles.js';
import { registerTools } from '../../../src/config/toolRegistry.js';
import { createSwsdClient } from '../../../src/swsd/client.js';
import { SwsdHttpError, SwsdNetworkError } from '../../../src/swsd/errors.js';
import { registerSafeDelete, SafeDeleteInput } from '../../../src/tools/shared/safeDelete.js';
import { registerDeleteIncident } from '../../../src/tools/incidents/deleteIncident.js';
import { registerDeleteProblem } from '../../../src/tools/problems/deleteProblem.js';
import { registerDeleteChange } from '../../../src/tools/records/deleteChange.js';
import { registerDeleteRelease } from '../../../src/tools/records/deleteRelease.js';
import { registerDeleteSolution } from '../../../src/tools/solutions/deleteSolution.js';
import {
  registerDeleteUser,
  registerDeleteGroup,
  registerDeleteSite,
  registerDeleteDepartment,
  registerDeleteCategory,
  registerDeleteRole,
} from '../../../src/tools/lookups/directoryWrites.js';
import { makeCtx, makeFakeClient, getRegisteredTool } from './_helpers/mockClient.js';

const ID = 195000010;
const NUMBER = 4501;
const TOKEN = 'synthetic-delete-secret';
const RECORD = { id: ID, number: NUMBER, name: 'Synthetic record', state: 'New' };
const REGISTRARS = {
  incident: registerDeleteIncident,
  problem: registerDeleteProblem,
  change: registerDeleteChange,
  release: registerDeleteRelease,
  solution: registerDeleteSolution,
  user: registerDeleteUser,
  group: registerDeleteGroup,
  site: registerDeleteSite,
  department: registerDeleteDepartment,
  category: registerDeleteCategory,
  role: registerDeleteRole,
};
type Kind = keyof typeof REGISTRARS;
type Mode = 'live' | 'dry-run' | 'disabled';

function setup(kind: Kind, mode: Mode = 'live') {
  const client = makeFakeClient();
  const path = `/${kind === 'category' ? 'categories' : `${kind}s`}/${String(ID)}.json`;
  client.setBodyForPath((p) => p === path, { ...RECORD, private_metadata: TOKEN });
  client.setDeleteResponse({ deleted_ids: [String(ID)] });
  const ctx = makeCtx(client, { SWSD_WRITE_MODE: mode });
  ctx.token = TOKEN;
  const server = new McpServer({ name: 'safe-delete-test', version: '0.0.0' });
  REGISTRARS[kind](server, ctx);
  const tool = getRegisteredTool(server, `swsd_delete_${kind}`);
  const invoke = async (input: z.input<typeof SafeDeleteInput>) =>
    await tool.handler(SafeDeleteInput.parse(input), {}) as CallToolResult;
  return { client, tool, invoke, path };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each(Object.keys(REGISTRARS) as Kind[])('swsd_delete_%s', (kind) => {
  it('starts its description with DESTRUCTIVE and declares all delete annotations', () => {
    const { tool } = setup(kind);
    expect(tool.description).toMatch(/^DESTRUCTIVE/);
    expect(tool.annotations).toEqual({
      readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true,
    });
  });

  it('rejects invalid and unsafe ids for this delete tool', () => {
    const { tool } = setup(kind);
    const schema = tool.inputSchema as typeof SafeDeleteInput;
    for (const field of ['id', 'confirm_id']) {
      for (const value of [0, -1, 1.5, '42', Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        expect(schema.safeParse({ id: ID, [field]: value }).success).toBe(false);
      }
    }
    expect(schema.safeParse({ id: ID, confirm: 'true' }).success).toBe(false);
  });

  it('previews in dry-run even with matching confirmation and sends no DELETE', async () => {
    const { client, invoke, path } = setup(kind, 'dry-run');
    const result = await invoke({ id: ID, confirm: true, confirm_id: ID });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      dry_run: true,
      would_delete: RECORD,
      request: { method: 'DELETE', path },
      hint: expect.stringContaining(`confirm_id:${String(ID)}`),
    });
    expect(JSON.stringify(result.content)).toContain('Ask the user');
    expect(JSON.stringify(result.content)).toContain('confirm:true');
    expect(client.calls).toEqual([{ type: 'get', path, params: {} }]);
  });

  it('blocks disabled mode before lookup, GET, or DELETE even with confirmation', async () => {
    const { client, invoke } = setup(kind, 'disabled');
    const result = await invoke({ id: NUMBER, confirm: true, confirm_id: ID });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('SWSD_WRITE_MODE=disabled');
    expect(client.calls).toEqual([]);
  });

  it.each([
    { label: 'missing confirm', input: { id: ID, confirm_id: ID } },
    { label: 'false confirm', input: { id: ID, confirm: false, confirm_id: ID } },
    { label: 'missing confirm_id', input: { id: ID, confirm: true } },
    { label: 'mismatched confirm_id', input: { id: ID, confirm: true, confirm_id: ID + 1 } },
  ])('previews with $label and sends no DELETE', async ({ input }) => {
    const { client, invoke, path } = setup(kind);
    const result = await invoke(input);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      confirmation_required: true,
      would_delete: RECORD,
      request: { method: 'DELETE', path },
      hint: expect.stringContaining(`confirm_id:${String(ID)}`),
    });
    expect(JSON.stringify(result.content)).toContain('Ask the user');
    expect(JSON.stringify(result.content)).toContain('confirm:true');
    expect(client.calls).toEqual([{ type: 'get', path, params: {} }]);
  });

  it('fetches the record then sends exactly one confirmed DELETE to the right path', async () => {
    const { client, invoke, path } = setup(kind);
    const result = await invoke({ id: ID, confirm: true, confirm_id: ID });
    expect(client.calls).toEqual([
      { type: 'get', path, params: {} },
      { type: 'delete', path },
    ]);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      deleted: true, record: RECORD, request: { method: 'DELETE', path },
    });
    expect(result.content).toEqual([{
      type: 'text', text: `Deleted ${kind} ${String(ID)}: Synthetic record`,
    }]);
  });

  it('accepts a named API envelope and numeric-string identity fields', async () => {
    const { client, invoke, path } = setup(kind);
    vi.spyOn(client, 'get').mockResolvedValue({
      body: { [kind]: { ...RECORD, id: String(ID), number: String(NUMBER) } },
      pagination: { page: 1, per_page: 25, has_more: false },
      headers: new Headers(),
    });
    const result = await invoke({ id: ID, confirm: true, confirm_id: ID });
    expect(result.structuredContent).toEqual({
      deleted: true, record: RECORD, request: { method: 'DELETE', path },
    });
    expect(client.calls).toEqual([{ type: 'delete', path }]);
  });

  it('previews absent optional identity fields explicitly as null', async () => {
    const { client, invoke } = setup(kind);
    vi.spyOn(client, 'get').mockResolvedValue({
      body: { id: ID, name: RECORD.name },
      pagination: { page: 1, per_page: 25, has_more: false },
      headers: new Headers(),
    });
    const result = await invoke({ id: ID });
    expect(result.structuredContent?.would_delete).toEqual({
      id: ID, number: null, name: RECORD.name, state: null,
    });
    expect(client.calls).toEqual([]);
  });

  it.each([null, [], 'invalid', { name: 'Missing identity' }, { ...RECORD, id: ID + 1 }].map((body) => ({ body })))(
    'refuses to delete an unverified or mismatched fetched record: $body',
    async ({ body }) => {
      const { client, invoke } = setup(kind);
      vi.spyOn(client, 'get').mockResolvedValue({
        body,
        pagination: { page: 1, per_page: 25, has_more: false },
        headers: new Headers(),
      });
      const result = await invoke({ id: ID, confirm: true, confirm_id: ID });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain('Could not verify');
      expect(client.calls).toEqual([]);
    },
  );

  it('maps upstream GET errors without deleting', async () => {
    const { client, invoke, path } = setup(kind);
    const get = vi.spyOn(client, 'get').mockRejectedValue(new SwsdHttpError(404, 'Not found'));
    const result = await invoke({ id: ID, confirm: true, confirm_id: ID });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('Not found.');
    expect(get).toHaveBeenCalledExactlyOnceWith(path);
    expect(client.calls).toEqual([]);
  });

  it.each([
    [new SwsdHttpError(403, { error: 'Synthetic forbidden' }), 'Forbidden.'],
    [new SwsdHttpError(500, { error: 'Synthetic upstream failure' }), 'SWSD server error (500)'],
    [new SwsdNetworkError(new Error('Synthetic connection failure')), 'Network error contacting SWSD'],
  ])('maps upstream DELETE errors without reporting success or retrying: %s', async (error, message) => {
    const { client, invoke, path } = setup(kind);
    const remove = vi.spyOn(client, 'delete').mockRejectedValue(error);
    const result = await invoke({ id: ID, confirm: true, confirm_id: ID });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(JSON.stringify(result.content)).toContain(message);
    expect(remove).toHaveBeenCalledExactlyOnceWith(path);
    expect(client.calls).toEqual([{ type: 'get', path, params: {} }]);
  });

  it.each([
    { mode: 'live', input: { id: ID } },
    { mode: 'live', input: { id: ID, confirm: true, confirm_id: ID + 1 } },
    { mode: 'live', input: { id: ID, confirm: true, confirm_id: ID } },
    { mode: 'dry-run', input: { id: ID, confirm: true, confirm_id: ID } },
    { mode: 'disabled', input: { id: ID, confirm: true, confirm_id: ID } },
  ] as const)('excludes tokens and Authorization headers from every $mode result', async ({ mode, input }) => {
    const { client, invoke } = setup(kind, mode);
    vi.spyOn(client, 'get').mockResolvedValue({
      body: { ...RECORD, token: TOKEN, Authorization: `Bearer ${TOKEN}` },
      pagination: { page: 1, per_page: 25, has_more: false },
      headers: new Headers({ Authorization: `Bearer ${TOKEN}` }),
    });
    vi.spyOn(client, 'delete').mockResolvedValue({
      body: { token: TOKEN },
      headers: new Headers({ Authorization: `Bearer ${TOKEN}` }),
      status: 200,
    });
    const result = await invoke(input);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(JSON.stringify(result)).not.toMatch(/authorization/i);
  });
});

describe.each(['incident', 'problem', 'solution'] as const)('%s number resolution', (kind) => {
  it('previews the fetched record and requires the resolved id, not its number', async () => {
    const { client, invoke, path } = setup(kind);
    client.setLookupBody([
      { id: ID + 1, number: NUMBER + 1, name: 'Substring collision 4501' },
      { ...RECORD, name: 'Stale list name' },
    ]);
    const result = await invoke({ id: NUMBER, confirm: true, confirm_id: NUMBER });
    expect(result.structuredContent).toMatchObject({
      confirmation_required: true, would_delete: RECORD, request: { method: 'DELETE', path },
    });
    expect(result.structuredContent?.hint).toContain(`confirm_id:${String(ID)}`);
    expect(client.calls).toEqual([
      { type: 'get', path: `/${kind}s.json`, params: { query: NUMBER, per_page: 25 } },
      { type: 'get', path, params: {} },
    ]);
  });

  it('deletes exactly once using the resolved internal id after confirmation', async () => {
    const { client, invoke, path } = setup(kind);
    client.setLookupBody([RECORD]);
    const result = await invoke({ id: NUMBER, confirm: true, confirm_id: ID });
    expect(result.structuredContent).toEqual({
      deleted: true, record: RECORD, request: { method: 'DELETE', path },
    });
    expect(client.calls).toEqual([
      { type: 'get', path: `/${kind}s.json`, params: { query: NUMBER, per_page: 25 } },
      { type: 'get', path, params: {} },
      { type: 'delete', path },
    ]);
  });

  it('maps resolver errors and sends no record GET or DELETE', async () => {
    const { client, invoke } = setup(kind);
    const result = await invoke({ id: NUMBER, confirm: true, confirm_id: ID });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain(`No ${kind} found with number ${String(NUMBER)}`);
    expect(client.calls).toEqual([
      { type: 'get', path: `/${kind}s.json`, params: { query: NUMBER, per_page: 25 } },
    ]);
  });
});

describe('safe delete schema, profiles, and HTTP boundary', () => {
  it('defaults confirmation to false and validates positive integer ids', () => {
    expect(SafeDeleteInput.parse({ id: ID })).toEqual({ id: ID, confirm: false });
    for (const field of ['id', 'confirm_id']) {
      for (const value of [0, -1, 1.5, '195000010', Infinity, NaN]) {
        expect(SafeDeleteInput.safeParse({ id: ID, [field]: value }).success).toBe(false);
      }
    }
    expect(SafeDeleteInput.safeParse({ id: ID, confirm: 'true' }).success).toBe(false);
  });

  it('registers delete tools only in operations and full profiles', () => {
    const deleteNames = [
      'swsd_delete_comment',
      'swsd_delete_task',
      'swsd_delete_time_track',
      'swsd_delete_hardware_warranty',
          'swsd_delete_contract',
      'swsd_delete_purchase_order',
      'swsd_delete_vendor',
      'swsd_delete_catalog_item',
      'swsd_delete_change_catalog',
      'swsd_delete_hardware_asset',
      'swsd_delete_mobile_device',
      'swsd_delete_other_asset',
      'swsd_delete_configuration_item',
      ...Object.keys(REGISTRARS).map((kind) => `swsd_delete_${kind}`),
    ];
    for (const profile of ['triage', 'agent', 'knowledge', 'operations', 'full'] as const) {
      const expected = profile === 'operations' || profile === 'full' ? deleteNames : [];
      expect(PROFILE_TOOLS[profile].filter((name) => name.startsWith('swsd_delete_'))).toEqual(expected);
      const server = new McpServer({ name: 'profile-test', version: '0.0.0' });
      const ctx = makeCtx(makeFakeClient(), { SWSD_ENABLE_EXTRAS: [] });
      ctx.profile = profile;
      registerTools(server, ctx);
      expect(ctx.enabledTools.filter((name) => name.startsWith('swsd_delete_'))).toEqual(expected);
    }
  });

  it.each(['change', 'release'] as const)('uses a small internal id directly for %s', async (kind) => {
    const { client, invoke } = setup(kind);
    client.setLookupBody({ ...RECORD, id: 42 });
    await invoke({ id: 42, confirm: true, confirm_id: 42 });
    expect(client.calls).toEqual([
      { type: 'get', path: `/${kind}s/42.json`, params: {} },
      { type: 'delete', path: `/${kind}s/42.json` },
    ]);
  });

  it('sends one bodyless DELETE and accepts an empty success response', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createSwsdClient({
      env: EnvSchema.parse({ SWSD_BASE_URL: 'https://api.samanage.com' }),
      token: TOKEN,
    });
    const result = await client.delete('/problems/195000010.json');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.samanage.com/problems/195000010.json');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'DELETE' });
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBeUndefined();
    expect(result).toMatchObject({ status: 204, body: '' });
  });

  it('does not retry DELETE on transient HTTP failure', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('Synthetic unavailable', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createSwsdClient({
      env: EnvSchema.parse({ SWSD_BASE_URL: 'https://api.samanage.com', SWSD_RETRY_MAX_ATTEMPTS: 3 }),
      token: TOKEN,
    });
    await expect(client.delete('/problems/195000010.json')).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe('explicit safe delete configuration', () => {
  it('uses the configured tool name, collection path, and envelope independently of kind', async () => {
    const server = new McpServer({ name: 'explicit-delete-test', version: '0.0.0' });
    const client = makeFakeClient();
    client.setLookupBody({ category: RECORD });
    registerSafeDelete(server, makeCtx(client), {
      kind: 'directory entry',
      toolName: 'swsd_delete_directory_entry',
      collectionPath: '/categories',
      envelopeKey: 'category',
    });
    const tool = getRegisteredTool(server, 'swsd_delete_directory_entry');
    const result = await tool.handler({ id: ID, confirm: true, confirm_id: ID }, {}) as CallToolResult;
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.deleted).toBe(true);
    expect(client.calls).toEqual([
      { type: 'get', path: `/categories/${String(ID)}.json`, params: {} },
      { type: 'delete', path: `/categories/${String(ID)}.json` },
    ]);
  });
});
