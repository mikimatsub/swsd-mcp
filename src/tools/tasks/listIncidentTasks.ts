import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ListIncidentTasksInput } from '../../schemas/task.js';
import { structuredResult } from '../../mcp/output.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { toTask } from '../../swsd/mappers/task.js';
import { resolveIncidentRef } from '../../utils/idResolver.js';
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

export function registerListIncidentTasks(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_list_incident_tasks',
    {
      description:
        'List sub-tasks on a SWSD incident. Returns id, name, description, state ' +
        '("New" / "In Progress" / "Completed"), completed boolean, position, assignee, ' +
        'due_at, created_at, updated_at. Use swsd_create_incident_task to add a sub-task ' +
        'and swsd_update_task_state to mark one complete. Sub-tasks also appear inline in ' +
        '`swsd_get_incident detail_level: "long"`.',
      inputSchema: ListIncidentTasksInput.shape,
      outputSchema: z.object({
        tasks: z.array(TaskOutput),
        count: z.number().int(),
        incident_id: z.number().int(),
      }).shape,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    },
    async ({ incident_id }) => {
      try {
        const { id: resolvedIncidentId } = await resolveIncidentRef(incident_id, ctx.client);
        const { body } = await ctx.client.get<unknown>(
          `/incidents/${String(resolvedIncidentId)}/tasks.json`,
        );
        const arr = Array.isArray(body) ? body : [];
        const tasks = arr
          .map(toTask)
          .filter((x): x is NonNullable<typeof x> => x !== null);
        return structuredResult(
          { tasks, count: tasks.length, incident_id: resolvedIncidentId },
          `Returned ${String(tasks.length)} task${tasks.length === 1 ? '' : 's'} on incident ${String(resolvedIncidentId)}.`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
