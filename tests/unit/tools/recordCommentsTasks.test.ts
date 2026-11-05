import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import { PROFILE_TOOLS } from '../../../src/config/profiles.js';
import type { ProfileName } from '../../../src/config/env.js';
import { registerTools } from '../../../src/config/toolRegistry.js';
import { MAX_EMAIL_CHARS, MAX_LABEL_CHARS } from '../../../src/schemas/limits.js';
import { SwsdHttpError } from '../../../src/swsd/errors.js';
import { makeCtx, makeFakeClient, getRegisteredTool } from './_helpers/mockClient.js';

const RECORD_TYPES = ['problems', 'changes', 'releases'] as const;
const RECORD_ID = 42;
const BODY = 'Synthetic record comment';
const NAME = 'Synthetic record task';
const EMAIL = 'agent@example.com';
const DUE_AT = '2026-12-01T12:00:00Z';
const READ_TOOLS = ['swsd_list_record_comments', 'swsd_list_record_tasks'];
const WRITE_CASES = [
  {
    name: 'swsd_add_record_comment',
    collection: 'comments',
    fields: { body: BODY, is_private: true },
    payload: { comment: { body: BODY, is_private: true } },
  },
  {
    name: 'swsd_create_record_task',
    collection: 'tasks',
    fields: { name: NAME, assignee_email: EMAIL, due_at: DUE_AT },
    payload: { task: { name: NAME, assignee: { email: EMAIL }, due_at: DUE_AT } },
  },
];

type Mode = 'live' | 'dry-run' | 'disabled';

function setup(name: string, mode: Mode = 'live') {
  const server = new McpServer({ name: 'record-comments-tasks-test', version: '0.0.0' });
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

describe.each(RECORD_TYPES)('comments and tasks on %s', (record_type) => {
  const ref = { record_type, record_id: RECORD_ID };
  const basePath = '/' + record_type + '/' + String(RECORD_ID);

  it('lists and maps comments with pagination and the parent identity', async () => {
    const { client, invoke } = setup('swsd_list_record_comments');
    client.setLookupBody([
      {
        id: '7', body: BODY, is_private: true,
        user: { name: 'Synthetic agent', email: EMAIL },
        created_at: '2026-11-01T12:00:00Z',
      },
      null,
      { body: 'Synthetic row without an ID' },
    ]);

    const result = await invoke({ ...ref, page: 2, per_page: 10 });

    expect(client.calls).toEqual([
      { type: 'get', path: basePath + '/comments.json', params: { page: 2, per_page: 10 } },
    ]);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      ...ref,
      comments: [{
        id: 7, body: BODY, is_private: true,
        author_name: 'Synthetic agent', author_email: EMAIL, created_at: '2026-11-01T12:00:00Z',
      }],
      pagination: { page: 1, per_page: 25, has_more: false },
    });
  });

  it('lists and maps tasks with completion state and the parent identity', async () => {
    const { client, invoke } = setup('swsd_list_record_tasks');
    client.setLookupBody([
      { id: '8', name: NAME, state: 'Completed', assignee: { email: EMAIL }, due_at: DUE_AT },
      { id: 9, name: 'Synthetic open task', state: 'New' },
      null,
      { name: 'Synthetic row without an ID' },
    ]);

    const result = await invoke(ref);

    expect(client.calls).toEqual([
      { type: 'get', path: basePath + '/tasks.json', params: {} },
    ]);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      ...ref,
      count: 2,
      tasks: [
        { id: 8, name: NAME, state: 'Completed', completed: true, assignee: { email: EMAIL }, due_at: DUE_AT },
        { id: 9, name: 'Synthetic open task', state: 'New', completed: false },
      ],
    });
  });

  it.each([false, true])('posts a comment with is_private=%s and returns the mapped response', async (is_private) => {
    const { client, invoke } = setup('swsd_add_record_comment');
    client.setPostResponse({ id: '10', body: BODY, is_private, commenter: { email: EMAIL } });

    const result = await invoke({ ...ref, body: BODY, is_private });

    expect(client.calls).toEqual([
      { type: 'post', path: basePath + '/comments.json', body: { comment: { body: BODY, is_private } } },
    ]);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      comment: { id: 10, body: BODY, is_private, author_email: EMAIL },
    });
  });

  it('posts a task with the task envelope and nested assignee', async () => {
    const { client, invoke } = setup('swsd_create_record_task');
    client.setPostResponse({ id: '11', name: NAME, state: 'New', assignee: { email: EMAIL }, due_at: DUE_AT });

    const result = await invoke({ ...ref, name: NAME, assignee_email: EMAIL, due_at: DUE_AT });

    expect(client.calls).toEqual([
      {
        type: 'post', path: basePath + '/tasks.json',
        body: { task: { name: NAME, assignee: { email: EMAIL }, due_at: DUE_AT } },
      },
    ]);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      task: { id: 11, name: NAME, completed: false, assignee: { email: EMAIL }, due_at: DUE_AT },
    });
  });

  for (const entry of WRITE_CASES) {
    it(entry.name + ' previews the exact payload without API calls in dry-run', async () => {
      const { client, invoke } = setup(entry.name, 'dry-run');

      const result = await invoke({ ...ref, ...entry.fields });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual({
        dry_run: true,
        request: { method: 'POST', path: basePath + '/' + entry.collection + '.json', body: entry.payload },
      });
      expect(client.calls).toEqual([]);
    });

    it(entry.name + ' blocks before any API call when disabled', async () => {
      const { client, invoke } = setup(entry.name, 'disabled');

      const result = await invoke({ ...ref, ...entry.fields });

      expect(result.isError).toBe(true);
      expect(result.content).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'text', text: expect.stringContaining('SWSD_WRITE_MODE=disabled') }),
      ]));
      expect(client.calls).toEqual([]);
    });
  }
});

