import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { PROFILE_TOOLS } from '../../../src/config/profiles.js';
import { registerTools } from '../../../src/config/toolRegistry.js';
import { MAX_EMAIL_CHARS, MAX_LABEL_CHARS, MAX_LONG_TEXT_CHARS } from '../../../src/schemas/limits.js';
import { SwsdHttpError } from '../../../src/swsd/errors.js';
import { makeCtx, makeFakeClient, getRegisteredTool } from './_helpers/mockClient.js';

const ID = 42;
const NAME = 'Synthetic asset';
const DESCRIPTION = 'Synthetic asset description';
const COMMON_INPUT = {
  status_name: 'Operational', site_name: 'Synthetic site',
  department_name: 'Synthetic department', description: DESCRIPTION,
};
const COMMON_PAYLOAD = {
  status: { name: 'Operational' }, site: { name: 'Synthetic site' },
  department: { name: 'Synthetic department' }, description: DESCRIPTION,
};
const COMMON_LABELS = ['status_name', 'site_name', 'department_name'];
const CASES = [
  {
    stem: 'hardware_asset', root: 'hardware', collection: 'hardwares', create: true,
    minimal: { name: NAME },
    fields: {
      ...COMMON_INPUT, name: NAME, asset_tag: 'HW-42',
      owner_email: 'owner@example.com', user_email: 'user@example.com',
      technical_contact_email: 'tech@example.com', ip_address: '192.0.2.42', serial_number: 'HW-SERIAL',
    },
    payload: {
      ...COMMON_PAYLOAD, name: NAME, asset_tag: 'HW-42',
      owner: { email: 'owner@example.com' }, user: { email: 'user@example.com' },
      technical_contact: { email: 'tech@example.com' }, ip_address: '192.0.2.42', bio: { ssn: 'HW-SERIAL' },
    },
    labels: [...COMMON_LABELS, 'name', 'asset_tag', 'ip_address', 'serial_number'],
    emails: ['owner_email', 'user_email', 'technical_contact_email'],
  },
  {
    stem: 'mobile_device', root: 'mobile', collection: 'mobiles', create: true,
    minimal: { manufacturer: 'Synthetic manufacturer', model: 'Synthetic model' },
    fields: {
      ...COMMON_INPUT, device_type: 'Mobile Device', manufacturer: 'Synthetic manufacturer',
      model: 'Synthetic model', serial_number: 'MOBILE-SERIAL', user_email: 'user@example.com',
    },
    payload: {
      ...COMMON_PAYLOAD, device_type: 'Mobile Device', manufacturer: 'Synthetic manufacturer',
      model: 'Synthetic model', serial_number: 'MOBILE-SERIAL', user: { email: 'user@example.com' },
    },
    labels: [...COMMON_LABELS, 'device_type', 'manufacturer', 'model', 'serial_number'],
    emails: ['user_email'],
  },
  {
    stem: 'other_asset', root: 'other_asset', collection: 'other_assets', create: true,
    minimal: { name: NAME },
    fields: {
      ...COMMON_INPUT, name: NAME, asset_id: 'ASSET-42', asset_type_name: 'Synthetic type',
      manufacturer: 'Synthetic manufacturer', model: 'Synthetic model', serial_number: 'OTHER-SERIAL',
      owner_email: 'owner@example.com', user_email: 'user@example.com',
    },
    payload: {
      ...COMMON_PAYLOAD, name: NAME, asset_id: 'ASSET-42', asset_type: { name: 'Synthetic type' },
      manufacturer: 'Synthetic manufacturer', model: 'Synthetic model', serial_number: 'OTHER-SERIAL',
      owner: { email: 'owner@example.com' }, user: { email: 'user@example.com' },
    },
    labels: [...COMMON_LABELS, 'name', 'asset_id', 'asset_type_name', 'manufacturer', 'model', 'serial_number'],
    emails: ['owner_email', 'user_email'],
  },
  {
    stem: 'configuration_item', root: 'configuration_item', collection: 'configuration_items', create: true,
    minimal: { name: NAME },
    fields: { name: NAME, description: DESCRIPTION, state: 'Active', site_id: 1234567, department_id: 1234568, user_email: 'user@example.test' },
    payload: { name: NAME, description: DESCRIPTION, state: 'Active', site_id: 1234567, department_id: 1234568, user: { email: 'user@example.test' } },
    labels: ['state', 'name'], emails: ['user_email'],
  },
  {
    stem: 'printer', root: 'printer', collection: 'printers', create: false,
    minimal: { name: NAME },
    fields: { ...COMMON_INPUT, name: NAME },
    payload: { ...COMMON_PAYLOAD, name: NAME },
    labels: [...COMMON_LABELS, 'name'], emails: [],
  },
];

