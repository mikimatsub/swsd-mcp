import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { PROFILE_TOOLS } from '../../../src/config/profiles.js';
import { registerTools } from '../../../src/config/toolRegistry.js';
import { MAX_EMAIL_CHARS, MAX_LABEL_CHARS, MAX_LONG_TEXT_CHARS } from '../../../src/schemas/limits.js';
import { SwsdHttpError } from '../../../src/swsd/errors.js';
import { makeCtx, makeFakeClient, getRegisteredTool } from './_helpers/mockClient.js';

const ID = 42;
const NAME = 'Synthetic procurement record';
const DESCRIPTION = 'Synthetic procurement description';
const LOCATION_INPUT = { site_name: 'Synthetic site', department_name: 'Synthetic department' };
const LOCATION_PAYLOAD = { site: { name: 'Synthetic site' }, department: { name: 'Synthetic department' } };
const LOCATION_LABELS = ['site_name', 'department_name'];
const ASSIGNMENTS = { default_assignee_id: 11, default_group_assignee_id: 12, site_id: 13, department_id: 14 };
const CASES = [
  {
    stem: 'contract', root: 'contract', collection: 'contracts',
    fields: {
      name: NAME, type: 'Synthetic support', status_name: 'Active', manufacturer_name: 'Synthetic manufacturer',
      start_date: '2026-01-01', end_date: '2027-01-01', ...LOCATION_INPUT, note: DESCRIPTION,
    },
    payload: {
      name: NAME, type: 'Synthetic support', status: { name: 'Active' }, manufacturer_name: 'Synthetic manufacturer',
      start_date: '2026-01-01', end_date: '2027-01-01', ...LOCATION_PAYLOAD, note: DESCRIPTION,
    },
    labels: ['name', 'type', 'status_name', 'manufacturer_name', ...LOCATION_LABELS],
    texts: ['note'], emails: [], dates: ['start_date', 'end_date'], ids: [], booleans: [],
  },
  {
    stem: 'purchase_order', root: 'purchase_order', collection: 'purchase_orders',
    fields: {
      name: NAME, state: 'Draft', vendor_name: 'Synthetic vendor', requester_email: 'requester@example.com',
      buyer_email: 'buyer@example.com', order_date: '2026-01-01', due_date: '2026-02-01', currency: 'USD',
      payment_terms: 'Net 30', notes: DESCRIPTION, ...LOCATION_INPUT,
    },
    payload: {
      name: NAME, state: 'Draft', vendor: { name: 'Synthetic vendor' }, requester: { email: 'requester@example.com' },
      buyer: { email: 'buyer@example.com' }, order_date: '2026-01-01', due_date: '2026-02-01', currency: 'USD',
      payment_terms: 'Net 30', notes: DESCRIPTION, ...LOCATION_PAYLOAD,
    },
    labels: ['name', 'state', 'vendor_name', 'payment_terms', ...LOCATION_LABELS],
    texts: ['notes'], emails: ['requester_email', 'buyer_email'], dates: ['order_date', 'due_date'], ids: [], booleans: [],
  },
  {
    stem: 'vendor', root: 'vendor', collection: 'vendors',
    fields: {
      name: NAME, vendor_type: 'Synthetic supplier', url: 'https://vendor.example.com',
      contact_name: 'Synthetic contact', contact_email: 'contact@example.com', contact_phone: '+1-202-555-0142',
      telephone: '+1-202-555-0143', address: '42 Synthetic Street', city: 'Synthetic city', state: 'NY',
      zip: '10001', note: DESCRIPTION,
    },
    payload: {
      name: NAME, vendor_type: 'Synthetic supplier', url: 'https://vendor.example.com',
      contact_name: 'Synthetic contact', contact_email: 'contact@example.com', contact_phone: '+1-202-555-0142',
      telephone: '+1-202-555-0143', address: '42 Synthetic Street', city: 'Synthetic city', state: 'NY',
      zip: '10001', note: DESCRIPTION,
    },
    labels: ['name', 'vendor_type', 'contact_name', 'contact_phone', 'telephone', 'address', 'city', 'state', 'zip'],
    texts: ['note'], emails: ['contact_email'], dates: [], ids: [], booleans: [],
  },
  {
    stem: 'catalog_item', root: 'catalog_item', collection: 'catalog_items',
    fields: {
      name: NAME, description: DESCRIPTION, state: 'Draft', category_name: 'Synthetic category',
      price: 0, currency: 'USD', show_price: false, ...ASSIGNMENTS, expected_delivery_time: '1 day',
    },
    payload: {
      name: NAME, description: DESCRIPTION, state: 'Draft', category: { name: 'Synthetic category' },
      price: 0, currency: 'USD', show_price: false, ...ASSIGNMENTS, expected_delivery_time: '1 day',
    },
    labels: ['name', 'state', 'category_name', 'expected_delivery_time'],
    texts: ['description'], emails: [], dates: [], ids: Object.keys(ASSIGNMENTS), booleans: ['show_price'],
  },
  {
    stem: 'change_catalog', root: 'change_catalog', collection: 'change_catalogs',
    fields: {
      name: NAME, description: DESCRIPTION, change_type: 'Standard', priority: 'High', state_id: 1234567,
      change_plan: 'Synthetic change plan', rollback_plan: 'Synthetic rollback plan', test_plan: 'Synthetic test plan',
      show_in_portal: false, ...ASSIGNMENTS,
    },
    payload: {
      name: NAME, description: DESCRIPTION, change_type: 'Standard', priority: 'High', state_id: 1234567,
      change_plan: 'Synthetic change plan', rollback_plan: 'Synthetic rollback plan', test_plan: 'Synthetic test plan',
      show_in_portal: false, ...ASSIGNMENTS,
    },
    labels: ['name', 'change_type', 'priority'],
    texts: ['description', 'change_plan', 'rollback_plan', 'test_plan'], emails: [], dates: [],
    ids: [...Object.keys(ASSIGNMENTS), 'state_id'], booleans: ['show_in_portal'],
  },
];

