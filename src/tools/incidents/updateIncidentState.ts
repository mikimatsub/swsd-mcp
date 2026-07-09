import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { UpdateIncidentStateInput } from '../../schemas/incident.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { mapSwsdError } from '../../swsd/errors.js';
import {
  buildIncidentWritePayload,
  toIncidentDetail,
} from '../../swsd/mappers/incident.js';
import { resolveIncidentRef } from '../../utils/idResolver.js';
import { checkWriteMode } from '../shared/writeMode.js';
import type { ToolContext } from '../../config/toolRegistry.js';

export function registerUpdateIncidentState(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_update_incident_state',
    {
      description:
        'Transition an SWSD incident to a new state (e.g., "Assigned", "Resolved", "Closed"). ' +
        'Safer wrapper around swsd_update_incident — narrows the agent decision surface. State ' +
        'names are tenant-specific; common ones: "New - Unassigned", "Assigned", "In Progress", ' +
        '"Awaiting Input", "Resolved", "Closed". Call swsd_get_incident first to see the current state. ' +
        'WRITE — does not retry on transient failure.',
      inputSchema: UpdateIncidentStateInput.shape,
      annotations: { readOnlyHint: false, openWorldHint: true, idempotentHint: false },
    },
    async ({ id, state }) => {
      try {
        const { id: resolvedId } = await resolveIncidentRef(id, ctx.client);
        const payload = buildIncidentWritePayload({ state });
        const path = `/incidents/${String(resolvedId)}.json`;
        const gated = checkWriteMode(ctx, {
          method: 'PUT',
          path,
          body: payload,
          action: `set incident ${String(resolvedId)} state to ${state}`,
        });
        if (gated) return gated;
        const { body } = await ctx.client.put<unknown>(path, payload);
        const incident = toIncidentDetail(body);
        if (!incident) {
          return toolError('Could not parse state-transition response from SWSD.');
        }
        return structuredResult(
          { incident },
          `Incident ${String(resolvedId)} state → ${state}.`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
