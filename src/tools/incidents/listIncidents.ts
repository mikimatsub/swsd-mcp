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
import { requireListArray } from '../../swsd/list-helper.js';
import { withTotalScope } from '../../swsd/pagination.js';
import { toIncidentSummary } from '../../swsd/mappers/incident.js';
import { loadUiResource } from '../../mcp/uiResources.js';
import { applyDateAlias, passesUpdatedCutoff, planUpdatedFrom } from '../../utils/dateAliases.js';
import { resolveRequesterIds } from '../../utils/requesterResolver.js';
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
        'requester_email is resolved to SWSD requester ids and filtered SERVER-SIDE ' +
        '(requested_by), so results cover every page; if the email matches no requester it ' +
        'falls back to a client-side filter of the fetched page. assignee_email is applied ' +
        'CLIENT-SIDE because SWSD /incidents.json silently ignores it server-side (verified ' +
        '2026-05-08 against the live API). Other filters (state, category, dates, sites, ' +
        'departments, assigned_to_group, query) DO narrow server-side and are passed through.',
      inputSchema: ListIncidentsInput,
      outputSchema: z.object({
        incidents: z.array(IncidentSummaryOutput),
        pagination: PaginationWithScopeOutput,
        applied_filters: z
          .record(z.string(), z.unknown())
          .describe(
            'Echo of the filters applied to this query — empty object if none. ' +
              'Use this to reason about whether the result count reflects your filters or the tenant total. ' +
              'NOTE: assignee_email is applied client-side. requester_email is server-side when ' +
              'requester_ids is present, otherwise client-side. Everything else is server-side.',
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
              .describe(
                'True iff post-fetch narrowing was needed: assignee_email, an updated_from time cutoff, ' +
                  'or a requester_email that could not be resolved to a requester id.',
              ),
          })
          .describe('Honest accounting of what was scanned vs matched.'),
      }),
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
        // full tenant of 56,829 records). requester_email is instead resolved
        // to requester ids and sent as `requested_by` (see requesterResolver);
        // assignee_email is applied client-side after the response lands. All
        // OTHER filters DO narrow server-side and are passed through unchanged.
        const requesterIds = input.requester_email
          ? await resolveRequesterIds(ctx.client, input.requester_email)
          : undefined;
        const params: Record<string, unknown> = {
          page: input.page,
          per_page: input.per_page,
        };
        if (input.states?.length) params.state = input.states;
        if (input.priorities?.length) params.priority = input.priorities;
        if (input.categories?.length) params.category = input.categories;
        const updatedPlan = planUpdatedFrom(input.updated_from);
        if (updatedPlan.upstream) params.updated_at = ['greater_than', updatedPlan.upstream];
        if (input.updated_to) params.updated_to = input.updated_to;
        if (input.created_from) params.created_from = input.created_from;
        if (input.created_to) params.created_to = input.created_to;
        if (input.sites?.length) params.site = input.sites;
        if (input.departments?.length) params.department = input.departments;
        if (input.assigned_to_group !== undefined) params.assigned_to = input.assigned_to_group;
        if (input.state_is_not?.length) params.state_is_not = input.state_is_not;
        if (input.sort_by) params.sort_by = input.sort_by;
        if (input.sort_order) params.sort_order = input.sort_order;
        if (input.query) params.query = input.query;
        if (requesterIds) params.requested_by = requesterIds;

        const { body, pagination } = await ctx.client.get<unknown>('/incidents.json', params);
        const raw = requireListArray(body);
        const candidates = raw
          .map(toIncidentSummary)
          .filter((x): x is NonNullable<typeof x> => x !== null);

        // Client-side party filter — only when caller asked for it.
        // Case-insensitive exact-match on assignee.email / requester.email.
        // The requester check also runs when requested_by narrowed server-side:
        // it is a no-op then, but guards against SWSD ever ignoring the filter.
        const assigneeLower = input.assignee_email?.toLowerCase();
        const requesterLower = input.requester_email?.toLowerCase();
        const requesterServerSide = requesterIds !== undefined;
        const clientFilterApplied =
          assigneeLower !== undefined ||
          (requesterLower !== undefined && !requesterServerSide) ||
          updatedPlan.cutoffMs !== undefined;
        const incidents = clientFilterApplied || requesterServerSide
          ? candidates.filter((c) => {
              if (!passesUpdatedCutoff(c.updated_at, updatedPlan.cutoffMs)) return false;
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
        if (input.states?.length) applied_filters.states = input.states;
        if (input.priorities?.length) applied_filters.priorities = input.priorities;
        if (input.categories?.length) applied_filters.categories = input.categories;
        if (input.assignee_email) applied_filters.assignee_email = input.assignee_email;
        if (input.requester_email) applied_filters.requester_email = input.requester_email;
        if (requesterIds) applied_filters.requester_ids = requesterIds;
        if (input.updated_from) applied_filters.updated_from = input.updated_from;
        if (input.updated_to) applied_filters.updated_to = input.updated_to;
        if (input.created_from) applied_filters.created_from = input.created_from;
        if (input.created_to) applied_filters.created_to = input.created_to;
        if (input.sites?.length) applied_filters.sites = input.sites;
        if (input.departments?.length) applied_filters.departments = input.departments;
        if (input.assigned_to_group !== undefined) applied_filters.assigned_to_group = input.assigned_to_group;
        if (input.state_is_not?.length) applied_filters.state_is_not = input.state_is_not;
        if (input.query) applied_filters.query = input.query;

        const hasAnyFilter = Object.keys(applied_filters).length > 0;

        const filterDescription = hasAnyFilter
          ? `matching your filters (${Object.entries(applied_filters)
              .slice(0, 3)
              .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : String(v)}`)
              .join(', ')}${Object.keys(applied_filters).length > 3 ? ', ...' : ''})`
          : 'tenant-wide';
        const clientSideFields = [
          ...(assigneeLower !== undefined ? ['assignee_email'] : []),
          ...(requesterLower !== undefined && !requesterServerSide ? ['requester_email'] : []),
        ];
        const clientFilterNote = clientSideFields.length > 0
          ? ` (${clientSideFields.join('/')} applied client-side after fetch — SWSD ignores ${clientSideFields.length > 1 ? 'them' : 'it'} server-side)`
          : clientFilterApplied
            ? ' (updated_from cutoff applied client-side after fetch)'
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
            pagination: withTotalScope(pagination, clientFilterApplied, hasAnyFilter, incidents.length),
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
