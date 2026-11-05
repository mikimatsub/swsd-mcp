import type { McpServer } from '@modelcontextprotocol/server';
import { UpdateTaskInput } from '../../schemas/task.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { buildTaskWritePayload, toTask } from '../../swsd/mappers/task.js';
import { resolveIncidentRef } from '../../utils/idResolver.js';
import { checkWriteMode } from '../shared/writeMode.js';
import type { ToolContext } from '../../config/toolRegistry.js';

export function registerUpdateTask(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_update_task',
    {
      description:
        'Update a SWSD incident sub-task. Pass incident_id (internal id or incident number), task_id, ' +
        'and name, assignee_email, due_at (ISO datetime), and/or is_complete. Only provided fields are sent. ' +
        'WRITE — honors SWSD_WRITE_MODE and does not retry on transient failure.',
      inputSchema: UpdateTaskInput,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: false },
    },
    async ({ incident_id, task_id, name, assignee_email, due_at, is_complete }) => {
      try {
        const payload = buildTaskWritePayload({ name, assignee_email, due_at, is_complete });
        const changed = Object.keys(payload.task);
        if (changed.length === 0) {
          return toolError('No fields to update — provide name, assignee_email, due_at, or is_complete.');
        }
        const { id: resolvedIncidentId } = await resolveIncidentRef(incident_id, ctx.client);
        const path = `/incidents/${String(resolvedIncidentId)}/tasks/${String(task_id)}.json`;
        const gated = checkWriteMode(ctx, {
          method: 'PUT',
          path,
          body: payload,
          action: `update task ${String(task_id)} on incident ${String(resolvedIncidentId)}`,
        });
        if (gated) return gated;
        const { body } = await ctx.client.put<unknown>(path, payload);
        const raw = body && typeof body === 'object' && 'task' in body ? body.task : body;
        const task = toTask(raw);
        if (!task) return toolError('Could not parse updated-task response from SWSD.');
        // Honor is_complete when supplied without changing the legacy state tool mapper.
        const complete = raw && typeof raw === 'object' && 'is_complete' in raw
          && typeof raw.is_complete === 'boolean' ? raw.is_complete : task.completed;
        return structuredResult(
          { task: { ...task, completed: complete, is_complete: complete }, changed_fields: changed },
          `Updated task ${String(task_id)} on incident ${String(resolvedIncidentId)} (${changed.join(', ')}).`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
