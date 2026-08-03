import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
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
import { toIncidentSummary } from '../../swsd/mappers/incident.js';
import { loadUiResource } from '../../mcp/uiResources.js';
import { applyDateAlias } from '../../utils/dateAliases.js';
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
        'NOTE: assignee_email and requester_email are applied CLIENT-SIDE because SWSD ' +
        '/incidents.json silently ignores them server-side (verified 2026-05-08 against the ' +
        'live API). Other filters (state, category, dates, sites, departments, assigned_to_group, ' +
        'query) DO narrow server-side and are passed through.',
      inputSchema: ListIncidentsInput.shape,
      outputSchema: z.object({
        incidents: z.array(IncidentSummaryOutput),
        pagination: PaginationWithScopeOutput,
        applied_filters: z
          .record(z.string(), z.unknown())
          .describe(
            'Echo of the filters applied to this query — empty object if none. ' +
              'Use this to reason about whether the result count reflects your filters or the tenant total. ' +
              'NOTE: assignee_email / requester_email are applied client-side; everything else is server-side.',
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
              .describe('True iff assignee_email and/or requester_email triggered post-fetch narrowing.'),
          })
          .describe('Honest accounting of what was scanned vs matched.'),
      }).shape,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
      _meta: { ui: { resourceUri: UI_RESOURCE_URI } },
    },
    async (rawInput) => {
      try {
        // Translate `updated_within` (e.g. "7d", "24h") into a concrete
        // `updated_from` ISO date before assembling params. Explicit
        // `updated_from` always wins; the alias is dropped after translation.
        const input = applyDateAlias(rawInput);

        // Build server-side params. CRITICAL: do NOT send assignee_email or
        // requester_email — SWSD silently ignores those filters on
        // /incidents.json (verified live 2026-05-08: a fake email returns the
        // full tenant of 56,829 records). They are applied client-side after
        // the response lands. All OTHER filters DO narrow server-side and are
        // passed through unchanged.
        const params: Record<string, unknown> = {
          page: input.page,
          per_page: input.per_page,
        };
        if (input.states) params.state = input.states;
        if (input.priorities) params.priority = input.priorities;
        if (input.categories) params.category = input.categories;
        if (input.updated_from) params.updated_at = ['greater_than', input.updated_from];
        if (input.updated_to) params.updated_to = input.updated_to;
        if (input.created_from) params.created_from = input.created_from;
        if (input.created_to) params.created_to = input.created_to;
        if (input.sites) params.site = input.sites;
        if (input.departments) params.department = input.departments;
        if (input.assigned_to_group !== undefined) params.assigned_to = input.assigned_to_group;
        if (input.state_is_not) params.state_is_not = input.state_is_not;
        if (input.sort_by) params.sort_by = input.sort_by;
        if (input.sort_order) params.sort_order = input.sort_order;
        if (input.query) params.query = input.query;

        const { body, pagination } = await ctx.client.get<unknown>('/incidents.json', params);
        const raw = Array.isArray(body) ? body : [];
        const candidates = raw
          .map(toIncidentSummary)
          .filter((x): x is NonNullable<typeof x> => x !== null);

        // Client-side party filter — only when caller asked for it.
        // Case-insensitive exact-match on assignee.email / requester.email.
        const assigneeLower = input.assignee_email?.toLowerCase();
        const requesterLower = input.requester_email?.toLowerCase();
        const clientFilterApplied =
          assigneeLower !== undefined || requesterLower !== undefined;
        const incidents = clientFilterApplied
          ? candidates.filter((c) => {
              if (
                assigneeLower !== undefined &&
                (c.assignee_email === undefined ||
                  c.assignee_email.toLowerCase() !== assigneeLower)
              ) {
                return false;
              }
              if (
                requesterLower !== undefined &&
                (c.requester_email === undefined ||
                  c.requester_email.toLowerCase() !== requesterLower)
              ) {
                return false;
              }
              return true;
            })
          : candidates;

        // Echo applied filters honestly. Both server-side and client-side
        // filters are surfaced — the agent's downstream reasoning treats
        // them identically (both narrowed the result), but the client_filter
        // section makes the SOURCE of the narrowing inspectable.
        const applied_filters: Record<string, unknown> = {};
        if (input.states) applied_filters.states = input.states;
        if (input.priorities) applied_filters.priorities = input.priorities;
        if (input.categories) applied_filters.categories = input.categories;
        if (input.assignee_email) applied_filters.assignee_email = input.assignee_email;
        if (input.requester_email) applied_filters.requester_email = input.requester_email;
        if (input.updated_from) applied_filters.updated_from = input.updated_from;
        if (input.updated_to) applied_filters.updated_to = input.updated_to;
        if (input.created_from) applied_filters.created_from = input.created_from;
        if (input.created_to) applied_filters.created_to = input.created_to;
        if (input.sites) applied_filters.sites = input.sites;
        if (input.departments) applied_filters.departments = input.departments;
        if (input.assigned_to_group !== undefined) applied_filters.assigned_to_group = input.assigned_to_group;
        if (input.state_is_not) applied_filters.state_is_not = input.state_is_not;
        if (input.sort_by) applied_filters.sort_by = input.sort_by;
        if (input.sort_order) applied_filters.sort_order = input.sort_order;
        if (input.query) applied_filters.query = input.query;

        const hasAnyFilter = Object.keys(applied_filters).length > 0;
        // total_scope: the server-side X-Total-Count reflects pre-client-filter
        // candidates, not the final match count. So when a client filter was
        // applied, total is the candidate pool, not the actual matches —
        // marked 'filtered' in either case because some narrowing happened
        // somewhere; consumers should use scan.matches_in_page for actual count.
        const total_scope: 'filtered' | 'tenant' | 'unknown' =
          pagination.total === undefined
            ? 'unknown'
            : hasAnyFilter
              ? 'filtered'
              : 'tenant';

        const filterDescription = hasAnyFilter
          ? `matching your filters (${Object.entries(applied_filters)
              .slice(0, 3)
              .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : String(v)}`)
              .join(', ')}${Object.keys(applied_filters).length > 3 ? ', ...' : ''})`
          : 'tenant-wide';
        const clientFilterNote = clientFilterApplied
          ? ` (assignee_email/requester_email applied client-side after fetch — SWSD ignores them server-side)`
          : '';
        const matchesCount = String(incidents.length);
        const candidatesCount = String(candidates.length);
        const totalNote =
          pagination.total !== undefined ? ` of ${String(pagination.total)} server-side` : '';
        const moreNote = pagination.has_more ? ', more available' : '';
        const summary = clientFilterApplied
          ? `Returned ${matchesCount} matches from ${candidatesCount} ${filterDescription} candidates (page ${String(pagination.page)}${totalNote}${moreNote})${clientFilterNote}.`
          : `Returned ${candidatesCount}${totalNote} ${filterDescription} incidents (page ${String(pagination.page)}${moreNote}).`;

        return structuredResult(
          {
            incidents,
            pagination: { ...pagination, total_scope },
            applied_filters,
            scan: {
              candidates_scanned: candidates.length,
              matches_in_page: incidents.length,
              unscanned_candidates_remain: pagination.has_more,
              client_filter_applied: clientFilterApplied,
            },
          },
          summary,
        );
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
