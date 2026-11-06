import type { McpServer } from '@modelcontextprotocol/server';
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { ListIncidentsInput } from '../../schemas/incident.js';
import { PaginationWithScopeOutput } from '../../schemas/output.js';
import { structuredResult } from '../../mcp/output.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { loadUiResource } from '../../mcp/uiResources.js';
import { queryIncidents } from '../../utils/incidentQuery.js';
import type { ToolContext } from '../../config/toolRegistry.js';

const UI_RESOURCE_URI = 'ui://swsd/incident-list.html';

const IncidentSummaryOutput = z.object({
  id: z.number().int(),
  number: z.number().int().optional(),
  name: z.string(),
  state: z.string().optional(),
  priority: z.string().optional(),
  assignee_email: z.string().optional(),
  requester_email: z.string().optional(),
  category: z.string().optional(),
  updated_at: z.string().optional(),
  url: z
    .string()
    .optional()
    .describe('SWSD UI URL for this incident (from href_account_domain).'),
});

export function registerListIncidents(server: McpServer, ctx: ToolContext): void {
  registerAppTool(
    server,
    'swsd_list_incidents',
    {
      description:
        'List SWSD incidents with structured filters and pagination. Returns ' +
        'compact summaries (id, name, state, priority, assignee_email, requester_email, ' +
        'category, updated_at) — call swsd_get_incident for the full detail of any one row. ' +
        'Filters use SWSD repeated-key array semantics (multiple values within a filter are OR-ed). ' +
        'requester_email is resolved through the requester directory and filtered server-side with requested_by. ' +
        'Unknown requesters return zero matches; lookup failures are errors. assignee_email and exact updated_from ' +
        'time cutoffs are applied to the fetched page. Counts explicitly identify their scope.',
      inputSchema: ListIncidentsInput,
      outputSchema: z.object({
        incidents: z.array(IncidentSummaryOutput),
        pagination: PaginationWithScopeOutput,
        applied_filters: z
          .record(z.string(), z.unknown())
          .describe(
            'Echo of the filters applied to this query — empty object if none. ' +
              'Use this to reason about whether the result count reflects your filters or the tenant total. ' +
              'requester_email is filtered server-side; assignee_email and exact time cutoffs are page-local.',
          ),
        scan: z
          .object({
            candidates_scanned: z
              .number()
              .int()
              .describe('Server-side rows on this page before client-side party filtering.'),
            matches_in_page: z
              .number()
              .int()
              .describe('Rows that survived the client-side party filter (or candidates_scanned if no party filter was applied).'),
            unscanned_candidates_remain: z
              .boolean()
              .describe('True if more candidate pages exist server-side. Increase per_page or paginate to scan more.'),
            client_filter_applied: z
              .boolean()
              .describe('True when assignee_email or an exact updated_from time cutoff requires post-fetch narrowing.'),
          })
          .describe('Honest accounting of what was scanned vs matched.'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
      _meta: { ui: { resourceUri: UI_RESOURCE_URI } },
    },
    async (rawInput) => {
      try {
        const result = await queryIncidents(ctx.client, rawInput);
        const scope = result.pagination.total_scope;
        return structuredResult(result,
          `Returned ${result.incidents.length} incidents on page ${result.pagination.page}. ` +
          `Total: ${result.pagination.total ?? 'unknown'} (${scope}); ` +
          `matched total: ${result.pagination.matched_total ?? 'unknown'}.`);
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );

  registerAppResource(
    server,
    'swsd-incident-list-ui',
    UI_RESOURCE_URI,
    { description: 'Incident list view rendered by Apps-capable hosts.' },
    () => ({
      contents: [
        {
          uri: UI_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: loadUiResource('incident-list'),
        },
      ],
    }),
  );
}