type Mode = 'live' | 'dry-run' | 'disabled';

function setup(name: string, mode: Mode = 'live') {
  const server = new McpServer({ name: 'asset-write-test', version: '0.0.0' });
  const client = makeFakeClient();
  const ctx = makeCtx(client, { SWSD_WRITE_MODE: mode, SWSD_ENABLE_EXTRAS: [] });
  ctx.profile = 'operations';
  registerTools(server, ctx);
  const tool = getRegisteredTool(server, name);
  const schema = tool.inputSchema as z.ZodType;
  const invoke = async (input: unknown) => await tool.handler(schema.parse(input), {}) as CallToolResult;
  return { client, tool, schema, invoke };
}

afterEach(() => vi.restoreAllMocks());

describe.each(CASES)('$stem asset writes', (spec) => {
  describe.each(spec.create ? ['create', 'update'] : ['update'])('%s', (action) => {
    const update = action === 'update';
    const name = 'swsd_' + action + '_' + spec.stem;
    const path = '/' + spec.collection + (update ? '/' + String(ID) : '') + '.json';
    const input = { ...spec.fields, ...(update ? { id: ID } : {}) };
    const payload = { [spec.root]: spec.payload };

    it('declares all write annotations', () => {
      expect(setup(name).tool.annotations).toEqual({
        readOnlyHint: false, destructiveHint: update, openWorldHint: true, idempotentHint: false,
      });
    });

    it('exposes exactly the requested flat fields', () => {
      const jsonSchema = z.toJSONSchema(setup(name).schema);
      expect(Object.keys(jsonSchema.properties ?? {}).sort()).toEqual(Object.keys(input).sort());
    });

    it('previews the exact dry-run payload without calling SWSD', async () => {
      const { client, invoke } = setup(name, 'dry-run');
      const result = await invoke(input);
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual({
        dry_run: true, request: { method: update ? 'PUT' : 'POST', path, body: payload },
      });
      expect(client.calls).toEqual([]);
    });

    it('blocks disabled writes without calling SWSD', async () => {
      const { client, invoke } = setup(name, 'disabled');
      const result = await invoke(input);
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain('SWSD_WRITE_MODE=disabled');
      expect(client.calls).toEqual([]);
    });

    it.each(['flat', 'envelope'])('sends the exact live payload and maps the %s response', async (shape) => {
      const { client, invoke } = setup(name);
      const raw = { id: String(ID), name: NAME, ...spec.payload };
      const response = shape === 'flat' ? raw : { [spec.root]: raw };
      client.setPostResponse(response);
      client.setPutResponse(response);
      const result = await invoke(input);
      expect(client.calls).toEqual([{ type: update ? 'put' : 'post', path, body: payload }]);
      expect(result.isError).toBeUndefined();
      const changed = Object.keys(spec.payload);
      expect(result.structuredContent).toEqual({
        [spec.stem]: { ...raw, id: ID }, ...(update ? { changed_fields: changed } : {}),
      });
      expect(JSON.stringify(result.content)).toContain(update ? 'Updated ' : 'Created ');
    });

    it('sends only provided fields and strips unsupported inputs', async () => {
      const { client, invoke } = setup(name);
      client.setPostResponse({ id: ID });
      client.setPutResponse({ id: ID });
      const minimal = update ? { id: ID, description: '' } : spec.minimal;
      const unsupported = spec.stem === 'configuration_item'
        ? { status_name: 'ignored', site_name: 'ignored', department_name: 'ignored' }
        : { state: 'ignored' };
      const result = await invoke({ ...minimal, unknown_field: 'ignored', ...unsupported });
      expect(client.calls).toEqual([{
        type: update ? 'put' : 'post', path,
        body: { [spec.root]: update ? { description: '' } : spec.minimal },
      }]);
      expect(result.structuredContent).toEqual({
        [spec.stem]: { id: ID }, ...(update ? { changed_fields: ['description'] } : {}),
      });
    });

    if (spec.stem === 'configuration_item') {
      it('accepts CI state and positive location ids and rejects invalid location ids', () => {
        const { schema } = setup(name);
        expect(schema.parse(input)).toEqual(input);
        for (const field of ['site_id', 'department_id']) {
          for (const value of [0, -1, 1.5, '1234567']) {
            expect(schema.safeParse({ ...input, [field]: value }).success, field).toBe(false);
          }
        }
      });
    }

    it.each([null, [], 'invalid', { name: NAME }].map((response) => ({ response })))(
      'rejects an unparseable write response: $response', async ({ response }) => {
        const { client, invoke } = setup(name);
        client.setPostResponse(response);
        client.setPutResponse(response);
        const result = await invoke(input);
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result.content)).toContain('Could not parse');
        expect(result.structuredContent).toBeUndefined();
        expect(client.calls).toHaveLength(1);
      },
    );

    it('maps upstream errors without retrying', async () => {
      const { client, invoke } = setup(name);
      const call = vi.spyOn(client, update ? 'put' : 'post').mockRejectedValue(new SwsdHttpError(403, {}));
      const result = await invoke(input);
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain('Forbidden');
      expect(call).toHaveBeenCalledExactlyOnceWith(path, payload);
    });

    it('enforces label bounds at and immediately beyond the limit', () => {
      const { schema } = setup(name);
      for (const field of spec.labels) {
        for (const length of [1, MAX_LABEL_CHARS - 1, MAX_LABEL_CHARS]) {
          expect(schema.safeParse({ ...input, [field]: 'x'.repeat(length) }).success, field).toBe(true);
        }
        for (const value of ['', 'x'.repeat(MAX_LABEL_CHARS + 1), 42]) {
          expect(schema.safeParse({ ...input, [field]: value }).success, field).toBe(false);
        }
      }
    });

    it('enforces description bounds and permits clearing descriptions', () => {
      const { schema } = setup(name);
      for (const length of [0, MAX_LONG_TEXT_CHARS - 1, MAX_LONG_TEXT_CHARS]) {
        expect(schema.safeParse({ ...input, description: 'x'.repeat(length) }).success).toBe(true);
      }
      expect(schema.safeParse({ ...input, description: 'x'.repeat(MAX_LONG_TEXT_CHARS + 1) }).success).toBe(false);
    });

    if (spec.emails.length) {
      it('enforces email syntax and email length bounds', () => {
        const { schema } = setup(name);
        for (const field of spec.emails) {
          for (const length of [MAX_EMAIL_CHARS - 1, MAX_EMAIL_CHARS]) {
            expect(schema.safeParse({ ...input, [field]: 'a@' + 'b'.repeat(length - 6) + '.com' }).success, field).toBe(true);
          }
          for (const value of ['', 'invalid-email', 'a@' + 'b'.repeat(MAX_EMAIL_CHARS - 5) + '.com']) {
            expect(schema.safeParse({ ...input, [field]: value }).success, field).toBe(false);
          }
        }
      });
    }

    if (update) {
      it.each(['live', 'dry-run', 'disabled'] as const)('rejects empty updates in %s mode', async (mode) => {
        const { client, invoke, schema } = setup(name, mode);
        expect(schema.safeParse({}).success).toBe(false);
        for (const empty of [{ id: ID }, { id: ID, description: undefined }, { id: ID, unknown_field: 'ignored' }]) {
          const result = await invoke(empty);
          expect(result.isError).toBe(true);
          expect(JSON.stringify(result.content)).toContain('No fields to update');
        }
        expect(client.calls).toEqual([]);
      });

      it('requires a positive safe integer id', () => {
        const { schema } = setup(name);
        for (const id of [1, Number.MAX_SAFE_INTEGER]) {
          expect(schema.safeParse({ ...input, id }).success).toBe(true);
        }
        for (const id of [0, -1, 1.5, '42', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
          expect(schema.safeParse({ ...input, id }).success).toBe(false);
        }
      });
    } else {
      it('requires every create identity field', () => {
        const { schema } = setup(name);
        expect(schema.safeParse({}).success).toBe(false);
        expect(schema.safeParse(spec.minimal).success).toBe(true);
        for (const field of Object.keys(spec.minimal)) {
          expect(schema.safeParse({ ...input, [field]: undefined }).success, field).toBe(false);
        }
      });
    }
  });
});

