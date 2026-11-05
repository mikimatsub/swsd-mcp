import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { EnvSchema } from '../../../src/config/env.js';
import { PROFILE_TOOLS } from '../../../src/config/profiles.js';
import { registerTools } from '../../../src/config/toolRegistry.js';
import { MAX_LABEL_CHARS } from '../../../src/schemas/limits.js';
import { createSwsdClient } from '../../../src/swsd/client.js';
import { SwsdHttpError, SwsdNetworkError } from '../../../src/swsd/errors.js';
import { makeCtx, makeFakeClient, getRegisteredTool } from './_helpers/mockClient.js';

const PARENT_ID = 42;
const ID = 7;
const CASES = [
  {
    stem: 'hardware_warranty', root: 'warranty', parent: 'hardware_id', child: 'warranty_id',
    collection: '/hardwares/42/warranties.json', path: '/hardwares/42/warranties/7.json',
    previewPath: '/hardwares/42/warranties.json',
    fields: { service: 'Synthetic support', provider: 'Synthetic provider', start_date: '2026-01-01', end_date: '2027-01-01', status: 'Active' },
    minimal: { service: 'Synthetic support' }, partial: { status: 'Expired' },
    labels: ['service', 'provider', 'status'],
    identity: { id: ID, hardware_id: PARENT_ID, service: 'Synthetic support', provider: 'Synthetic provider' },
    actions: ['add', 'update'] as const, api: (fields: Record<string, unknown>) => fields,
  },
  {
    stem: 'contract_item', root: 'item', parent: 'contract_id', child: 'item_id',
    collection: '/contracts/42/items.json', path: '/contracts/42/items/7.json',
    previewPath: '/contracts/42.json',
    fields: { name: 'Synthetic license', version: '1', tag: 'SYNTHETIC-7', quantity: 0 },
    minimal: { name: 'Synthetic license' }, partial: { quantity: 0 },
    labels: ['name', 'version', 'tag'],
    identity: { id: ID, contract_id: PARENT_ID, name: 'Synthetic license', version: '1', tag: 'SYNTHETIC-7' },
    // SWSD calls the quantity `qty`; contract items have no stable ids, so only add is offered.
    actions: ['add'] as const,
    api: ({ quantity, ...rest }: Record<string, unknown>) => ({ ...rest, ...(quantity !== undefined ? { qty: quantity } : {}) }),
  },
];
type Spec = typeof CASES[number];
type Mode = 'live' | 'dry-run' | 'disabled';

function setup(name: string, mode: Mode = 'live') {
  const server = new McpServer({ name: 'asset-subresource-test', version: '0.0.0' });
  const client = makeFakeClient();
  const ctx = makeCtx(client, { SWSD_WRITE_MODE: mode, SWSD_ENABLE_EXTRAS: [] });
  ctx.profile = 'operations';
  registerTools(server, ctx);
  const tool = getRegisteredTool(server, name);
  const schema = tool.inputSchema as z.ZodType;
  const invoke = async (input: unknown) => await tool.handler(schema.parse(input), {}) as CallToolResult;
  return { client, tool, schema, invoke };
}

function previewBody(spec: Spec, rows: unknown[], envelope = false): unknown {
  const items = envelope ? rows.map((row) => ({ [spec.root]: row })) : rows;
  if (spec.root === 'warranty') return envelope ? { warranties: items } : items;
  const contract = { id: PARENT_ID, items, note: 'SYNTHETIC_PRIVATE_PARENT' };
  return envelope ? { contract } : contract;
}

