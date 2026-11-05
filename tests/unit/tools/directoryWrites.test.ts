import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import { EnvSchema } from '../../../src/config/env.js';
import { PROFILE_TOOLS } from '../../../src/config/profiles.js';
import { registerTools } from '../../../src/config/toolRegistry.js';
import { MAX_EMAIL_CHARS, MAX_LABEL_CHARS, MAX_LONG_TEXT_CHARS } from '../../../src/schemas/limits.js';
import { createSwsdClient } from '../../../src/swsd/client.js';
import { SwsdHttpError } from '../../../src/swsd/errors.js';
import { registerAddGroupMember } from '../../../src/tools/lookups/directoryWrites.js';
import { makeCtx, makeFakeClient, getRegisteredTool } from './_helpers/mockClient.js';

const ID = 42;
const SECRET = 'synthetic-private-metadata';
const NAME = 'Synthetic directory record';
const DESCRIPTION = 'Synthetic description';
const RESPONSE = {
  id: String(ID), name: NAME, description: DESCRIPTION,
  email: 'person@example.com', title: 'Analyst', disabled: false,
  available_for_assignment: true, role: { name: 'Synthetic role' },
  site: { name: 'Synthetic site' }, department: { name: 'Synthetic department' },
  memberships: [{ id: 87, email: 'member@example.com', private_metadata: SECRET }],
  location: 'Office', time_zone: 'UTC', parent_id: 4, default_assignee_id: 5,
  phone: SECRET, mobile_phone: SECRET, private_metadata: SECRET,
};
const CASES = [
  {
    kind: 'user', collection: 'users',
    minimal: { name: NAME, email: 'person@example.com' },
    fields: {
      name: NAME, email: 'person@example.com', title: 'Analyst', phone: '+15550101', mobile_phone: '+15550102',
      role_name: 'Synthetic role', site_name: 'Synthetic site', department_name: 'Synthetic department',
      reports_to_email: 'manager@example.com',
    },
    payload: {
      name: NAME, email: 'person@example.com', title: 'Analyst', phone: '+15550101', mobile_phone: '+15550102',
      role: { name: 'Synthetic role' }, site: { name: 'Synthetic site' },
      department: { name: 'Synthetic department' }, reports_to: { email: 'manager@example.com' },
    },
    mapped: {
      id: ID, name: NAME, email: 'person@example.com', title: 'Analyst', disabled: false,
      available_for_assignment: true, role: 'Synthetic role', site: 'Synthetic site', department: 'Synthetic department',
    },
    labels: ['name', 'title', 'phone', 'mobile_phone', 'role_name', 'site_name', 'department_name'],
    emails: ['email', 'reports_to_email'], ids: [], description: false,
  },
  {
    kind: 'group', collection: 'groups',
    minimal: { name: NAME },
    fields: { name: NAME, description: DESCRIPTION, email: 'team@example.com' },
    payload: { name: NAME, description: DESCRIPTION, email: 'team@example.com', is_user: false },
    mapped: { id: ID, name: NAME, description: DESCRIPTION, disabled: false, member_count: 1 },
    labels: ['name'], emails: ['email'], ids: [], description: true,
  },
  {
    kind: 'site', collection: 'sites',
    minimal: { name: NAME },
    fields: { name: NAME, location: 'Office', description: DESCRIPTION, time_zone: 'UTC' },
    payload: { name: NAME, location: 'Office', description: DESCRIPTION, time_zone: 'UTC' },
    mapped: { id: ID, name: NAME, location: 'Office', description: DESCRIPTION, time_zone: 'UTC' },
    labels: ['name', 'location', 'time_zone'], emails: [], ids: [], description: true,
  },
  {
    kind: 'department', collection: 'departments',
    minimal: { name: NAME }, fields: { name: NAME, description: DESCRIPTION },
    payload: { name: NAME, description: DESCRIPTION },
    mapped: { id: ID, name: NAME, description: DESCRIPTION },
    labels: ['name'], emails: [], ids: [], description: true,
  },
  {
    kind: 'category', collection: 'categories',
    minimal: { name: NAME }, fields: { name: NAME, parent_id: 4, default_assignee_id: 5 },
    payload: { name: NAME, parent_id: 4, default_assignee_id: 5 },
    mapped: { id: ID, name: NAME, parent_id: 4, default_assignee_id: 5, children: undefined },
    labels: ['name'], emails: [], ids: ['parent_id', 'default_assignee_id'], description: false,
  },
  {
    kind: 'role', collection: 'roles',
    minimal: { name: NAME }, fields: { name: NAME, description: DESCRIPTION },
    payload: { name: NAME, description: DESCRIPTION },
    mapped: { id: ID, name: NAME, description: DESCRIPTION },
    labels: ['name'], emails: [], ids: [], description: true,
  },
];

