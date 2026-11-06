import type { McpServer } from '@modelcontextprotocol/server';
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { ListMyIncidentsInput } from '../../schemas/listMyIncidents.js';
import { PaginationWithScopeOutput } from '../../schemas/output.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { resolveCurrentUser } from '../../utils/resolveCurrentUser.js';
import { queryIncidents } from '../../utils/incidentQuery.js';
import type { ToolContext } from '../../config/toolRegistry.js';

// Reuse the incident-list widget already registered (as a resource) by
// registerListIncidents. Pointing this tool's _meta.ui.resourceUri at the
// SAME URI lets Apps-capable hosts render the same widget for "my tickets"
// queries — without a duplicate registerAppResource call (which would
// startup-conflict on the resource name).
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

export function registerListMyIncidents(server: McpServer, ctx: ToolContext): void {
  registerAppTool(
    server,
    'swsd_list_my_incidents',
    {
      description:
        'List incidents for the authenticated user. role=assignee (default) filters the fetched page by assignee; ' +
        'role=requester resolves your requester ID and filters all pages server-side. ' +
        'For group scope use swsd_list_incidents with assigned_to_group=<group_id>. Lookup failures are errors, and totals identify whether they count filtered matches or upstream candidates.',
      inputSchema: ListMyIncidentsInput,
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
        role: z.enum(['assignee', 'requester']),
        requester_email: z.string().optional(),
        assignee_email: z
          .string().optional()
          .describe('The authenticated user\'s email used as the assignee filter (applied client-side).'),
        scan: z
          .object({
            client_filter_applied: z.boolean().describe('True when assignee or exact time filtering is applied after fetch.'),
            candidates_scanned: z
              .number()
              .int()
              .describe('Server-side rows scanned on this page before client filtering.'),
            matches_in_page: z
              .number()
              .int()
              .describe('Rows that survived the client-side assignee filter.'),
            unscanned_candidates_remain: z
              .boolean()
              .describe('True if more candidate pages exist server-side. Increase per_page or paginate to scan more.'),
          })
          .describe('Honest accounting of the client-side filter: what was scanned vs matched.'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
      _meta: { ui: { resourceUri: UI_RESOURCE_URI } },
    },
    async (rawInput) => {
      try {
        const resolved = await resolveCurrentUser(ctx.token, ctx.client);
        if (!resolved.ok) return toolError(resolved.message);
        const { role = 'assignee', ...input } = rawInput;
        const me = resolved.me;
        if (role === 'requester' && input.requester_email && input.requester_email.toLowerCase() !== me.email.toLowerCase()) {
          return toolError('role=requester always means the authenticated user. Use swsd_list_incidents for another requester.');
        }
        const result = await queryIncidents(ctx.client, {
          ...input,
          ...(role === 'requester' ? { requester_email: me.email } : { assignee_email: me.email }),
        });
        const caveat = role === 'assignee' && me.available_for_assignment === false
          ? ' This user has available_for_assignment=false; existing assignments may still appear. For group scope, use swsd_list_incidents with assigned_to_group=<group_id>.' : '';
        return structuredResult({ ...result, role,
          ...(role === 'requester' ? { requester_email: me.email } : { assignee_email: me.email }),
        }, `Found ${result.incidents.length} tickets ${role === 'requester' ? 'requested by' : 'assigned to'} you (${me.email}) ` +
          `on page ${result.pagination.page}. Total: ${result.pagination.total ?? 'unknown'} (${result.pagination.total_scope}).${caveat}`);
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
