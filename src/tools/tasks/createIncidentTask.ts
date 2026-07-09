import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CreateIncidentTaskInput } from '../../schemas/task.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { buildTaskWritePayload, toTask } from '../../swsd/mappers/task.js';
import { resolveIncidentRef } from '../../utils/idResolver.js';
import { checkWriteMode } from '../shared/writeMode.js';
import type { ToolContext } from '../../config/toolRegistry.js';

export function registerCreateIncidentTask(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_create_incident_task',
    {
      description:
        'Create a new sub-task on a SWSD incident. Required: `incident_id`, `name`. ' +
        'Optional: `description` (plain text or HTML), `due_at` (ISO 8601), ' +
        '`assignee_email`. The created task is returned for follow-up calls. ' +
        'WRITE — does not retry on transient failure.',
      inputSchema: CreateIncidentTaskInput.shape,
      annotations: { readOnlyHint: false, openWorldHint: true, idempotentHint: false },
    },
    async ({ incident_id, name, description, due_at, assignee_email }) => {
      try {
        const { id: resolvedIncidentId } = await resolveIncidentRef(incident_id, ctx.client);
        const payload = buildTaskWritePayload({
          name,
          description,
          due_at,
          assignee_email,
        });
        const path = `/incidents/${String(resolvedIncidentId)}/tasks.json`;
        const gated = checkWriteMode(ctx, {
          method: 'POST',
          path,
          body: payload,
          action: `create task on incident ${String(resolvedIncidentId)}`,
        });
        if (gated) return gated;
        const { body: respBody } = await ctx.client.post<unknown>(path, payload);
        const task = toTask(respBody);
        if (!task) {
          return toolError('Could not parse created-task response from SWSD.');
        }
        return structuredResult(
          { task },
          `Created task ${String(task.id)} on incident ${String(resolvedIncidentId)}: ${task.name || '(no name)'}`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