type Mode = 'live' | 'dry-run' | 'disabled';

function responseFor(kind: string): Record<string, unknown> {
  const response: Record<string, unknown> = { ...RESPONSE };
  if (kind !== 'user') {
    for (const key of ['site', 'department', 'role']) delete response[key];
  }
  return response;
}

function setup(name: string, mode: Mode = 'live') {
  const server = new McpServer({ name: 'directory-test', version: '0.0.0' });
  const client = makeFakeClient();
  const ctx = makeCtx(client, { SWSD_WRITE_MODE: mode, SWSD_ENABLE_EXTRAS: [] });
  ctx.profile = 'operations';
  registerTools(server, ctx);
  const tool = getRegisteredTool(server, name);
  const schema = tool.inputSchema as z.ZodType;
  const invoke = async (input: unknown) => await tool.handler(schema.parse(input), {}) as CallToolResult;
  return { client, tool, schema, invoke };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each(CASES)('$kind directory writes', (spec) => {
  describe.each(['create', 'update'] as const)('%s', (action) => {
    const update = action === 'update';
    const name = `swsd_${action}_${spec.kind}`;
    const path = `/${spec.collection}${update ? `/${String(ID)}` : ''}.json`;
    const fields = { ...spec.fields, ...(update && spec.kind === 'user' ? { disabled: false } : {}) };
    const input = { ...fields, ...(update ? { id: ID } : {}) };
    const payload = { [spec.kind]: { ...spec.payload, ...(update && spec.kind === 'user' ? { disabled: false } : {}) } };

    it('declares all write annotations', () => {
      expect(setup(name).tool.annotations).toEqual({
        readOnlyHint: false, destructiveHint: update, openWorldHint: true, idempotentHint: false,
      });
    });

    it('previews the exact dry-run payload without calling SWSD', async () => {
      const { client, invoke } = setup(name, 'dry-run');
      const result = await invoke(input);
      expect(result.structuredContent).toEqual({
        dry_run: true, request: { method: update ? 'PUT' : 'POST', path, body: payload },
      });
      expect(result.isError).toBeUndefined();
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
      const raw = responseFor(spec.kind);
      const response = shape === 'flat' ? raw : { [spec.kind]: raw };
      client.setPostResponse(response);
      client.setPutResponse(response);
      const result = await invoke(input);
      expect(client.calls).toEqual([{ type: update ? 'put' : 'post', path, body: payload }]);
      expect(result.isError).toBeUndefined();
      const changed = Object.keys(payload[spec.kind]).filter((key) => key !== 'is_user');
      expect(result.structuredContent).toEqual({
        [spec.kind]: spec.mapped, ...(update ? { changed_fields: changed } : {}),
      });
      expect(JSON.stringify(result)).not.toContain(SECRET);
      expect(result.content).toEqual([{
        type: 'text',
        text: update
          ? `Updated ${spec.kind} ${String(ID)} (${changed.join(', ')}).`
          : `Created ${spec.kind} ${String(ID)}: ${NAME}`,
      }]);
    });

    it('sends only provided fields and preserves required group identity', async () => {
      const { client, invoke } = setup(name);
      client.setPostResponse(responseFor(spec.kind));
      client.setPutResponse(responseFor(spec.kind));
      const minimal = update ? { id: ID, name: 'Renamed' } : spec.minimal;
      await invoke({ ...minimal, unknown_field: SECRET });
      const expected = update ? { name: 'Renamed' } : spec.minimal;
      expect(client.calls).toEqual([{
        type: update ? 'put' : 'post', path,
        body: { [spec.kind]: { ...expected, ...(spec.kind === 'group' ? { is_user: false } : {}) } },
      }]);
    });

    it.each([null, [], 'invalid', { name: NAME }].map((response) => ({ response })))('rejects an unparseable write response: $response', async ({ response }) => {
      const { client, invoke } = setup(name);
      client.setPostResponse(response);
      client.setPutResponse(response);
      const result = await invoke(input);
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain('Could not parse');
      expect(result.structuredContent).toBeUndefined();
      expect(client.calls).toHaveLength(1);
    });

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
        for (const length of [MAX_LABEL_CHARS - 1, MAX_LABEL_CHARS]) {
          expect(schema.safeParse({ ...input, [field]: 'x'.repeat(length) }).success, field).toBe(true);
        }
        expect(schema.safeParse({ ...input, [field]: 'x'.repeat(MAX_LABEL_CHARS + 1) }).success, field).toBe(false);
      }
      expect(schema.safeParse({ ...input, name: '' }).success).toBe(false);
      for (const field of ['role_name', 'site_name', 'department_name'].filter((field) => spec.labels.includes(field))) {
        expect(schema.safeParse({ ...input, [field]: '' }).success).toBe(false);
      }
    });

    if (spec.description) {
      it('enforces description bounds and permits clearing descriptions', () => {
        const { schema } = setup(name);
        for (const length of [0, MAX_LONG_TEXT_CHARS - 1, MAX_LONG_TEXT_CHARS]) {
          expect(schema.safeParse({ ...input, description: 'x'.repeat(length) }).success).toBe(true);
        }
        expect(schema.safeParse({ ...input, description: 'x'.repeat(MAX_LONG_TEXT_CHARS + 1) }).success).toBe(false);
      });
    }

    if (spec.emails.length) {
      it('enforces email syntax and email length bounds', () => {
        const { schema } = setup(name);
        for (const field of spec.emails) {
          for (const length of [MAX_EMAIL_CHARS - 1, MAX_EMAIL_CHARS]) {
            expect(schema.safeParse({ ...input, [field]: `a@${'b'.repeat(length - 6)}.com` }).success, field).toBe(true);
          }
          for (const value of ['', 'invalid-email', `a@${'b'.repeat(MAX_EMAIL_CHARS - 5)}.com`]) {
            expect(schema.safeParse({ ...input, [field]: value }).success, field).toBe(false);
          }
        }
      });
    }

    if (update || spec.ids.length) {
      it('requires safe positive integer record and relationship ids', () => {
        const { schema } = setup(name);
        for (const field of [...spec.ids, ...(update ? ['id'] : [])]) {
          for (const value of [1, Number.MAX_SAFE_INTEGER]) {
            expect(schema.safeParse({ ...input, [field]: value }).success, field).toBe(true);
          }
          for (const value of [0, -1, 1.5, '42', Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
            expect(schema.safeParse({ ...input, [field]: value }).success, field).toBe(false);
          }
        }
      });
    }

    if (update) {
      it.each(['live', 'dry-run', 'disabled'] as const)('rejects empty updates in %s mode', async (mode) => {
        const { client, invoke } = setup(name, mode);
        for (const empty of [{ id: ID }, { id: ID, name: undefined }, { id: ID, unknown_field: SECRET }]) {
          const result = await invoke(empty);
          expect(result.isError).toBe(true);
          expect(JSON.stringify(result.content)).toContain('No fields to update');
        }
        expect(client.calls).toEqual([]);
      });
    } else {
      it('requires name and the user email when creating', () => {
        const { schema } = setup(name);
        expect(schema.safeParse({}).success).toBe(false);
        expect(schema.safeParse({ ...spec.minimal, name: undefined }).success).toBe(false);
        if (spec.kind === 'user') expect(schema.safeParse({ name: NAME }).success).toBe(false);
      });
    }
  });
});