type Mode = 'live' | 'dry-run' | 'disabled';

function setup(name: string, mode: Mode = 'live') {
  const server = new McpServer({ name: 'procurement-write-test', version: '0.0.0' });
  const client = makeFakeClient();
  const ctx = makeCtx(client, { SWSD_WRITE_MODE: mode, SWSD_ENABLE_EXTRAS: [] });
  ctx.profile = 'full';
  registerTools(server, ctx);
  const tool = getRegisteredTool(server, name);
  const schema = tool.inputSchema as z.ZodType;
  const invoke = async (input: unknown) => await tool.handler(schema.parse(input), {}) as CallToolResult;
  return { client, tool, schema, invoke };
}

afterEach(() => vi.restoreAllMocks());

describe.each(CASES)('$stem procurement writes', (spec) => {
  describe.each(['create', 'update'])('%s', (action) => {
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
      const clearedField = spec.texts[0];
      const minimal = update ? { id: ID, [clearedField]: '' } : { name: NAME };
      const result = await invoke({ ...minimal, unknown_field: 'ignored', line_items: [{ name: 'Synthetic line' }], purchase_order_items_attributes: [{ name: 'Synthetic line' }] });
      expect(client.calls).toEqual([{
        type: update ? 'put' : 'post', path,
        body: { [spec.root]: update ? { [clearedField]: '' } : { name: NAME } },
      }]);
      expect(result.structuredContent).toEqual({
        [spec.stem]: { id: ID }, ...(update ? { changed_fields: [clearedField] } : {}),
      });
    });

    if (spec.stem === 'change_catalog') {
      it('sends state_id and never the read-only state label', async () => {
        const { client, invoke } = setup(name);
        client.setPostResponse({ id: 1234567 });
        client.setPutResponse({ id: 1234567 });
        await invoke({ ...input, state: 'Draft' });
        expect(client.calls).toEqual([{ type: update ? 'put' : 'post', path, body: payload }]);
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

    it('enforces long-text bounds and permits clearing text', () => {
      const { schema } = setup(name);
      for (const field of spec.texts) {
        for (const length of [0, MAX_LONG_TEXT_CHARS - 1, MAX_LONG_TEXT_CHARS]) {
          expect(schema.safeParse({ ...input, [field]: 'x'.repeat(length) }).success, field).toBe(true);
        }
        for (const value of ['x'.repeat(MAX_LONG_TEXT_CHARS + 1), 42]) {
          expect(schema.safeParse({ ...input, [field]: value }).success, field).toBe(false);
        }
      }
    });

    if (spec.dates.length) {
      it('accepts ISO calendar dates and rejects invalid dates or datetimes', () => {
        const { schema } = setup(name);
        for (const field of spec.dates) {
          for (const value of ['2026-01-01', '2028-02-29']) {
            expect(schema.safeParse({ ...input, [field]: value }).success, field).toBe(true);
          }
          for (const value of ['', '2026-02-29', '2026-02-30', '2026-13-01', '01/01/2026', '2026-01-01T00:00:00Z', 'x'.repeat(MAX_LABEL_CHARS + 1), 42]) {
            expect(schema.safeParse({ ...input, [field]: value }).success, field).toBe(false);
          }
        }
      });
    }

    if (spec.stem === 'purchase_order' || spec.stem === 'catalog_item') {
      it('requires exactly three uppercase currency letters', () => {
        const { schema } = setup(name);
        for (const value of ['USD', 'EUR', 'GBP']) {
          expect(schema.safeParse({ ...input, currency: value }).success).toBe(true);
        }
        for (const value of ['', 'US', 'USDD', 'usd', 'UsD', 'U1D', ' USD', 'USD\n', 'X'.repeat(MAX_LABEL_CHARS + 1), 42]) {
          expect(schema.safeParse({ ...input, currency: value }).success).toBe(false);
        }
      });
    }

    if (spec.stem === 'vendor') {
      it('accepts bounded HTTP(S) URLs and rejects other schemes or malformed URLs', () => {
        const { schema } = setup(name);
        const prefix = 'https://vendor.example.com/';
        for (const value of ['http://vendor.example.com', prefix, ...[MAX_LABEL_CHARS - 1, MAX_LABEL_CHARS].map((length) => prefix + 'x'.repeat(length - prefix.length))]) {
          expect(schema.safeParse({ ...input, url: value }).success).toBe(true);
        }
        for (const value of ['', 'not a URL', 'vendor.example.com', 'ftp://vendor.example.com', 'javascript:alert(1)', 'mailto:vendor@example.com', prefix + 'x'.repeat(MAX_LABEL_CHARS + 1 - prefix.length), 42]) {
          expect(schema.safeParse({ ...input, url: value }).success).toBe(false);
        }
      });
    }

    if (spec.stem === 'catalog_item') {
      it('accepts nonnegative numeric prices and rejects negatives or non-numbers', () => {
        const { schema } = setup(name);
        for (const value of [0, 0.01, 123.45]) {
          expect(schema.safeParse({ ...input, price: value }).success).toBe(true);
        }
        for (const value of [-0.01, -1, '0', NaN, Infinity, null]) {
          expect(schema.safeParse({ ...input, price: value }).success).toBe(false);
        }
      });
    }

    if (spec.ids.length) {
      it('requires positive safe integer assignment and location ids', () => {
        const { schema } = setup(name);
        for (const field of spec.ids) {
          for (const value of [1, Number.MAX_SAFE_INTEGER]) {
            expect(schema.safeParse({ ...input, [field]: value }).success, field).toBe(true);
          }
          for (const value of [0, -1, 1.5, '42', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
            expect(schema.safeParse({ ...input, [field]: value }).success, field).toBe(false);
          }
        }
      });
    }

    if (spec.booleans.length) {
      it('requires actual booleans and sends both true and false', async () => {
        const { schema, invoke } = setup(name, 'dry-run');
        for (const field of spec.booleans) {
          for (const value of [true, false]) {
            const result = await invoke({ ...input, [field]: value });
            expect(result.structuredContent).toEqual({
              dry_run: true,
              request: { method: update ? 'PUT' : 'POST', path, body: { [spec.root]: { ...spec.payload, [field]: value } } },
            });
          }
          for (const value of [0, 1, 'true', 'false', null]) {
            expect(schema.safeParse({ ...input, [field]: value }).success, field).toBe(false);
          }
        }
      });
    }

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
        for (const empty of [{ id: ID }, { id: ID, [spec.texts[0]]: undefined }, { id: ID, unknown_field: 'ignored' }]) {
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
        expect(schema.safeParse({ name: NAME }).success).toBe(true);
        for (const field of Object.keys({ name: NAME })) {
          expect(schema.safeParse({ ...input, [field]: undefined }).success, field).toBe(false);
        }
      });
    }
  });
});

