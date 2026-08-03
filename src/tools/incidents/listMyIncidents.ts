import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { ListMyIncidentsInput } from '../../schemas/listMyIncidents.js';
import { PaginationWithScopeOutput } from '../../schemas/output.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { toIncidentSummary } from '../../swsd/mappers/incident.js';
import { decodeJwtPayload, getUserIdFromJwtClaims } from '../../swsd/jwt.js';
import { toUserMeRecord } from '../../swsd/mappers/me.js';
import { applyDateAlias } from '../../utils/dateAliases.js';
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
        'List incidents assigned to the authenticated user. Internally calls ' +
        'swsd_get_me to discover the user\'s email, then calls /incidents.json ' +
        'with the OTHER server-side filters applied (state, priority, etc.) and ' +
        'narrows the response client-side by assignee.email — because SWSD\'s ' +
        '/incidents.json endpoint silently ignores assignee_email / requester_email ' +
        'filters (verified 2026-05-08 against the live API: a fake email returns ' +
        'the entire tenant). The client-side filter is the only correct way to ' +
        'scope to a specific user. For broader queries use swsd_list_incidents ' +
        'with assigned_to=<group_id> (group filtering does work server-side).',
      inputSchema: ListMyIncidentsInput.shape,
      outputSchema: z.object({
        incidents: z.array(IncidentSummaryOutput),
        pagination: PaginationWithScopeOutput,
        applied_filters: z
          .record(z.string(), z.unknown())
          .describe(
            'Echo of the filters applied to this query — empty object if none. ' +
              'Use this to reason about whether the result count reflects your filters or the tenant total. ' +
              'NOTE: assignee_email is applied client-side (post-fetch) because SWSD ignores it server-side.',
          ),
        assignee_email: z
          .string()
          .describe('The authenticated user\'s email used as the assignee filter (applied client-side).'),
        scan: z
          .object({
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
      }).shape,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
      _meta: { ui: { resourceUri: UI_RESOURCE_URI } },
    },
    async (rawInput) => {
      try {
        // Translate `updated_within` (e.g. "7d", "24h") into a concrete
        // `updated_from` ISO date before doing anything else. Explicit
        // `updated_from` always wins; the alias is dropped after translation.
        const input = applyDateAlias(rawInput);

        // Step 1: Resolve the authenticated user's email via JWT + /users/{id}.
        const claims = decodeJwtPayload(ctx.token);
        if (claims === null) {
          return toolError('Could not decode SWSD JWT to identify the authenticated user.');
        }
        const userId = getUserIdFromJwtClaims(claims);
        if (userId === null) {
          return toolError('JWT payload missing user_id (or legacy user_ic). The token may be from an unsupported issuer.');
        }
        const usersResult = await ctx.client.get<unknown>(`/users/${String(userId)}.json`);
        const me = toUserMeRecord(usersResult.body);
        if (me === null || me.email === undefined) {
          return toolError(`Could not resolve email for user id ${String(userId)}.`);
        }

        // Step 2: Build /incidents.json query.
        // CRITICAL: do NOT send assignee_email — SWSD silently ignores it on
        // /incidents.json (verified live 2026-05-08: fake email returns the
        // full tenant). We narrow client-side after the response lands.
        // All OTHER filters (state, dates, category, etc.) DO work server-side
        // and are applied as before.
        const params: Record<string, unknown> = {
          page: input.page,
          per_page: input.per_page,
        };
        if (input.states) params.state = input.states;
        if (input.priorities) params.priority = input.priorities;
        if (input.categories) params.category = input.categories;
        if (input.requester_email) params.requester_email = input.requester_email;
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

        // Step 3: Client-side filter on assignee.email — the actual scoping.
        // Case-insensitive exact-match on the email; defensive against
        // mixed-case email storage variations across SWSD records.
        const meEmailLower = me.email.toLowerCase();
        const incidents = candidates.filter(
          (c) => c.assignee_email !== undefined && c.assignee_email.toLowerCase() === meEmailLower,
        );

        // Step 4: Echo the applied filters back. assignee_email is included
        // because the agent SHOULD reason about it as "applied" — even though
        // it was applied client-side, the user-facing semantics are the same:
        // the result is scoped to that email.
        const applied_filters: Record<string, unknown> = {
          assignee_email: me.email,
        };
        if (input.states) applied_filters.states = input.states;
        if (input.priorities) applied_filters.priorities = input.priorities;
        if (input.categories) applied_filters.categories = input.categories;
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

        // Step 5: Honest summary text. Includes:
        // - matches in this page,
        // - candidates scanned (server-side total before client filter),
        // - whether more candidate pages remain (caller can paginate),
        // - caveat when the user can't be assigned tickets at all
        //   (n.yarling-style admin: available_for_assignment=false).
        const cantBeAssigned = me.available_for_assignment === false;
        const totalNote =
          pagination.total !== undefined ? ` of ${String(pagination.total)} server-side` : '';
        const moreNote = pagination.has_more ? ', more candidate pages available' : '';
        // Caveat is informational, not corrective: a user with
        // available_for_assignment=false can still have legacy assignments
        // (their availability was set false AFTER tickets were assigned).
        // Surface the flag so the agent can explain "you have N existing
        // assignments but won't be auto-assigned new ones", and suggest the
        // group-scope fallback for users who hit 0 matches.
        const caveat = cantBeAssigned
          ? ' (NOTE: this user has available_for_assignment=false — they cannot be assigned NEW tickets, though existing assignments may still appear above. If looking for tickets in their broader scope, also try swsd_list_incidents with assigned_to=<group_id>.)'
          : '';
        const summary =
          `Found ${String(incidents.length)} ticket${incidents.length === 1 ? '' : 's'} ` +
          `assigned to you (${me.email}) ` +
          `from ${String(candidates.length)} candidate${candidates.length === 1 ? '' : 's'} ` +
          `scanned on page ${String(pagination.page)}${totalNote}${moreNote}.${caveat}`;

        const total_scope: 'filtered' | 'tenant' | 'unknown' =
          pagination.total === undefined ? 'unknown' : 'filtered';

        return structuredResult(
          {
            incidents,
            pagination: { ...pagination, total_scope },
            applied_filters,
            assignee_email: me.email,
            scan: {
              candidates_scanned: candidates.length,
              matches_in_page: incidents.length,
              unscanned_candidates_remain: pagination.has_more,
            },
          },
          summary,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
