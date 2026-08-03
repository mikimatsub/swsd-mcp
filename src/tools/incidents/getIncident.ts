import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { GetIncidentInput } from '../../schemas/incident.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { toIncidentDetail } from '../../swsd/mappers/incident.js';
import { loadUiResource } from '../../mcp/uiResources.js';
import { resolveIncidentRef } from '../../utils/idResolver.js';
import type { ToolContext } from '../../config/toolRegistry.js';

const UI_RESOURCE_URI = 'ui://swsd/incident-detail.html';

export function registerGetIncident(server: McpServer, ctx: ToolContext): void {
  registerAppTool(
    server,
    'swsd_get_incident',
    {
      description:
        'Fetch one SWSD incident by numeric ID. Returns the full incident detail ' +
        'as returned by SWSD (passthrough), including custom_fields_values when present. ' +
        'Use swsd_list_incidents first if you only have a name or filter — IDs are not guessable.' +
        ' Pass detail_level: "long" to include comments, attachments, audits, SLA data, and resolution in one call.',
      inputSchema: GetIncidentInput.shape,
      outputSchema: z.object({
        incident: z.record(z.string(), z.unknown()),
      }).shape,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
      _meta: { ui: { resourceUri: UI_RESOURCE_URI } },
    },
    async (input) => {
      try {
        const { id: resolvedId } = await resolveIncidentRef(input.id, ctx.client);
        const params = input.detail_level === 'long' ? { layout: 'long' } : {};
        const { body } = await ctx.client.get<unknown>(
          `/incidents/${String(resolvedId)}.json`,
          params,
        );
        const incident = toIncidentDetail(body);
        if (!incident) {
          return toolError(
            `Could not parse incident ${String(resolvedId)} response from SWSD.`,
            'The response was not a JSON object with a numeric id field. Verify the incident exists with swsd_list_incidents.',
          );
        }
        const name = typeof incident.name === 'string' ? `: ${incident.name}` : '';
        const summary = `Incident ${String(incident.id)}${name}`;
        return structuredResult({ incident }, summary);
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );

  registerAppResource(
    server,
    'swsd-incident-detail-ui',
    UI_RESOURCE_URI,
    { description: 'Incident detail view rendered by Apps-capable hosts.' },
    () => ({
      contents: [
        {
          uri: UI_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: loadUiResource('incident-detail'),
        },
      ],
    }),
  );
}