describe('record comment/task defaults and errors', () => {
  const ref = { record_type: 'problems', record_id: RECORD_ID };

  it('defaults comment visibility to public', async () => {
    const { client, invoke } = setup('swsd_add_record_comment');
    client.setPostResponse({ id: 10, body: BODY, is_private: false });
    await invoke({ ...ref, body: BODY });
    expect(client.calls).toEqual([{
      type: 'post', path: '/problems/42/comments.json', body: { comment: { body: BODY, is_private: false } },
    }]);
  });

  it('omits optional task fields', async () => {
    const { client, invoke } = setup('swsd_create_record_task');
    client.setPostResponse({ id: 11, name: NAME, state: 'New' });
    await invoke({ ...ref, name: NAME });
    expect(client.calls).toEqual([{
      type: 'post', path: '/problems/42/tasks.json', body: { task: { name: NAME } },
    }]);
  });

  it('defaults comment pagination', async () => {
    const { client, invoke } = setup('swsd_list_record_comments');
    await invoke(ref);
    expect(client.calls).toEqual([{
      type: 'get', path: '/problems/42/comments.json', params: { page: 1, per_page: 25 },
    }]);
  });

  for (const name of READ_TOOLS) {
    it(name + ' maps API errors', async () => {
      const { client, invoke } = setup(name);
      const get = vi.spyOn(client, 'get').mockRejectedValue(new SwsdHttpError(403, 'Synthetic denial'));
      expect((await invoke(ref)).isError).toBe(true);
      expect(get).toHaveBeenCalledTimes(1);
    });

    it(name + ' rejects a non-array response as a decode error', async () => {
      const { client, invoke } = setup(name);
      client.setLookupBody(null);
      const result = await invoke(ref);
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(JSON.stringify(result.content)).toMatch(/decode/i);
    });
  }

  for (const entry of WRITE_CASES) {
    it(entry.name + ' maps transient failures without retrying POST', async () => {
      const { client, invoke } = setup(entry.name);
      const post = vi.spyOn(client, 'post').mockRejectedValue(new SwsdHttpError(503, 'Synthetic outage'));
      expect((await invoke({ ...ref, ...entry.fields })).isError).toBe(true);
      expect(post).toHaveBeenCalledTimes(1);
      expect(post).toHaveBeenCalledWith('/problems/42/' + entry.collection + '.json', entry.payload);
    });

    it(entry.name + ' rejects an unparseable response', async () => {
      const { client, invoke } = setup(entry.name);
      client.setPostResponse({ unexpected: true });
      const result = await invoke({ ...ref, ...entry.fields });
      expect(result.isError).toBe(true);
      expect(client.calls).toHaveLength(1);
    });
  }
});

