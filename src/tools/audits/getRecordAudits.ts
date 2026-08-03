import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { GetRecordAuditsInput } from '../../schemas/audit.js';
import { PaginationOutput } from '../../schemas/output.js';
import { structuredResult } from '../../mcp/output.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { toAuditSummary } from '../../swsd/mappers/audit.js';
import { resolveIncidentRef, resolveSolutionRef } from '../../utils/idResolver.js';
import { loadUiResource } from '../../mcp/uiResources.js';
import type { ToolContext } from '../../config/toolRegistry.js';

const UI_RESOURCE_URI = 'ui://swsd/audit-timeline.html';

const AuditSummaryOutput = z.object({
  uuid: z
    .string()
    .describe(
      'Stable identifier for the audit row (SWSD assigns a UUID; no numeric id is exposed).',
    ),
  message: z
    .string()
    .describe('Human-readable change description, e.g. "State changed from New to On Hold".'),
  action: z
    .string()
    .optional()
    .describe('Action taken — typically "Update", "Create", or "Delete".'),
  created_at: z.string().optional(),
  user: z
    .string()
    .optional()
    .describe('The user who performed the action (display name; user_id is separate).'),
  user_id: z.number().int().optional(),
  note: z.string().optional().describe('Free-text note attached to the audit, often empty.'),
  source_type: z.string().optional(),
  source_id: z.number().int().optional(),
});

export function registerGetRecordAudits(server: McpServer, ctx: ToolContext): void {
  registerAppTool(
    server,
    'swsd_get_record_audits',
    {
      description:
        'List the audit log for a SWSD record. Each audit entry captures one ' +
        'change: action ("Update"/"Create"/"Delete"), message ("State changed ' +
        'from New to Assigned"), the user who performed it, and the timestamp. ' +
        'Use this to answer "who changed this ticket?" or "what happened since ' +
        "I last looked?\". Cheaper than swsd_get_incident with detail_level=long " +
        'when you only need the audit history. object_type accepts incidents, ' +
        'problems, changes, releases, solutions, hardwares, other_assets.',
      inputSchema: GetRecordAuditsInput.shape,
      outputSchema: z.object({
        audits: z.array(AuditSummaryOutput),
        pagination: PaginationOutput,
      }).shape,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
      _meta: { ui: { resourceUri: UI_RESOURCE_URI } },
    },
    async (input) => {
      try {
        // Per object_type, resolve number→id when the entity has a list API.
        // incidents and solutions both expose `?query=N` lookups via their
        // dedicated resolvers. Other object_types (problems, changes,
        // releases, hardwares, other_assets) have no equivalent — until v2.2
        // ships their list APIs they remain id-only and we pass `input.id`
        // through unchanged. The resolver short-circuits id-sized inputs
        // internally, so this branch costs zero I/O when the caller already
        // passes the internal id.
        let resolvedId = input.id;
        if (input.object_type === 'incidents') {
          resolvedId = (await resolveIncidentRef(input.id, ctx.client)).id;
        } else if (input.object_type === 'solutions') {
          resolvedId = (await resolveSolutionRef(input.id, ctx.client)).id;
        }

        const params: Record<string, unknown> = {
          page: input.page,
          per_page: input.per_page,
        };
        const path = `/${input.object_type}/${String(resolvedId)}/audits.json`;
        const { body, pagination } = await ctx.client.get<unknown>(path, params);
        const raw = Array.isArray(body) ? body : [];
        const audits = raw
          .map(toAuditSummary)
          .filter((a): a is NonNullable<typeof a> => a !== null);

        const totalNote =
          pagination.total !== undefined ? ` of ${String(pagination.total)}` : '';
        const moreNote = pagination.has_more ? ', more available' : '';
        const summary = `Returned ${String(audits.length)} audits${totalNote} for ${input.object_type}/${String(resolvedId)} (page ${String(pagination.page)}${moreNote}).`;
        return structuredResult({ audits, pagination }, summary);
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );

  registerAppResource(
    server,
    'swsd-audit-timeline-ui',
    UI_RESOURCE_URI,
    { description: 'Audit timeline view rendered by Apps-capable hosts.' },
    () => ({
      contents: [
        {
          uri: UI_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: loadUiResource('audit-timeline'),
        },
      ],
    }),
  );
}