describe('user and group update semantics', () => {
  it.each([true, false])('preserves disabled=%s as the only user update', async (disabled) => {
    const { client, invoke, schema } = setup('swsd_update_user');
    client.setPutResponse({ ...RESPONSE, disabled });
    const result = await invoke({ id: ID, disabled });
    expect(client.calls).toEqual([{ type: 'put', path: '/users/42.json', body: { user: { disabled } } }]);
    expect(result.structuredContent?.changed_fields).toEqual(['disabled']);
    expect(result.structuredContent?.user).toMatchObject({ disabled });
    expect(schema.safeParse({ id: ID, disabled: 'false' }).success).toBe(false);
  });

  it('sends an empty group description as a change while forcing is_user false', async () => {
    const { client, invoke } = setup('swsd_update_group');
    client.setPutResponse({ ...RESPONSE, description: '' });
    const result = await invoke({ id: ID, description: '', is_user: true });
    expect(client.calls).toEqual([{
      type: 'put', path: '/groups/42.json', body: { group: { description: '', is_user: false } },
    }]);
    expect(result.structuredContent?.changed_fields).toEqual(['description']);
  });
});

describe('swsd_add_group_member', () => {
  const input = { group_id: 7, user_id: 8 };

  it('previews query parameters in dry-run without a body or SWSD calls', async () => {
    const { client, invoke } = setup('swsd_add_group_member', 'dry-run');
    const result = await invoke(input);
    expect(result.structuredContent).toEqual({
      dry_run: true, request: { method: 'POST', path: '/memberships.json?group_id=7&user_ids=8', body: undefined },
    });
    expect(client.calls).toEqual([]);
  });

  it('blocks disabled membership creation', async () => {
    const { client, invoke } = setup('swsd_add_group_member', 'disabled');
    const result = await invoke(input);
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('SWSD_WRITE_MODE=disabled');
    expect(client.calls).toEqual([]);
  });

  it.each([
    { id: ID }, { membership: { id: String(ID) } },
    [{ id: ID }], { memberships: [{ membership: { id: String(ID) } }] },
  ].map((body) => ({ body })))('sends query parameters and no body, returning the membership id: $body', async ({ body }) => {
    const { client, invoke, tool } = setup('swsd_add_group_member');
    client.setRawResponse(body);
    const result = await invoke(input);
    expect(client.calls).toEqual([{
      type: 'raw', path: '/memberships.json', init: { method: 'POST', query: { group_id: 7, user_ids: 8 } },
    }]);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ membership_id: ID, group_id: 7, user_id: 8 });
    expect(tool.annotations).toEqual({
      readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false,
    });
  });

  it.each([null, {}, [], [{ id: 1 }, { id: 2 }], { id: 0 }, { id: true }, { id: 'invalid' }, { id: 1.5 }].map((body) => ({ body })))(
    'does not report success without a unique valid membership id: $body', async ({ body }) => {
      const { client, invoke } = setup('swsd_add_group_member');
      client.setRawResponse(body);
      const result = await invoke(input);
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(JSON.stringify(result.content)).toContain('Verify group membership before retrying');
      expect(client.calls).toHaveLength(1);
    },
  );

  it('maps upstream membership creation errors without retrying', async () => {
    const { client, invoke } = setup('swsd_add_group_member');
    const call = vi.spyOn(client, 'rawRequest').mockRejectedValue(new SwsdHttpError(500, {}));
    const result = await invoke(input);
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('SWSD server error (500)');
    expect(call).toHaveBeenCalledOnce();
  });

  it('sends a bodyless POST with the exact query string through the real HTTP client', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ membership: { id: ID } }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const server = new McpServer({ name: 'membership-http-test', version: '0.0.0' });
    const client = createSwsdClient({
      env: EnvSchema.parse({ SWSD_BASE_URL: 'https://api.samanage.com' }),
      token: 'synthetic-token',
    });
    registerAddGroupMember(server, makeCtx(client));
    const tool = getRegisteredTool(server, 'swsd_add_group_member');
    const result = await tool.handler(input, {}) as CallToolResult;
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.samanage.com/memberships.json?group_id=7&user_ids=8');
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('body');
    expect(result.structuredContent?.membership_id).toBe(ID);
  });
});