describe.each(CASES)('swsd_delete_$stem', (spec) => {
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

describe('change catalog reads', () => {
  const raw = {
    id: String(ID), number: '7', name: NAME, state: 'Approved', priority: 'High',
    category: { name: 'Synthetic category' }, site: { name: 'Synthetic site' },
    department: { name: 'Synthetic department' }, description: DESCRIPTION,
    change_plan: 'Synthetic plan', show_in_portal: false,
  };

  it.each(['flat', 'envelope'])('maps %s list rows to change_catalogs and sends pagination', async (shape) => {
    const { client, invoke, tool } = setup('swsd_list_change_catalogs');
    client.setLookupBody([shape === 'flat' ? raw : { change_catalog: raw }, null, { name: 'Missing id' }]);
    const result = await invoke({ page: 2, per_page: 10 });
    expect(client.calls).toEqual([{ type: 'get', path: '/change_catalogs.json', params: { page: 2, per_page: 10 } }]);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      change_catalogs: [{
        id: ID, number: 7, name: NAME, state: 'Approved', priority: 'High', category: 'Synthetic category',
        site: 'Synthetic site', department: 'Synthetic department',
      }],
      pagination: { page: 1, per_page: 25, has_more: false },
    });
    expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true });
  });

  it.each(['flat', 'envelope'])('maps %s detail to change_catalog with normalized id', async (shape) => {
    const { client, invoke, tool } = setup('swsd_get_change_catalog');
    client.setLookupBody(shape === 'flat' ? raw : { change_catalog: raw });
    const result = await invoke({ id: ID });
    expect(client.calls).toEqual([{ type: 'get', path: '/change_catalogs/42.json', params: {} }]);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ change_catalog: { ...raw, id: ID } });
    expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true });
  });

  it('returns an empty list when no change catalogs are present', async () => {
    const { client, invoke } = setup('swsd_list_change_catalogs');
    client.setLookupBody([]);
    const result = await invoke({});
    expect(result.structuredContent).toEqual({ change_catalogs: [], pagination: { page: 1, per_page: 25, has_more: false } });
  });

  it.each([null, {}, { change_catalog: { name: NAME } }])('rejects malformed detail: %s', async (body) => {
    const { client, invoke } = setup('swsd_get_change_catalog');
    client.setLookupBody(body);
    const result = await invoke({ id: ID });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('Could not parse change catalog');
  });
});