describe('asset field mapping details', () => {
  it('updates hardware serial numbers through bio.ssn alone', async () => {
    const { client, invoke } = setup('swsd_update_hardware_asset');
    client.setPutResponse({ id: ID, bio: { ssn: 'NEW-SERIAL' } });
    const result = await invoke({ id: ID, serial_number: 'NEW-SERIAL' });
    expect(client.calls).toEqual([{
      type: 'put', path: '/hardwares/42.json', body: { hardware: { bio: { ssn: 'NEW-SERIAL' } } },
    }]);
    expect(result.structuredContent).toEqual({
      hardware_asset: { id: ID, bio: { ssn: 'NEW-SERIAL' } }, changed_fields: ['bio'],
    });
  });

  it.each([
    { tool: 'swsd_update_mobile_device', input: { id: ID, name: NAME } },
    { tool: 'swsd_update_configuration_item', input: { id: ID, status_name: 'Operational' } },
  ])('rejects unsupported identity or state fields as an empty update: $tool', async ({ tool, input }) => {
    const { client, invoke } = setup(tool);
    const result = await invoke(input);
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('No fields to update');
    expect(client.calls).toEqual([]);
  });
});

describe.each(CASES.filter((spec) => spec.create))('swsd_delete_$stem', (spec) => {
  const name = 'swsd_delete_' + spec.stem;
  const path = '/' + spec.collection + '/42.json';
  const request = { method: 'DELETE', path };
  const raw = { id: String(ID), name: NAME, description: DESCRIPTION, private_metadata: 'synthetic-private' };
  const record = { id: ID, name: NAME, number: null, state: null };

  it('declares safe-delete annotations', () => {
    const { tool } = setup(name);
    expect(tool.description).toMatch(/^DESTRUCTIVE/);
    expect(tool.annotations).toEqual({
      readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: true,
    });
  });

  it.each([
    { confirmation: {}, label: 'preview' },
    { confirmation: { confirm: true, confirm_id: ID + 1 }, label: 'wrong confirm_id' },
    { confirmation: { confirm: true }, label: 'missing confirm_id' },
    { confirmation: { confirm: false, confirm_id: ID }, label: 'unconfirmed id' },
  ])('returns a preview without deleting for $label', async ({ confirmation }) => {
    const { client, invoke } = setup(name);
    client.setLookupBody({ [spec.root]: raw });
    const result = await invoke({ id: ID, ...confirmation });
    expect(result.structuredContent).toEqual({
      confirmation_required: true, would_delete: record, request,
      hint: expect.stringContaining('confirm_id:42'),
    });
    expect(client.calls).toEqual([{ type: 'get', path, params: {} }]);
    expect(JSON.stringify(result)).not.toContain('synthetic-private');
  });

  it('previews dry-run even with matching confirmation', async () => {
    const { client, invoke } = setup(name, 'dry-run');
    client.setLookupBody(raw);
    const result = await invoke({ id: ID, confirm: true, confirm_id: ID });
    expect(result.structuredContent).toEqual({
      dry_run: true, would_delete: record, request, hint: expect.stringContaining('confirm_id:42'),
    });
    expect(client.calls).toEqual([{ type: 'get', path, params: {} }]);
  });

  it('blocks disabled deletion before any SWSD call', async () => {
    const { client, invoke } = setup(name, 'disabled');
    const result = await invoke({ id: ID, confirm: true, confirm_id: ID });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('SWSD_WRITE_MODE=disabled');
    expect(client.calls).toEqual([]);
  });

  it.each(['flat', 'envelope'])('deletes exactly the confirmed internal id with a %s response', async (shape) => {
    const { client, invoke } = setup(name);
    client.setLookupBody(shape === 'flat' ? raw : { [spec.root]: raw });
    const result = await invoke({ id: ID, confirm: true, confirm_id: ID });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ deleted: true, record, request });
    expect(client.calls).toEqual([{ type: 'get', path, params: {} }, { type: 'delete', path }]);
    expect(JSON.stringify(result)).not.toContain('synthetic-private');
  });

  it.each([null, { id: ID + 1 }, { name: NAME }].map((response) => ({ response })))(
    'refuses deletion when record identity cannot be verified: $response', async ({ response }) => {
      const { client, invoke } = setup(name);
      client.setLookupBody(response);
      const result = await invoke({ id: ID, confirm: true, confirm_id: ID });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain('Could not verify');
      expect(client.calls).toEqual([{ type: 'get', path, params: {} }]);
    },
  );

  it('bounds delete ids and requires boolean confirmation', () => {
    const { schema } = setup(name);
    expect(schema.parse({ id: ID })).toEqual({ id: ID, confirm: false });
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ id: ID, confirm: 'true' }).success).toBe(false);
    for (const field of ['id', 'confirm_id']) {
      for (const value of [1, Number.MAX_SAFE_INTEGER]) {
        expect(schema.safeParse({ id: ID, [field]: value }).success, field).toBe(true);
      }
      for (const value of [0, -1, 1.5, '42', Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        expect(schema.safeParse({ id: ID, [field]: value }).success, field).toBe(false);
      }
    }
  });
});

