import { describe, expect, it } from 'vitest';
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import { registerListIncidentTasks } from '../../../src/tools/tasks/listIncidentTasks.js';
import { registerListRecordTasks } from '../../../src/tools/tasks/listRecordTasks.js';
import { registerCreateIncidentTask } from '../../../src/tools/tasks/createIncidentTask.js';
import { registerCreateRecordTask } from '../../../src/tools/tasks/createRecordTask.js';
import { registerUpdateTask } from '../../../src/tools/tasks/updateTask.js';
import { getRegisteredTool, makeCtx, makeFakeClient } from './_helpers/mockClient.js';

const CASES = [
  { name: 'swsd_list_incident_tasks', register: registerListIncidentTasks, input: { incident_id: 1234567 }, list: true },
  { name: 'swsd_list_record_tasks', register: registerListRecordTasks, input: { record_type: 'changes', record_id: 1234567 }, list: true },
  { name: 'swsd_create_incident_task', register: registerCreateIncidentTask, input: { incident_id: 1234567, name: 'Synthetic task' } },
  { name: 'swsd_create_record_task', register: registerCreateRecordTask, input: { record_type: 'changes', record_id: 1234567, name: 'Synthetic task' } },
  { name: 'swsd_update_task', register: registerUpdateTask, input: { incident_id: 1234567, task_id: 2345678, is_complete: true } },
];

describe('shared task completion mapping', () => {
  it.each(CASES)('$name honors boolean completion in both state and completed', async ({ name, register, input, list }) => {
    const task = { id: 2345678, name: 'Synthetic task', is_complete: true };
    const client = makeFakeClient();
    client.setLookupBody([task]);
    client.setPostResponse(task);
    client.setPutResponse({ task });
    const server = new McpServer({ name: 'synthetic-task-completion', version: '0.0.0' });
    register(server, makeCtx(client));
    const tool = getRegisteredTool(server, name);
    const result = await tool.handler((tool.inputSchema as z.ZodType).parse(input), {}) as CallToolResult;

    expect(result.isError).toBeUndefined();
    const mapped = { id: 2345678, name: 'Synthetic task', state: 'Completed', completed: true };
    expect(result.structuredContent).toMatchObject(list ? { tasks: [mapped] } : { task: mapped });
  });
});