describe('procurement profiles and registry', () => {
  const writes = CASES.flatMap((spec) => ['create', 'update', 'delete'].map((action) => 'swsd_' + action + '_' + spec.stem));
  const reads = ['swsd_list_change_catalogs', 'swsd_get_change_catalog'];
  const names = [...writes, ...reads];

  it.each(['triage', 'agent', 'knowledge', 'operations', 'full'] as const)(
    'exposes writes only in operations/full and change catalog reads alongside contracts: %s', (profile) => {
      const tools: readonly string[] = PROFILE_TOOLS[profile];
      const allowed = profile === 'operations' || profile === 'full';
      const server = new McpServer({ name: 'procurement-profile-test', version: '0.0.0' });
      const ctx = makeCtx(makeFakeClient(), { SWSD_ENABLE_EXTRAS: [] });
      ctx.profile = profile;
      registerTools(server, ctx);
      for (const name of writes) {
        expect(tools.includes(name), name).toBe(allowed);
        expect(ctx.enabledTools.includes(name), name).toBe(allowed);
      }
      for (const [name, contract] of [['swsd_list_change_catalogs', 'swsd_list_contracts'], ['swsd_get_change_catalog', 'swsd_get_contract']]) {
        expect(tools.includes(name), name).toBe(tools.includes(contract));
        expect(ctx.enabledTools.includes(name), name).toBe(ctx.enabledTools.includes(contract));
      }
      expect(new Set(tools).size).toBe(tools.length);
      for (const name of names.filter((name) => tools.includes(name))) expect(getRegisteredTool(server, name)).toBeDefined();
    },
  );

  it('registers every procurement write and change catalog read through explicit extras', () => {
    const server = new McpServer({ name: 'procurement-extras-test', version: '0.0.0' });
    const ctx = makeCtx(makeFakeClient(), { SWSD_ENABLE_EXTRAS: names });
    ctx.profile = 'triage';
    registerTools(server, ctx);
    for (const name of names) expect(getRegisteredTool(server, name)).toBeDefined();
  });
});
