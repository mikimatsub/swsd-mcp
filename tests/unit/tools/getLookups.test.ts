import { describe, it, expect, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/server';
import {
  registerGetCategory,
  registerGetDepartment,
  registerGetGroup,
  registerGetSite,
  registerGetUser,
} from '../../../src/tools/lookups/getLookups.js';
import { SwsdHttpError } from '../../../src/swsd/errors.js';
import { makeFakeClient, makeCtx, getRegisteredTool } from './_helpers/mockClient.js';

function setup(register: typeof registerGetUser, name: string) {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const client = makeFakeClient();
  register(server, makeCtx(client));
  const tool = getRegisteredTool(server, name);
  const call = async (input: unknown) => (await tool.handler(input, {})) as CallToolResult;
  return { client, tool, call };
}

describe('directory get-by-id lookups', () => {
  it('swsd_get_user maps the user and group_ids', async () => {
    const { client, call } = setup(registerGetUser, 'swsd_get_user');
    client.setBodyForPath((p) => p === '/users/4100001.json', {
      id: 4100001,
      name: 'Avery Example',
      email: 'avery@example.com',
      role: { name: 'Service Desk Agent' },
      site: { name: 'HQ' },
      group_ids: [5100001, '5100002', 'x'],
      secret_token_field: 'should-not-leak',
    });
    const r = await call({ id: 4100001 });
    expect(r.isError).toBeUndefined();
    const user = (r.structuredContent as { user: Record<string, unknown> }).user;
    expect(user).toMatchObject({
      id: 4100001,
      name: 'Avery Example',
      role: 'Service Desk Agent',
      site: 'HQ',
      group_ids: [5100001, 5100002],
    });
    expect(user).not.toHaveProperty('secret_token_field');
  });

  it('swsd_get_group returns user members only', async () => {
    const { client, call } = setup(registerGetGroup, 'swsd_get_group');
    client.setBodyForPath((p) => p === '/groups/5100001.json', {
      id: 5100001,
      name: 'Network Team',
      memberships: [
        { id: 4100001, name: 'Avery Example', email: 'avery@example.com', is_user: true },
        { id: 5100009, name: 'Nested group', is_user: false },
        { name: 'no id' },
        'junk',
      ],
    });
    const r = await call({ id: 5100001 });
    const group = (r.structuredContent as { group: { members: unknown[]; member_count: number } }).group;
    expect(group.members).toEqual([{ id: 4100001, name: 'Avery Example', email: 'avery@example.com' }]);
    expect(group.member_count).toBe(1);
    expect(r.content[0]).toMatchObject({ text: 'Group 5100001: Network Team' });
  });

  it.each([
    [registerGetSite, 'swsd_get_site', 'sites', 'site'],
    [registerGetDepartment, 'swsd_get_department', 'departments', 'department'],
    [registerGetCategory, 'swsd_get_category', 'categories', 'category'],
  ] as const)('%s fetches /%s/{id}.json', async (reg, name, collection, key) => {
    const { client, call } = setup(reg, name);
    client.setBodyForPath((p) => p === `/${collection}/77.json`, { id: 77, name: 'Example' });
    const r = await call({ id: 77 });
    expect(r.isError).toBeUndefined();
    expect((r.structuredContent as Record<string, unknown>)[key]).toMatchObject({ id: 77, name: 'Example' });
  });

  it('returns a tool error for unparseable bodies', async () => {
    const { client, call } = setup(registerGetSite, 'swsd_get_site');
    client.setBodyForPath(() => true, { name: 'no id' });
    const r = await call({ id: 1 });
    expect(r.isError).toBe(true);
  });

  it('maps upstream HTTP errors', async () => {
    const { client, call } = setup(registerGetUser, 'swsd_get_user');
    vi.spyOn(client, 'get').mockRejectedValue(new SwsdHttpError(404, 'Not Found'));
    const r = await call({ id: 9 });
    expect(r.isError).toBe(true);
  });

  it('declares read-only annotations and rejects invalid ids', () => {
    const { tool } = setup(registerGetUser, 'swsd_get_user');
    expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    const schema = tool.inputSchema as { safeParse: (v: unknown) => { success: boolean } };
    expect(schema.safeParse({ id: 0 }).success).toBe(false);
    expect(schema.safeParse({ id: 1.5 }).success).toBe(false);
    expect(schema.safeParse({ id: 12 }).success).toBe(true);
  });
});