const text = (result: CallToolResult) => JSON.stringify(result.content);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('swsd_list_hardware_warranties', () => {
  it.each(['live', 'dry-run', 'disabled'] as const)('lists warranties in %s mode with read annotations', async (mode) => {
    const { client, tool, invoke } = setup('swsd_list_hardware_warranties', mode);
    const warranty = { id: '7', service: 'Synthetic support', status: 'Active' };
    client.setLookupBody([{ warranty }]);
    const result = await invoke({ hardware_id: PARENT_ID });
    expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ hardware_id: PARENT_ID, warranties: [{ ...warranty, id: ID }] });
    expect(client.calls).toEqual([{ type: 'get', path: '/hardwares/42/warranties.json', params: {} }]);
  });

  it.each([
    { body: [], expected: [] },
    { body: [{ id: 7, service: 'Synthetic support' }], expected: [{ id: 7, service: 'Synthetic support' }] },
    { body: { warranties: [{ warranty: { id: '7' } }] }, expected: [{ id: 7 }] },
  ])('accepts empty, flat and enveloped lists: $body', async ({ body, expected }) => {
    const { client, invoke } = setup('swsd_list_hardware_warranties');
    client.setLookupBody(body);
    expect((await invoke({ hardware_id: PARENT_ID })).structuredContent).toEqual({ hardware_id: PARENT_ID, warranties: expected });
  });

  it.each([null, {}, 'invalid', { warranties: null }, [null], [{ id: 0 }]].map((body) => ({ body })))(
    'rejects malformed list responses: $body', async ({ body }) => {
      const { client, invoke } = setup('swsd_list_hardware_warranties');
      client.setLookupBody(body);
      const result = await invoke({ hardware_id: PARENT_ID });
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('Could not parse');
      expect(result.structuredContent).toBeUndefined();
    },
  );

  it('maps a missing hardware error', async () => {
    const { client, invoke } = setup('swsd_list_hardware_warranties');
    const get = vi.spyOn(client, 'get').mockRejectedValue(new SwsdHttpError(404, 'Not found'));
    const result = await invoke({ hardware_id: PARENT_ID });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Not found');
    expect(get).toHaveBeenCalledExactlyOnceWith('/hardwares/42/warranties.json');
  });
});