describe('record comment/task input validation and annotations', () => {
  const ref = { record_type: 'problems', record_id: RECORD_ID };
  const cases = [
    ...READ_TOOLS.map((name) => ({ name, fields: {} })),
    ...WRITE_CASES,
  ];

  for (const entry of cases) {
    it(entry.name + ' rejects unsupported record types and non-positive integer IDs', () => {
      const { schema, client } = setup(entry.name);
      for (const record_type of ['incidents', 'solutions', 'problem', '../changes', '', null]) {
        expect(schema.safeParse({ ...ref, ...entry.fields, record_type }).success).toBe(false);
      }
      for (const record_id of [0, -1, 1.5, '42', null, Number.MAX_SAFE_INTEGER + 1]) {
        expect(schema.safeParse({ ...ref, ...entry.fields, record_id }).success).toBe(false);
      }
      expect(schema.safeParse({ ...entry.fields, record_id: RECORD_ID }).success).toBe(false);
      expect(schema.safeParse({ ...entry.fields, record_type: 'problems' }).success).toBe(false);
      expect(client.calls).toEqual([]);
    });

    it(entry.name + ' declares the existing read/write annotations', () => {
      const { tool } = setup(entry.name);
      const readOnly = READ_TOOLS.includes(entry.name);
      expect(tool.annotations).toEqual({
        readOnlyHint: readOnly, destructiveHint: false, openWorldHint: true, idempotentHint: readOnly,
      });
    });
  }

  it('retains the incident comment body and privacy bounds', () => {
    const { schema } = setup('swsd_add_record_comment');
    expect(schema.safeParse({ ...ref, body: 'x'.repeat(50_000) }).success).toBe(true);
    for (const body of ['', 'x'.repeat(50_001), 42, null]) {
      expect(schema.safeParse({ ...ref, body }).success).toBe(false);
    }
    expect(schema.safeParse({ ...ref }).success).toBe(false);
    expect(schema.safeParse({ ...ref, body: BODY, is_private: 'true' }).success).toBe(false);
  });

  it('retains the incident comment pagination bounds', () => {
    const { schema } = setup('swsd_list_record_comments');
    expect(schema.safeParse({ ...ref, page: 10_000, per_page: 100 }).success).toBe(true);
    for (const page of [0, -1, 1.5, 10_001]) {
      expect(schema.safeParse({ ...ref, page }).success).toBe(false);
    }
    for (const per_page of [0, -1, 1.5, 101]) {
      expect(schema.safeParse({ ...ref, per_page }).success).toBe(false);
    }
  });

  it('retains the bounded task name, email, and ISO date schemas', () => {
    const { schema } = setup('swsd_create_record_task');
    expect(schema.safeParse({ ...ref, name: 'x'.repeat(MAX_LABEL_CHARS), assignee_email: EMAIL }).success).toBe(true);
    for (const name of ['', 'x'.repeat(MAX_LABEL_CHARS + 1), null]) {
      expect(schema.safeParse({ ...ref, name }).success).toBe(false);
    }
    expect(schema.safeParse(ref).success).toBe(false);
    for (const assignee_email of ['', 'not-an-email', 'x'.repeat(MAX_EMAIL_CHARS) + '@example.com']) {
      expect(schema.safeParse({ ...ref, name: NAME, assignee_email }).success).toBe(false);
    }
    for (const due_at of ['2026-12-01', DUE_AT, '2026-12-01T12:00:00-05:00']) {
      expect(schema.safeParse({ ...ref, name: NAME, due_at }).success).toBe(true);
    }
    for (const due_at of ['', 'tomorrow', '2026-02-30', '2026-12-01T12:00:00', 'x'.repeat(65)]) {
      expect(schema.safeParse({ ...ref, name: NAME, due_at }).success).toBe(false);
    }
  });
});

describe('record comment/task profiles', () => {
  it.each(Object.keys(PROFILE_TOOLS) as ProfileName[])('registers tools in %s according to the profile rules', (profile) => {
    const server = new McpServer({ name: 'record-profiles-test', version: '0.0.0' });
    const ctx = makeCtx(makeFakeClient(), { SWSD_ENABLE_EXTRAS: [] });
    ctx.profile = profile;
    registerTools(server, ctx);
    const names: readonly string[] = PROFILE_TOOLS[profile];
    const canList = names.includes('swsd_list_incident_comments') && names.includes('swsd_list_problems');
    for (const name of READ_TOOLS) {
      expect(names.includes(name)).toBe(canList);
      expect(ctx.enabledTools.includes(name)).toBe(canList);
      if (canList) expect(getRegisteredTool(server, name)).toBeDefined();
    }
    for (const { name } of WRITE_CASES) {
      const canWrite = profile === 'operations' || profile === 'full';
      expect(names.includes(name)).toBe(canWrite);
      expect(ctx.enabledTools.includes(name)).toBe(canWrite);
      if (canWrite) expect(getRegisteredTool(server, name)).toBeDefined();
    }
  });
});