describe('swsd_remove_group_member', () => {
  it.each([{}, { confirm: true }, { confirm: true, confirm_id: ID + 1 }, { confirm: false, confirm_id: ID }])(
    'previews the supplied membership id without an undocumented GET: %j', async (confirmation) => {
      const { client, invoke } = setup('swsd_remove_group_member');
      const result = await invoke({ membership_id: ID, ...confirmation });
      expect(result.structuredContent).toEqual({
        confirmation_required: true, would_delete: { membership_id: ID },
        request: { method: 'DELETE', path: '/memberships/42.json' },
        hint: expect.stringContaining('confirm_id:42'),
      });
      expect(client.calls).toEqual([]);
    },
  );

  it('previews dry-run even with matching confirmation', async () => {
    const { client, invoke } = setup('swsd_remove_group_member', 'dry-run');
    const result = await invoke({ membership_id: ID, confirm: true, confirm_id: ID });
    expect(result.structuredContent).toEqual({
      dry_run: true, would_delete: { membership_id: ID },
      request: { method: 'DELETE', path: '/memberships/42.json' },
      hint: expect.stringContaining('confirm_id:42'),
    });
    expect(client.calls).toEqual([]);
  });

  it('blocks disabled removal even with matching confirmation', async () => {
    const { client, invoke } = setup('swsd_remove_group_member', 'disabled');
    const result = await invoke({ membership_id: ID, confirm: true, confirm_id: ID });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('SWSD_WRITE_MODE=disabled');
    expect(client.calls).toEqual([]);
  });

  it('deletes exactly the confirmed membership and declares delete annotations', async () => {
    const { client, invoke, tool } = setup('swsd_remove_group_member');
    client.setDeleteResponse({ private_metadata: SECRET });
    const result = await invoke({ membership_id: ID, confirm: true, confirm_id: ID });
    expect(client.calls).toEqual([{ type: 'delete', path: '/memberships/42.json' }]);
    expect(result.structuredContent).toEqual({
      deleted: true, record: { membership_id: ID }, request: { method: 'DELETE', path: '/memberships/42.json' },
    });
    expect(result.isError).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(tool.description).toMatch(/^DESTRUCTIVE/);
    expect(tool.annotations).toEqual({
      readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: true,
    });
  });

  it('maps upstream removal errors without reporting success or retrying', async () => {
    const { client, invoke } = setup('swsd_remove_group_member');
    const call = vi.spyOn(client, 'delete').mockRejectedValue(new SwsdHttpError(404, {}));
    const result = await invoke({ membership_id: ID, confirm: true, confirm_id: ID });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(call).toHaveBeenCalledExactlyOnceWith('/memberships/42.json');
  });
});