describe.each(CASES)('$stem writes', (spec) => {
  describe.each([...spec.actions])('%s', (action) => {
    const update = action === 'update';
    const name = 'swsd_' + action + '_' + spec.stem;
    const ref = { [spec.parent]: PARENT_ID, ...(update ? { [spec.child]: ID } : {}) };
    const path = update ? spec.path : spec.collection;
    const input = { ...ref, ...spec.fields };
    const payload = { [spec.root]: spec.api(spec.fields) };

    it('declares exact input fields and write annotations', () => {
      const { schema, tool } = setup(name);
      expect(Object.keys(z.toJSONSchema(schema).properties ?? {}).sort()).toEqual(Object.keys(input).sort());
      expect(tool.annotations).toEqual({ readOnlyHint: false, destructiveHint: update, openWorldHint: true, idempotentHint: false });
    });

    it('previews the exact dry-run payload without calling SWSD', async () => {
      const { client, invoke } = setup(name, 'dry-run');
      const result = await invoke(input);
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual({ dry_run: true, request: { method: update ? 'PUT' : 'POST', path, body: payload } });
      expect(client.calls).toEqual([]);
    });

    it('blocks disabled writes without calling SWSD', async () => {
      const { client, invoke } = setup(name, 'disabled');
      const result = await invoke(input);
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('SWSD_WRITE_MODE=disabled');
      expect(client.calls).toEqual([]);
    });

    it.each(['flat', 'envelope'])('sends the exact payload and parses a %s response', async (shape) => {
      const { client, invoke } = setup(name);
      const raw = { id: '7', ...spec.fields };
      const response = shape === 'flat' ? raw : { [spec.root]: raw };
      client.setPostResponse(response);
      client.setPutResponse(response);
      const result = await invoke(input);
      expect(result.isError).toBeUndefined();
      expect(client.calls).toEqual([{ type: update ? 'put' : 'post', path, body: payload }]);
      expect(result.structuredContent).toEqual({
        [spec.root]: { ...raw, id: ID }, ...(update ? { changed_fields: Object.keys(spec.fields) } : {}),
      });
      expect(text(result)).toContain(update ? 'Updated ' : 'Added ');
    });

    it('sends only provided supported fields and reports exactly changed fields', async () => {
      const { client, invoke } = setup(name);
      client.setPostResponse({ id: ID });
      client.setPutResponse({ id: ID });
      const fields = update ? spec.partial : spec.minimal;
      const result = await invoke({ ...ref, ...fields, unknown: 'ignored', qty: 9, price: 12, notes: 'ignored' });
      expect(client.calls).toEqual([{ type: update ? 'put' : 'post', path, body: { [spec.root]: spec.api(fields) } }]);
      expect(result.structuredContent).toEqual({ [spec.root]: { id: ID }, ...(update ? { changed_fields: Object.keys(fields) } : {}) });
    });

    it.each([null, [], 'invalid', {}, { id: 0 }, { id: -1 }, { id: 1.5 }, { id: Number.MAX_SAFE_INTEGER + 1 }, { id: 'no-id' }].map((body) => ({ body })))(
      'rejects an unparseable write response: $body', async ({ body }) => {
        const { client, invoke } = setup(name);
        client.setPostResponse(body);
        client.setPutResponse(body);
        const result = await invoke(input);
        expect(result.isError).toBe(true);
        expect(text(result)).toContain('Could not parse');
        expect(result.structuredContent).toBeUndefined();
        expect(client.calls).toHaveLength(1);
      },
    );

    it.each([403, 404, 422, 503])('maps HTTP %i without retrying a write', async (status) => {
      const { client, invoke } = setup(name);
      const write = vi.spyOn(client, update ? 'put' : 'post').mockRejectedValue(new SwsdHttpError(status, 'Synthetic failure'));
      const result = await invoke(input);
      expect(result.isError).toBe(true);
      expect(write).toHaveBeenCalledExactlyOnceWith(path, payload);
      expect(result.structuredContent).toBeUndefined();
    });

    it('maps network failure without retrying a write', async () => {
      const { client, invoke } = setup(name);
      const write = vi.spyOn(client, update ? 'put' : 'post').mockRejectedValue(new SwsdNetworkError(new Error('Synthetic network failure')));
      const result = await invoke(input);
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('Network error');
      expect(write).toHaveBeenCalledTimes(1);
    });

    it('bounds label lengths', () => {
      const { schema } = setup(name);
      for (const field of spec.labels) {
        expect(schema.safeParse({ ...input, [field]: 'x'.repeat(MAX_LABEL_CHARS) }).success).toBe(true);
        expect(schema.safeParse({ ...input, [field]: 'x'.repeat(MAX_LABEL_CHARS + 1) }).success).toBe(false);
        if (field !== 'version' && field !== 'tag') expect(schema.safeParse({ ...input, [field]: '' }).success).toBe(false);
      }
    });

    if (spec.root === 'warranty') {
      it('validates warranty dates', () => {
        const { schema } = setup(name);
        for (const field of ['start_date', 'end_date']) {
          for (const value of ['2026-02-28', '2026-02-28T00:00:00Z', '2026-02-28T12:00:00+01:00']) {
            expect(schema.safeParse({ ...input, [field]: value }).success).toBe(true);
          }
          for (const value of ['2026-02-30', 'not-a-date', 'x'.repeat(65)]) {
            expect(schema.safeParse({ ...input, [field]: value }).success).toBe(false);
          }
        }
      });
    } else {
      it('accepts zero quantity and empty version/tag while rejecting invalid quantities', () => {
        const { schema } = setup(name);
        for (const quantity of [0, 1, Number.MAX_SAFE_INTEGER]) {
          expect(schema.safeParse({ ...input, quantity, version: '', tag: '' }).success).toBe(true);
        }
        for (const quantity of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, '1', Infinity, NaN, null]) {
          expect(schema.safeParse({ ...input, quantity }).success).toBe(false);
        }
      });
    }

    if (update) {
      it.each(['live', 'dry-run', 'disabled'] as const)('rejects empty updates in %s mode', async (mode) => {
        const { client, invoke } = setup(name, mode);
        const result = await invoke({ ...ref, [Object.keys(spec.minimal)[0]]: undefined, unsupported: 'ignored' });
        expect(result.isError).toBe(true);
        expect(text(result)).toContain('No fields to update');
        expect(client.calls).toEqual([]);
      });
    } else {
      it('requires the service or item name', () => {
        expect(setup(name).schema.safeParse(ref).success).toBe(false);
      });
    }
  });
});

