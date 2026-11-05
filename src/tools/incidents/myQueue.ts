import type { McpServer } from '@modelcontextprotocol/server';
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { MyQueueInput } from '../../schemas/myQueue.js';
import { PaginationWithScopeOutput } from '../../schemas/output.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { requireListArray } from '../../swsd/list-helper.js';
import { withTotalScope } from '../../swsd/pagination.js';
import { toIncidentSummary } from '../../swsd/mappers/incident.js';
import { computeSlaRisk, type SlaRiskLevel } from '../../swsd/mappers/slaRisk.js';
import { resolveCurrentUser } from '../../utils/resolveCurrentUser.js';
import { applyDateAlias, passesUpdatedCutoff, planUpdatedFrom } from '../../utils/dateAliases.js';
import type { ToolContext } from '../../config/toolRegistry.js';

const UI_RESOURCE_URI = 'ui://swsd/incident-list.html';

const MyQueueIncidentOutput = z.object({
  id: z.number().int(),
  number: z.number().int().optional(),
  name: z.string(),
  state: z.string().optional(),
  priority: z.string().optional(),
  assignee_email: z.string().optional(),
  requester_email: z.string().optional(),
  category: z.string().optional(),
  updated_at: z.string().optional(),
  url: z.string().optional(),
  due_at: z.string().optional(),
  minutes_to_breach: z.number().int().optional(),
  risk: z.enum(['breached', 'critical', 'warning', 'ok', 'no_due_date']),
});

export function registerMyQueue(server: McpServer, ctx: ToolContext): void {
  registerAppTool(
    server,
    'swsd_my_queue',
    {
      description:
        'Work-queue view for the authenticated user (or a given assignee/group). ' +
        'Defaults to open incidents assigned to you, sorted by due_at ascending. ' +
        'Each row includes a computed SLA risk level for at-a-glance triage. ' +
        'Supports assignee_email override (client-side filter), assigned_to_group ' +
        '(server-side), states/priorities filters, and sort_by options.',
      inputSchema: MyQueueInput,
      outputSchema: z.object({
        incidents: z.array(MyQueueIncidentOutput),
        pagination: PaginationWithScopeOutput,
        applied_filters: z.record(z.string(), z.unknown()),
        assignee_email: z.string().optional()
          .describe('The email used as the assignee filter (resolved from JWT when not overridden).'),
        scan: z.object({
          candidates_scanned: z.number().int(),
          matches_in_page: z.number().int(),
          unscanned_candidates_remain: z.boolean(),
          client_filter_applied: z.boolean(),
        }),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
      _meta: { ui: { resourceUri: UI_RESOURCE_URI } },
    },
    async (rawInput) => {
      try {
        const input = applyDateAlias(rawInput);
        const now = new Date();

        let resolvedEmail: string | undefined;
        let useClientFilter = false;

        if (input.assignee_email) {
          resolvedEmail = input.assignee_email;
          useClientFilter = true;
        } else if (input.assigned_to_group === undefined) {
          const resolved = await resolveCurrentUser(ctx.token, ctx.client);
          if (!resolved.ok) {
            return toolError(resolved.message);
          }
          resolvedEmail = resolved.me.email;
          useClientFilter = true;
        }

        const params: Record<string, unknown> = {
          page: input.page,
          per_page: input.per_page,
        };
        if (input.states?.length) params.state = input.states;
        if (input.priorities?.length) params.priority = input.priorities;
        if (input.state_is_not?.length) params.state_is_not = input.state_is_not;
        const updatedPlan = planUpdatedFrom(input.updated_from);
        if (updatedPlan.upstream) params.updated_at = ['greater_than', updatedPlan.upstream];
        if (input.assigned_to_group !== undefined) params.assigned_to = input.assigned_to_group;

        const sortKey = input.sort_by ?? 'due_at';
        params.sort_by = sortKey;
        params.sort_order = 'ASC';

        const { body, pagination } = await ctx.client.get<unknown>('/incidents.json', params);
        const raw = requireListArray(body);
        const candidates = raw
          .map(toIncidentSummary)
          .filter((x): x is NonNullable<typeof x> => x !== null);

        const assigneeLower = useClientFilter && resolvedEmail
          ? resolvedEmail.toLowerCase()
          : undefined;
        const clientFilterApplied = assigneeLower !== undefined || updatedPlan.cutoffMs !== undefined;
        const filtered = clientFilterApplied
          ? candidates.filter(
              (c) =>
                (assigneeLower === undefined || (c.assignee_email !== undefined &&
                c.assignee_email.toLowerCase() === assigneeLower)) &&
                passesUpdatedCutoff(c.updated_at, updatedPlan.cutoffMs),
            )
          : candidates;

        const withRisk = filtered.map((inc) => {
          const risk = computeSlaRisk(inc.due_at, [], 24, now);
          return {
            ...inc,
            minutes_to_breach: risk.minutes_to_breach,
            risk: risk.risk,
          };
        });

        const applied_filters: Record<string, unknown> = {};
        if (resolvedEmail) applied_filters.assignee_email = resolvedEmail;
        if (input.assigned_to_group !== undefined) applied_filters.assigned_to_group = input.assigned_to_group;
        if (input.states?.length) applied_filters.states = input.states;
        if (input.state_is_not?.length) applied_filters.state_is_not = input.state_is_not;
        if (input.priorities?.length) applied_filters.priorities = input.priorities;
        if (input.updated_from) applied_filters.updated_from = input.updated_from;

        const hasAnyFilter = Object.keys(applied_filters).length > 0;

        const summary =
          `Queue: ${String(withRisk.length)} incident${withRisk.length === 1 ? '' : 's'} ` +
          `${resolvedEmail ? `for ${resolvedEmail} ` : ''}` +
          `from ${String(candidates.length)} candidate${candidates.length === 1 ? '' : 's'} ` +
          `on page ${String(pagination.page)}.`;

        return structuredResult(
          {
            incidents: withRisk.map((i) => ({
              id: i.id,
              number: i.number,
              name: i.name,
              state: i.state,
              priority: i.priority,
              assignee_email: i.assignee_email,
              requester_email: i.requester_email,
              category: i.category,
              updated_at: i.updated_at,
              url: i.url,
              due_at: i.due_at,
              minutes_to_breach: i.minutes_to_breach,
              risk: i.risk as SlaRiskLevel,
            })),
            pagination: withTotalScope(pagination, clientFilterApplied, hasAnyFilter, withRisk.length),
            applied_filters,
            assignee_email: resolvedEmail,
            scan: {
              candidates_scanned: candidates.length,
              matches_in_page: withRisk.length,
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
}
