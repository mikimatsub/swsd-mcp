import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CreateIncidentInput } from '../../schemas/incident.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { mapSwsdError } from '../../swsd/errors.js';
import {
  buildIncidentWritePayload,
  toIncidentDetail,
} from '../../swsd/mappers/incident.js';
import { checkWriteMode } from '../shared/writeMode.js';
import type { ToolContext } from '../../config/toolRegistry.js';

export function registerCreateIncident(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_create_incident',
    {
      description:
        'Create a new SWSD incident. Required: `name`. Strongly recommended: `description`, ' +
        '`requester_email`, `priority`, `category_name`. The created incident\'s ID is returned ' +
        'for follow-up calls (swsd_assign_incident, swsd_add_incident_comment, etc.). ' +
        'WRITE — does not retry on transient failure; the agent should verify with swsd_get_incident before retrying.' +
        ' To set tenant-specific custom field values, pass `custom_fields: [{name, value}]` — call swsd_describe_custom_fields first to discover field names and (for Dropdowns) allowed values. Validated for Text, Dropdown, Number, Checkbox, and Date types.',
      inputSchema: CreateIncidentInput.shape,
      annotations: { readOnlyHint: false, openWorldHint: true, idempotentHint: false },
    },
    async (input) => {
      try {
        const payload = buildIncidentWritePayload(input);
        const path = '/incidents.json';
        const gated = checkWriteMode(ctx, {
          method: 'POST',
          path,
          body: payload,
          action: 'create incident',
        });
        if (gated) return gated;
        const { body } = await ctx.client.post<unknown>(path, payload);
        const incident = toIncidentDetail(body);
        if (!incident) {
          return toolError('Could not parse created-incident response from SWSD.');
        }
        const name = typeof incident.name === 'string' ? incident.name : '(no name)';
        return structuredResult(
          { incident },
          `Created incident ${String(incident.id)}: ${name}`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
