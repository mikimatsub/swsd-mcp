import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { ListRecordTasksInput } from '../../schemas/recordCommentsTasks.js';
import { structuredResult } from '../../mcp/output.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { requireListArray } from '../../swsd/list-helper.js';
import { toTask } from '../../swsd/mappers/task.js';
import type { ToolContext } from '../../config/toolRegistry.js';

const TaskOutput = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string().optional(),
  description_no_html: z.string().optional(),
  state: z.string(),
  completed: z.boolean(),
  position: z.number().int().optional(),
  assignee: z
    .object({
      id: z.number().int().optional(),
      name: z.string().optional(),
      email: z.string().optional(),
    })
    .optional(),
  due_at: z.string().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export function registerListRecordTasks(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_list_record_tasks',
    {
      description:
        'List sub-tasks on a SWSD problem, change, or release. Returns id, name, description, state, ' +
        'completed boolean, position, assignee, due_at, created_at, updated_at. ' +
        'Use swsd_create_record_task to add a sub-task.',
      inputSchema: ListRecordTasksInput,
      outputSchema: z.object({
        tasks: z.array(TaskOutput),
        count: z.number().int(),
        record_type: ListRecordTasksInput.shape.record_type,
        record_id: z.number().int(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    },
    async ({ record_type, record_id }) => {
      try {
        const { body } = await ctx.client.get<unknown>(
          `/${record_type}/${String(record_id)}/tasks.json`,
        );
        const arr = requireListArray(body);
        const tasks = arr
          .map(toTask)
          .filter((x): x is NonNullable<typeof x> => x !== null);
        return structuredResult(
          { tasks, count: tasks.length, record_type, record_id },
          `Returned ${String(tasks.length)} task${tasks.length === 1 ? '' : 's'} on ${record_type} record ${String(record_id)}.`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
