import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { registerCreateIncidentTask } from '../../../src/tools/tasks/createIncidentTask.js';
import {
  makeFakeClient,
  makeCtx,
  getRegisteredTool,
  type FakeClient,
  type RegisteredToolInternals,
} from './_helpers/mockClient.js';

describe('swsd_create_incident_task', () => {
  let server: McpServer;
  let client: FakeClient;
  let tool: RegisteredToolInternals;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    client = makeFakeClient();
    registerCreateIncidentTask(server, makeCtx(client));
    tool = getRegisteredTool(server, 'swsd_create_incident_task');
  });

  it('posts all provided fields under the `task` envelope and returns the new task', async () => {
    // 9-digit id → no resolver lookup; POST goes straight through.
    client.setPostResponse({
      id: 22222,
      name: 'Run rollback playbook',
      description: 'See runbook 4.2',
      state: 'New',
      position: 3,
      assignee: { id: 9001, name: 'Alex Agent', email: 'alex@example.com' },
      due_at: '2026-06-15T17:00:00Z',
      created_at: '2026-05-08T00:00:00Z',
      updated_at: '2026-05-08T00:00:00Z',
    });

    const result = (await tool.handler(
      {
        incident_id: 180457930,
        name: 'Run rollback playbook',
        description: 'See runbook 4.2',
        due_at: '2026-06-15T17:00:00Z',
        assignee_email: 'alex@example.com',
      },
      {},
    )) as CallToolResult;

    // No resolver call needed (id-sized input)
    const lookup = client.calls.find(
      (c) => c.type === 'get' && c.path === '/incidents.json',
    );
    expect(lookup).toBeUndefined();

    // POST payload uses the `task` envelope and includes every provided field
    const post = client.calls.find((c) => c.type === 'post');
    expect(post?.path).toBe('/incidents/180457930/tasks.json');
    expect(post?.type === 'post' ? post.body : {}).toEqual({
      task: {
        name: 'Run rollback playbook',
        description: 'See runbook 4.2',
        due_at: '2026-06-15T17:00:00Z',
        assignee: { email: 'alex@example.com' },
      },
    });

    // Mapped task is structuredContent
    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as { task: { id: number; name: string } };
    expect(sc.task).toMatchObject({ id: 22222, name: 'Run rollback playbook' });
  });

  it('omits optional fields from the payload when not provided', async () => {
    client.setPostResponse({
      id: 22223,
      name: 'Document RCA',
      state: 'New',
    });

    await tool.handler(
      {
        incident_id: 180457930,
        name: 'Document RCA',
        // description, due_at, assignee_email all omitted
      },
      {},
    );

    const post = client.calls.find((c) => c.type === 'post');
    // Only `name` should be present in the task envelope — no other keys.
    expect(post?.type === 'post' ? post.body : {}).toEqual({
      task: { name: 'Document RCA' },
    });
  });
});