describe('membership input bounds', () => {
  it.each([
    { name: 'swsd_add_group_member', input: { group_id: 7, user_id: 8 }, fields: ['group_id', 'user_id'] },
    { name: 'swsd_remove_group_member', input: { membership_id: ID }, fields: ['membership_id', 'confirm_id'] },
  ])('validates positive safe ids for $name', ({ name, input, fields }) => {
    const { schema } = setup(name);
    expect(schema.safeParse({}).success).toBe(false);
    for (const field of fields) {
      for (const value of [1, Number.MAX_SAFE_INTEGER]) {
        expect(schema.safeParse({ ...input, [field]: value }).success).toBe(true);
      }
      for (const value of [0, -1, 1.5, '42', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        expect(schema.safeParse({ ...input, [field]: value }).success).toBe(false);
      }
    }
    if (name === 'swsd_remove_group_member') {
      expect(schema.parse(input)).toEqual({ ...input, confirm: false });
      expect(schema.safeParse({ ...input, confirm: 'true' }).success).toBe(false);
      expect(schema.safeParse({ id: ID }).success).toBe(false);
    }
  });
});

describe('swsd_get_role', () => {
  it.each(['live', 'dry-run', 'disabled'] as const)('maps role reads in %s write mode', async (mode) => {
    const { client, invoke, tool } = setup('swsd_get_role', mode);
    for (const response of [responseFor('role'), { role: responseFor('role') }]) {
      client.setLookupBody(response);
      const result = await invoke({ id: ID });
      expect(result.structuredContent).toEqual({ role: { id: ID, name: NAME, description: DESCRIPTION } });
      expect(result.isError).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain(SECRET);
    }
    expect(client.calls).toEqual([
      { type: 'get', path: '/roles/42.json', params: {} },
      { type: 'get', path: '/roles/42.json', params: {} },
    ]);
    expect(tool.annotations).toEqual({
      readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true,
    });
  });

  it('rejects invalid role ids', () => {
    const { schema } = setup('swsd_get_role');
    for (const id of [0, -1, 1.5, '42', Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(schema.safeParse({ id }).success).toBe(false);
    }
  });

  it('reports unparseable roles', async () => {
    const { client, invoke } = setup('swsd_get_role');
    client.setLookupBody({ role: { name: NAME } });
    const result = await invoke({ id: ID });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('Could not parse role');
    expect(client.calls).toEqual([{ type: 'get', path: '/roles/42.json', params: {} }]);
  });

  it('maps upstream role read errors', async () => {
    const { client, invoke } = setup('swsd_get_role');
    const get = vi.spyOn(client, 'get').mockRejectedValue(new SwsdHttpError(404, {}));
    expect((await invoke({ id: ID })).isError).toBe(true);
    expect(get).toHaveBeenCalledExactlyOnceWith('/roles/42.json');
  });
});

describe('directory profiles and registry', () => {
  const names = CASES.flatMap(({ kind }) => ['create', 'update', 'delete'].map((action) => `swsd_${action}_${kind}`))
    .concat(['swsd_add_group_member', 'swsd_remove_group_member']);

  it.each(['triage', 'agent', 'knowledge', 'operations'] as const)(
    'exposes directory writes only to operations and role reads wherever roles are listed: %s', (profile) => {
      const tools: readonly string[] = PROFILE_TOOLS[profile];
      const allowed = profile === 'operations';
      for (const name of names) expect(tools.includes(name), name).toBe(allowed);
      expect(tools.includes('swsd_get_role')).toBe(tools.includes('swsd_list_roles'));
      expect(new Set(tools).size).toBe(tools.length);
      const server = new McpServer({ name: 'directory-profile-test', version: '0.0.0' });
      const ctx = makeCtx(makeFakeClient(), { SWSD_ENABLE_EXTRAS: [] });
      ctx.profile = profile;
      registerTools(server, ctx);
      for (const name of names) expect(ctx.enabledTools.includes(name), name).toBe(allowed);
      expect(ctx.enabledTools.includes('swsd_get_role')).toBe(tools.includes('swsd_list_roles'));
    },
  );

  it('registers non-delete directory tools through explicit extras', () => {
    const server = new McpServer({ name: 'directory-extras-test', version: '0.0.0' });
    const extras = [...names, 'swsd_get_role'].filter(name => !name.startsWith('swsd_delete_') && name !== 'swsd_remove_group_member');
    const ctx = makeCtx(makeFakeClient(), { SWSD_ENABLE_EXTRAS: extras });
    ctx.profile = 'triage';
    registerTools(server, ctx);
    for (const name of extras) expect(getRegisteredTool(server, name)).toBeDefined();
  });
});