describe.each(CASES.filter((spec) => spec.root === 'warranty'))('$stem delete', (spec) => {
  const name = 'swsd_delete_' + spec.stem;
  const ref = { [spec.parent]: PARENT_ID, [spec.child]: ID };
  const raw = { id: '7', ...spec.fields, note: 'SYNTHETIC_PRIVATE_CHILD', attachments: [{ secret: 'SYNTHETIC_PRIVATE_ATTACHMENT' }] };
  const request = { method: 'DELETE', path: spec.path };
  const getCall = { type: 'get', path: spec.previewPath, params: {} };

  it('declares destructive annotations and defaults confirmation to false', () => {
    const { tool, schema } = setup(name);
    expect(tool.annotations).toEqual({ readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: true });
    expect(schema.parse(ref)).toEqual({ ...ref, confirm: false });
    expect(schema.safeParse({ ...ref, confirm: 'true' }).success).toBe(false);
  });

  it.each([false, true])('previews identity fields only from a parent list (envelope=%s)', async (envelope) => {
    const { client, invoke } = setup(name);
    client.setLookupBody(previewBody(spec, [{ id: 88, name: 'Synthetic unrelated item' }, raw], envelope));
    const result = await invoke(ref);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      confirmation_required: true, would_delete: spec.identity, request, hint: expect.stringContaining('confirm_id:7'),
    });
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC_PRIVATE');
    expect(client.calls).toEqual([getCall]);
  });

  it.each([
    { confirm: true },
    { confirm: true, confirm_id: 8 },
    { confirm: true, confirm_id: PARENT_ID },
    { confirm: false, confirm_id: ID },
    { confirm_id: ID },
  ])('requires both confirmation and the matching child ID: %j', async (confirmation) => {
    const { client, invoke } = setup(name);
    client.setLookupBody(previewBody(spec, [raw]));
    const result = await invoke({ ...ref, ...confirmation });
    expect(result.structuredContent).toMatchObject({ confirmation_required: true, would_delete: spec.identity });
    expect(client.calls).toEqual([getCall]);
  });

  it.each([false, true])('performs one confirmed DELETE after parent verification (envelope=%s)', async (envelope) => {
    const { client, invoke } = setup(name);
    client.setLookupBody(previewBody(spec, [raw], envelope));
    client.setDeleteResponse(null);
    const result = await invoke({ ...ref, confirm: true, confirm_id: ID });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ deleted: true, record: spec.identity, request });
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC_PRIVATE');
    expect(client.calls).toEqual([getCall, { type: 'delete', path: spec.path }]);
  });

  it('always previews in dry-run even with matching confirmation', async () => {
    const { client, invoke } = setup(name, 'dry-run');
    client.setLookupBody(previewBody(spec, [raw]));
    const result = await invoke({ ...ref, confirm: true, confirm_id: ID });
    expect(result.structuredContent).toEqual({ dry_run: true, would_delete: spec.identity, request, hint: expect.any(String) });
    expect(client.calls).toEqual([getCall]);
  });

  it('blocks disabled mode before fetching or checking a missing child', async () => {
    const { client, invoke } = setup(name, 'disabled');
    const get = vi.spyOn(client, 'get').mockRejectedValue(new SwsdHttpError(404, 'Not found'));
    const remove = vi.spyOn(client, 'delete');
    const result = await invoke({ ...ref, confirm: true, confirm_id: ID });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('SWSD_WRITE_MODE=disabled');
    expect(get).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it.each(['live', 'dry-run'] as const)('returns not-found and never deletes an absent child in %s mode', async (mode) => {
    const { client, invoke } = setup(name, mode);
    for (const rows of [[], [{ id: 99 }], [null, { id: 'invalid' }]]) {
      client.setLookupBody(previewBody(spec, rows));
      const result = await invoke({ ...ref, confirm: true, confirm_id: ID });
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('Not found');
      expect(result.structuredContent).toBeUndefined();
    }
    expect(client.calls).toEqual([getCall, getCall, getCall]);
  });

  it('rechecks the parent on confirmation and rejects a child removed after preview', async () => {
    const { client, invoke } = setup(name);
    client.setLookupBody(previewBody(spec, [raw]));
    expect((await invoke(ref)).structuredContent?.confirmation_required).toBe(true);
    client.setLookupBody(previewBody(spec, []));
    const result = await invoke({ ...ref, confirm: true, confirm_id: ID });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Not found');
    expect(client.calls).toEqual([getCall, getCall]);
  });

  it.each([403, 404, 503])('maps parent lookup HTTP %i and never deletes', async (status) => {
    const { client, invoke } = setup(name);
    const get = vi.spyOn(client, 'get').mockRejectedValue(new SwsdHttpError(status, 'Synthetic failure'));
    const remove = vi.spyOn(client, 'delete');
    const result = await invoke({ ...ref, confirm: true, confirm_id: ID });
    expect(result.isError).toBe(true);
    expect(get).toHaveBeenCalledExactlyOnceWith(spec.previewPath);
    expect(remove).not.toHaveBeenCalled();
  });

  it.each([new SwsdHttpError(404, 'Not found'), new SwsdHttpError(503, 'Synthetic failure'), new SwsdNetworkError('Synthetic disconnect')])(
    'maps DELETE failures without retrying: %s', async (error) => {
      const { client, invoke } = setup(name);
      client.setLookupBody(previewBody(spec, [raw]));
      const remove = vi.spyOn(client, 'delete').mockRejectedValue(error);
      const result = await invoke({ ...ref, confirm: true, confirm_id: ID });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(remove).toHaveBeenCalledExactlyOnceWith(spec.path);
      expect(client.calls).toEqual([getCall]);
    },
  );

  it('does not expose nested objects as identity fields', async () => {
    const { client, invoke } = setup(name);
    const record = { id: ID, ...Object.fromEntries(Object.keys(spec.identity).filter((key) => !['id', spec.parent].includes(key)).map((key) => [key, { secret: 'SYNTHETIC_PRIVATE' }])) };
    client.setLookupBody(previewBody(spec, [record]));
    const result = await invoke(ref);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.would_delete).toEqual(Object.fromEntries(Object.keys(spec.identity).map((key) => [key, key === 'id' ? ID : key === spec.parent ? PARENT_ID : null])));
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC_PRIVATE');
  });

  it('sends one bodyless DELETE through the real client and never retries HTTP 503', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(previewBody(spec, [raw])), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValue(new Response('Synthetic unavailable', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createSwsdClient({ env: EnvSchema.parse({ SWSD_RETRY_MAX_ATTEMPTS: 3 }), token: 'synthetic-test-token' });
    const server = new McpServer({ name: 'asset-subresource-http-test', version: '0.0.0' });
    const ctx = makeCtx(client, { SWSD_ENABLE_EXTRAS: [] });
    ctx.profile = 'operations';
    registerTools(server, ctx);
    const result = await getRegisteredTool(server, name).handler({ ...ref, confirm: true, confirm_id: ID }, {}) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toContain(spec.previewPath);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://api.samanage.com' + spec.path);
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('DELETE');
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBeUndefined();
  });
});

