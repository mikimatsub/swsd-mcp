import type { McpServer } from '@modelcontextprotocol/server';
import { CreateRecordTaskInput } from '../../schemas/recordCommentsTasks.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { buildTaskWritePayload, toTask } from '../../swsd/mappers/task.js';
import { checkWriteMode } from '../shared/writeMode.js';
import type { ToolContext } from '../../config/toolRegistry.js';

export function registerCreateRecordTask(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_create_record_task',
    {
      description:
        'Create a new sub-task on a SWSD problem, change, or release. Required: `record_type`, `record_id`, `name`. ' +
        'Optional: `due_at` (ISO 8601), ' +
        '`assignee_email`. The created task is returned for follow-up calls. ' +
        'WRITE — does not retry on transient failure.',
      inputSchema: CreateRecordTaskInput,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
    },
    async ({ record_type, record_id, name, due_at, assignee_email }) => {
      try {
        const payload = buildTaskWritePayload({
          name,
          due_at,
          assignee_email,
        });
        const path = `/${record_type}/${String(record_id)}/tasks.json`;
        const gated = checkWriteMode(ctx, {
          method: 'POST',
          path,
          body: payload,
          action: `create task on ${record_type} record ${String(record_id)}`,
        });
        if (gated) return gated;
        const { body: respBody } = await ctx.client.post<unknown>(path, payload);
        const task = toTask(respBody);
        if (!task) {
          return toolError('Could not parse created-task response from SWSD.');
        }
        return structuredResult(
          { task },
          `Created task ${String(task.id)} on ${record_type} record ${String(record_id)}: ${task.name || '(no name)'}`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
