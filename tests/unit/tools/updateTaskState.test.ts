import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { registerUpdateTaskState } from '../../../src/tools/tasks/updateTaskState.js';
import {
  makeFakeClient,
  makeCtx,
  getRegisteredTool,
  type FakeClient,
  type RegisteredToolInternals,
} from './_helpers/mockClient.js';

describe('swsd_update_task_state', () => {
  let server: McpServer;
  let client: FakeClient;
  let tool: RegisteredToolInternals;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    client = makeFakeClient();
    registerUpdateTaskState(server, makeCtx(client));
    tool = getRegisteredTool(server, 'swsd_update_task_state');
  });

  it('completed: true → PUT { task: { state: "Completed" } }', async () => {
    client.setPutResponse({
      id: 12345,
      name: 'Verify backup integrity',
      state: 'Completed',
    });

    const result = (await tool.handler(
      { incident_id: 180457930, task_id: 12345, completed: true },
      {},
    )) as CallToolResult;

    const put = client.calls.find((c) => c.type === 'put');
    expect(put?.path).toBe('/incidents/180457930/tasks/12345.json');
    expect(put?.type === 'put' ? put.body : {}).toEqual({
      task: { state: 'Completed' },
    });

    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as { task: { state: string; completed: boolean } };
    expect(sc.task).toMatchObject({ state: 'Completed', completed: true });
  });

  it('completed: false → PUT { task: { state: "New" } } and resolves number-form incident_id', async () => {
    // Use a 5-digit number so the resolver runs alongside the PUT.
    client.setBodyForPath(
      (p) => p === '/incidents.json',
      [{ id: 180457930, number: 60310 }],
    );
    client.setPutResponse({
      id: 12345,
      name: 'Verify backup integrity',
      state: 'New',
    });

    await tool.handler(
      { incident_id: 60310, task_id: 12345, completed: false },
      {},
    );

    // Resolver lookup must precede the PUT
    const lookup = client.calls.find(
      (c) => c.type === 'get' && c.path === '/incidents.json',
    );
    expect(lookup).toBeDefined();
    expect(lookup?.type === 'get' ? lookup.params : {}).toMatchObject({
      query: 60310,
    });

    // PUT uses the RESOLVED 9-digit id and the "New" state for completed=false
    const put = client.calls.find((c) => c.type === 'put');
    expect(put?.path).toBe('/incidents/180457930/tasks/12345.json');
    expect(put?.type === 'put' ? put.body : {}).toEqual({
      task: { state: 'New' },
    });
  });
});
