import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import { registerUpdateProblem } from '../../../src/tools/problems/updateProblem.js';
import { UpdateProblemInput } from '../../../src/schemas/problem.js';
import { MAX_LABEL_CHARS, MAX_LONG_TEXT_CHARS } from '../../../src/schemas/limits.js';
import { SwsdHttpError, SwsdNetworkError } from '../../../src/swsd/errors.js';
import { PROFILE_TOOLS } from '../../../src/config/profiles.js';
import { registerTools } from '../../../src/config/toolRegistry.js';
import { makeCtx, makeFakeClient, getRegisteredTool } from './_helpers/mockClient.js';

const ID = 195000010;
const PATH = '/problems/195000010.json';
const RECORD = { id: ID, number: 4501, name: 'Synthetic mail backlog', state: 'New' };

function setup(mode: 'live' | 'dry-run' | 'disabled' = 'live') {
  const client = makeFakeClient();
  client.setPutResponse(RECORD);
  const ctx = makeCtx(client, { SWSD_WRITE_MODE: mode });
  ctx.token = 'synthetic-update-secret';
  const server = new McpServer({ name: 'update-problem-test', version: '0.0.0' });
  registerUpdateProblem(server, ctx);
  const tool = getRegisteredTool(server, 'swsd_update_problem');
  const invoke = async (input: z.input<typeof UpdateProblemInput>) =>
    await tool.handler(UpdateProblemInput.parse(input), {}) as CallToolResult;
  return { client, tool, invoke };
}

afterEach(() => vi.restoreAllMocks());