describe('asset profiles and registry', () => {
  const names = CASES.flatMap((spec) => (spec.create ? ['create', 'update', 'delete'] : ['update'])
    .map((action) => 'swsd_' + action + '_' + spec.stem));

  it.each(['triage', 'agent', 'knowledge', 'operations'] as const)(
    'exposes asset writes only in operations: %s', (profile) => {
      const tools: readonly string[] = PROFILE_TOOLS[profile];
      const allowed = profile === 'operations';
      const server = new McpServer({ name: 'asset-profile-test', version: '0.0.0' });
      const ctx = makeCtx(makeFakeClient(), { SWSD_ENABLE_EXTRAS: [] });
      ctx.profile = profile;
      registerTools(server, ctx);
      for (const name of names) {
        expect(tools.includes(name), name).toBe(allowed);
        expect(ctx.enabledTools.includes(name), name).toBe(allowed);
      }
      expect(new Set(tools).size).toBe(tools.length);
      expect(ctx.enabledTools).not.toContain('swsd_create_printer');
      expect(ctx.enabledTools).not.toContain('swsd_delete_printer');
    },
  );

  it('registers non-delete asset writes through explicit extras', () => {
    const server = new McpServer({ name: 'asset-extras-test', version: '0.0.0' });
    const extras = names.filter(name => !name.startsWith('swsd_delete_'));
    const ctx = makeCtx(makeFakeClient(), { SWSD_ENABLE_EXTRAS: extras });
    ctx.profile = 'triage';
    registerTools(server, ctx);
    for (const name of extras) expect(getRegisteredTool(server, name)).toBeDefined();
  });
});