describe('contract item update/delete', () => {
  it.each(['swsd_update_contract_item', 'swsd_delete_contract_item'])('is not offered because SWSD items have no stable ids: %s', (name) => {
    for (const profile of ['triage', 'agent', 'knowledge', 'operations'] as const) {
      expect((PROFILE_TOOLS[profile] as readonly string[]).includes(name)).toBe(false);
    }
  });
});

describe('asset subresource schemas and profiles', () => {
  const tools = [
    { name: 'swsd_list_hardware_warranties', input: { hardware_id: PARENT_ID }, ids: ['hardware_id'] },
    ...CASES.flatMap((spec) => [...spec.actions, ...(spec.root === 'warranty' ? ['delete'] : [])].map((action) => ({
      name: 'swsd_' + action + '_' + spec.stem,
      input: { [spec.parent]: PARENT_ID, ...(action !== 'add' ? { [spec.child]: ID } : {}), ...(action !== 'delete' ? spec.minimal : {}) },
      ids: [spec.parent, ...(action !== 'add' ? [spec.child] : []), ...(action === 'delete' ? ['confirm_id'] : [])],
    }))),
  ];

  it.each(tools)('validates internal IDs for $name', ({ name, input, ids }) => {
    const { schema } = setup(name);
    for (const field of ids) {
      for (const value of [0, -1, 1.5, '7', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null]) {
        expect(schema.safeParse({ ...input, [field]: value }).success).toBe(false);
      }
      if (field !== 'confirm_id') expect(schema.safeParse({ ...input, [field]: undefined }).success).toBe(false);
    }
  });

  it.each(['triage', 'agent', 'knowledge', 'operations'] as const)('registers the requested tools only in operations: %s', (profile) => {
    const server = new McpServer({ name: 'asset-subresource-profile-test', version: '0.0.0' });
    const ctx = makeCtx(makeFakeClient(), { SWSD_ENABLE_EXTRAS: [] });
    ctx.profile = profile;
    registerTools(server, ctx);
    const enabled = profile === 'operations';
    for (const { name } of tools) {
      expect((PROFILE_TOOLS[profile] as readonly string[]).includes(name)).toBe(enabled);
      expect(ctx.enabledTools.includes(name)).toBe(enabled);
      if (enabled) expect(getRegisteredTool(server, name)).toBeDefined();
    }
    expect(ctx.enabledTools.includes('swsd_list_hardware_warranties')).toBe(ctx.enabledTools.includes('swsd_get_hardware_asset'));
  });

  it.each([null, {}, { warranties: null }].map((body) => ({ body })))('rejects malformed warranty delete lists: $body', async ({ body }) => {
    const { client, invoke } = setup('swsd_delete_hardware_warranty');
    client.setLookupBody(body);
    const result = await invoke({ hardware_id: PARENT_ID, warranty_id: ID, confirm: true, confirm_id: ID });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Could not verify');
    expect(client.calls).toEqual([{ type: 'get', path: '/hardwares/42/warranties.json', params: {} }]);
  });
});