describe('swsd_update_problem', () => {
  it('updates only supplied fields and reports the exact changed_fields', async () => {
    const { client, invoke } = setup();
    const fields = {
      name: 'Synthetic updated problem',
      description: 'Synthetic description',
      priority: 'High',
      category: 'Messaging',
      subcategory: 'Queues',
      assignee_email: 'agent@example.test',
      requester_email: 'requester@example.test',
      state: 'In Progress',
      root_cause: 'Synthetic capacity limit',
      symptoms: 'Synthetic delivery delay',
      workaround: 'Synthetic rerouting',
    };
    const payload = {
      name: fields.name,
      description: fields.description,
      priority: fields.priority,
      category: { name: fields.category },
      subcategory: { name: fields.subcategory },
      assignee: { email: fields.assignee_email },
      requester: { email: fields.requester_email },
      state: fields.state,
      root_cause: fields.root_cause,
      symptoms: fields.symptoms,
      workaround: fields.workaround,
    };
    const updated = { ...RECORD, ...payload };
    client.setPutResponse(updated);

    const result = await invoke({ id: ID, ...fields });

    expect(client.calls).toEqual([{ type: 'put', path: PATH, body: { problem: payload } }]);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      problem: updated,
      changed_fields: [
        'name', 'description', 'priority', 'category', 'subcategory', 'assignee',
        'requester', 'state', 'root_cause', 'symptoms', 'workaround',
      ],
    });
    expect(result.content).toEqual([{
      type: 'text',
      text: 'Updated problem 195000010 (name, description, priority, category, subcategory, assignee, requester, state, root_cause, symptoms, workaround).',
    }]);
  });

  it('preserves explicit empty text while omitting absent fields', async () => {
    const { client, invoke } = setup();
    const result = await invoke({ id: ID, root_cause: '', symptoms: '', workaround: '' });
    expect(client.calls).toEqual([{
      type: 'put', path: PATH,
      body: { problem: { root_cause: '', symptoms: '', workaround: '' } },
    }]);
    expect(result.structuredContent?.changed_fields).toEqual(['root_cause', 'symptoms', 'workaround']);
  });

  it('resolves a problem number before updating the internal id', async () => {
    const { client, invoke } = setup();
    client.setLookupBody([
      { id: ID + 1, number: 4502, name: 'Contains 4501 in its text' },
      RECORD,
    ]);
    await invoke({ id: 4501, state: 'Resolved' });
    expect(client.calls).toEqual([
      { type: 'get', path: '/problems.json', params: { query: 4501, per_page: 25 } },
      { type: 'put', path: PATH, body: { problem: { state: 'Resolved' } } },
    ]);
  });

  it('returns a dry-run payload with the resolved id and sends no PUT', async () => {
    const { client, invoke } = setup('dry-run');
    client.setLookupBody([RECORD]);
    const result = await invoke({ id: 4501, state: 'Resolved', workaround: 'Synthetic workaround' });
    expect(result.structuredContent).toEqual({
      dry_run: true,
      request: {
        method: 'PUT', path: PATH,
        body: { problem: { state: 'Resolved', workaround: 'Synthetic workaround' } },
      },
    });
    expect(client.calls).toEqual([
      { type: 'get', path: '/problems.json', params: { query: 4501, per_page: 25 } },
    ]);
  });

  it('blocks disabled writes without sending a PUT', async () => {
    const { client, invoke } = setup('disabled');
    const result = await invoke({ id: ID, name: 'Synthetic replacement' });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('SWSD_WRITE_MODE=disabled');
    expect(client.calls).toEqual([]);
  });

  it('rejects an empty update before any client call', async () => {
    const { client, invoke } = setup();
    const result = await invoke({ id: 4501 });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('No fields to update');
    expect(client.calls).toEqual([]);
  });

  it('maps resolver failures without writing', async () => {
    const { client, invoke } = setup();
    const result = await invoke({ id: 4501, state: 'Resolved' });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('No problem found with number 4501');
    expect(client.calls).toEqual([
      { type: 'get', path: '/problems.json', params: { query: 4501, per_page: 25 } },
    ]);
  });

  it.each([
    [new SwsdHttpError(422, { errors: { state: ['is invalid'] } }), 'state: is invalid'],
    [new SwsdHttpError(403, {}), 'Forbidden.'],
    [new SwsdNetworkError(new Error('Synthetic connection failure')), 'Network error contacting SWSD'],
  ])('maps upstream update errors: %s', async (error, message) => {
    const { client, invoke } = setup();
    const put = vi.spyOn(client, 'put').mockRejectedValue(error);
    const result = await invoke({ id: ID, state: 'Resolved' });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain(message);
    expect(put).toHaveBeenCalledExactlyOnceWith(PATH, { problem: { state: 'Resolved' } });
  });

  it('rejects an unparseable update response', async () => {
    const { client, invoke } = setup();
    client.setPutResponse(null);
    const result = await invoke({ id: ID, name: 'Synthetic replacement' });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('Could not parse updated-problem response');
  });

  it.each(['live', 'dry-run', 'disabled'] as const)(
    'does not expose the token or Authorization headers in %s result text',
    async (mode) => {
      const { client, invoke } = setup(mode);
      vi.spyOn(client, 'put').mockResolvedValue({
        body: RECORD,
        headers: new Headers({ Authorization: 'Bearer synthetic-update-secret' }),
        status: 200,
      });
      const result = await invoke({ id: ID, name: 'Synthetic replacement' });
      expect(JSON.stringify(result)).not.toContain('synthetic-update-secret');
      expect(JSON.stringify(result)).not.toMatch(/authorization/i);
    },
  );

  it('declares update annotations and is registered beside problem creation', () => {
    expect(setup().tool.annotations).toEqual({
      readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true,
    });
    for (const profile of ['agent', 'operations', 'full'] as const) {
      const names: readonly string[] = PROFILE_TOOLS[profile];
      expect(names[names.indexOf('swsd_create_problem') + 1]).toBe('swsd_update_problem');
      const server = new McpServer({ name: 'registry-test', version: '0.0.0' });
      const ctx = makeCtx(makeFakeClient(), { SWSD_ENABLE_EXTRAS: [] });
      ctx.profile = profile;
      registerTools(server, ctx);
      expect(ctx.enabledTools).toContain('swsd_update_problem');
    }
    for (const profile of ['triage', 'knowledge'] as const) {
      expect(PROFILE_TOOLS[profile]).not.toContain('swsd_update_problem');
    }
  });

  it.each([
    ['name', MAX_LABEL_CHARS], ['priority', MAX_LABEL_CHARS],
    ['category', MAX_LABEL_CHARS], ['subcategory', MAX_LABEL_CHARS],
    ['state', MAX_LABEL_CHARS], ['description', MAX_LONG_TEXT_CHARS],
    ['root_cause', MAX_LONG_TEXT_CHARS], ['symptoms', MAX_LONG_TEXT_CHARS],
    ['workaround', MAX_LONG_TEXT_CHARS],
  ] as const)('enforces the exact %s length boundary', (field, limit) => {
    expect(UpdateProblemInput.safeParse({ id: ID, [field]: 'x'.repeat(limit) }).success).toBe(true);
    expect(UpdateProblemInput.safeParse({ id: ID, [field]: 'x'.repeat(limit + 1) }).success).toBe(false);
  });

  it.each(['assignee_email', 'requester_email'] as const)('validates %s', (field) => {
    expect(UpdateProblemInput.safeParse({ id: ID, [field]: 'agent@example.test' }).success).toBe(true);
    expect(UpdateProblemInput.safeParse({ id: ID, [field]: 'invalid' }).success).toBe(false);
    expect(UpdateProblemInput.safeParse({ id: ID, [field]: 'x'.repeat(321) + '@example.test' }).success).toBe(false);
  });
});
