import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { UpdateTaskStateInput } from '../../schemas/task.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { buildTaskWritePayload, toTask } from '../../swsd/mappers/task.js';
import { resolveIncidentRef } from '../../utils/idResolver.js';
import { checkWriteMode } from '../shared/writeMode.js';
import type { ToolContext } from '../../config/toolRegistry.js';

export function registerUpdateTaskState(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_update_task_state',
    {
      description:
        'Mark a SWSD incident sub-task as complete or incomplete. Pass `completed: true` ' +
        'to set the task to "Completed", or `completed: false` to revert to "New". For ' +
        'finer state control (e.g., "In Progress"), use the SWSD UI directly — this tool ' +
        'is the safer wrapper for the common done/not-done transition. ' +
        'WRITE — idempotent: re-applying the same value is a no-op on SWSD.',
      inputSchema: UpdateTaskStateInput.shape,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: true },
    },
    async ({ incident_id, task_id, completed }) => {
      try {
        const { id: resolvedIncidentId } = await resolveIncidentRef(incident_id, ctx.client);
        const state = completed ? 'Completed' : 'New';
        const payload = buildTaskWritePayload({ state });
        const path = `/incidents/${String(resolvedIncidentId)}/tasks/${String(task_id)}.json`;
        const gated = checkWriteMode(ctx, {
          method: 'PUT',
          path,
          body: payload,
          action: `set task ${String(task_id)} on incident ${String(resolvedIncidentId)} to ${state}`,
        });
        if (gated) return gated;
        const { body: respBody } = await ctx.client.put<unknown>(path, payload);
        const task = toTask(respBody);
        if (!task) {
          return toolError('Could not parse updated-task response from SWSD.');
        }
        return structuredResult(
          { task },
          `Task ${String(task_id)} on incident ${String(resolvedIncidentId)} → ${state}.`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
