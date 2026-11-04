import type { McpServer } from '@modelcontextprotocol/server';
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { SlaRiskInput } from '../../schemas/slaRisk.js';
import { PaginationWithScopeOutput } from '../../schemas/output.js';
import { structuredResult } from '../../mcp/output.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { toIncidentDetail, toIncidentSummary } from '../../swsd/mappers/incident.js';
import type { IncidentSlaViolation } from '../../swsd/types.js';
import { computeSlaRisk, sortByRisk } from '../../swsd/mappers/slaRisk.js';
import { loadUiResource } from '../../mcp/uiResources.js';
import { applyDateAlias } from '../../utils/dateAliases.js';
import type { ToolContext } from '../../config/toolRegistry.js';

const UI_RESOURCE_URI = 'ui://swsd/sla-risk.html';

const SlaRiskIncidentOutput = z.object({
  id: z.number().int(),
  number: z.number().int().optional(),
  name: z.string(),
  state: z.string().optional(),
  priority: z.string().optional(),
  assignee_email: z.string().optional(),
  updated_at: z.string().optional(),
  url: z.string().optional(),
  due_at: z.string().optional(),
  minutes_to_breach: z.number().int().optional(),
  risk: z.enum(['breached', 'critical', 'warning', 'ok', 'no_due_date']),
  sla_violations: z.array(z.object({
    name: z.string().optional(),
    violation_type: z.string().optional(),
  })),
});

export function registerSlaRisk(server: McpServer, ctx: ToolContext): void {
  registerAppTool(
    server,
    'swsd_sla_risk',
    {
      description:
        'List open incidents ranked by SLA breach risk. Computes a risk level ' +
        'for each incident based on due_at and sla_violations: "breached" (overdue ' +
        'or has violations), "critical" (due within 4 hours), "warning" (due within ' +
        'at_risk_within_hours), "ok", or "no_due_date". Results are sorted with ' +
        'breached first (most overdue first), then by time-to-breach ascending, ' +
        'no_due_date last. Defaults to excluding Resolved and Closed states. ' +
        'Limitation: incident list rows only normally include due_at. The ' +
        'sla_violations[] array is only present on the long incident layout, so rows ' +
        'are ranked primarily by due_at and violations are counted only when SWSD ' +
        'happens to include them on the row. Use swsd_get_incident with ' +
        'detail_level long for a complete per-incident SLA picture.',
      inputSchema: SlaRiskInput,
      outputSchema: z.object({
        incidents: z.array(SlaRiskIncidentOutput),
        counts: z.record(z.string(), z.number().int()).describe('Count of incidents per risk level.'),
        now: z.string().describe('ISO timestamp used as the reference clock for risk computation.'),
        pagination: PaginationWithScopeOutput,
        applied_filters: z.record(z.string(), z.unknown()),
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

        const params: Record<string, unknown> = {
          page: input.page,
          per_page: input.per_page,
          sort_by: 'due_at',
          sort_order: 'ASC',
        };
        if (input.states) params.state = input.states;
        if (input.priorities) params.priority = input.priorities;
        if (input.assigned_to_group !== undefined) params.assigned_to = input.assigned_to_group;
        if (input.state_is_not) params.state_is_not = input.state_is_not;
        if (input.updated_from) params.updated_at = ['greater_than', input.updated_from];

        const { body, pagination } = await ctx.client.get<unknown>('/incidents.json', params);
        const raw = Array.isArray(body) ? body : [];
        const candidates = raw
          .map(toIncidentSummary)
          .filter((x): x is NonNullable<typeof x> => x !== null);

        const violationsById = new Map<number, IncidentSlaViolation[]>();
        for (const row of raw) {
          const detail = toIncidentDetail(row);
          if (detail?.sla_violations && detail.sla_violations.length > 0) {
            violationsById.set(detail.id, detail.sla_violations);
          }
        }

        const assigneeLower = input.assignee_email?.toLowerCase();
        const clientFilterApplied = assigneeLower !== undefined;
        const filtered = clientFilterApplied
          ? candidates.filter(
              (c) =>
                c.assignee_email !== undefined &&
                c.assignee_email.toLowerCase() === assigneeLower,
            )
          : candidates;

        const atRiskHours = input.at_risk_within_hours ?? 24;
        const includeNoDue = input.include_no_due_date ?? false;

        const withRisk = filtered.map((inc) => {
          // sla_violations[] is only present when SWSD includes it on the row
          // (long layout); reuse the detail mapper's normalization when it is.
          const risk = computeSlaRisk(inc.due_at, violationsById.get(inc.id) ?? [], atRiskHours, now);
          return { ...inc, ...risk };
        });

        const kept = includeNoDue
          ? withRisk
          : withRisk.filter((r) => r.risk !== 'no_due_date');

        const sorted = sortByRisk(kept);

        const capped =
          input.max_results !== undefined
            ? sorted.slice(0, input.max_results)
            : sorted;

        const counts: Record<string, number> = {};
        for (const item of capped) {
          counts[item.risk] = (counts[item.risk] ?? 0) + 1;
        }

        const applied_filters: Record<string, unknown> = {};
        if (input.states) applied_filters.states = input.states;
        if (input.state_is_not) applied_filters.state_is_not = input.state_is_not;
        if (input.priorities) applied_filters.priorities = input.priorities;
        if (input.assigned_to_group !== undefined) applied_filters.assigned_to_group = input.assigned_to_group;
        if (input.assignee_email) applied_filters.assignee_email = input.assignee_email;
        if (input.updated_from) applied_filters.updated_from = input.updated_from;
        if (input.at_risk_within_hours !== undefined) applied_filters.at_risk_within_hours = input.at_risk_within_hours;
        if (input.include_no_due_date) applied_filters.include_no_due_date = input.include_no_due_date;

        const hasAnyFilter = Object.keys(applied_filters).length > 0;
        const total_scope: 'filtered' | 'tenant' | 'unknown' =
          pagination.total === undefined
            ? 'unknown'
            : hasAnyFilter
              ? 'filtered'
              : 'tenant';

        const breachedCount = String(counts['breached'] ?? 0);
        const totalCount = String(capped.length);
        const summary =
          `SLA risk scan: ${totalCount} incidents (${breachedCount} breached, ` +
          `${String(counts['critical'] ?? 0)} critical, ${String(counts['warning'] ?? 0)} warning, ` +
          `${String(counts['ok'] ?? 0)} ok, ${String(counts['no_due_date'] ?? 0)} no due date) ` +
          `from ${String(candidates.length)} candidates on page ${String(pagination.page)}.`;

        return structuredResult(
          {
            incidents: capped.map((i) => ({
              id: i.id,
              number: i.number,
              name: i.name,
              state: i.state,
              priority: i.priority,
              assignee_email: i.assignee_email,
              updated_at: i.updated_at,
              url: i.url,
              due_at: i.due_at,
              minutes_to_breach: i.minutes_to_breach,
              risk: i.risk,
              sla_violations: i.sla_violations,
            })),
            counts,
            now: now.toISOString(),
            pagination: { ...pagination, total_scope },
            applied_filters,
            scan: {
              candidates_scanned: candidates.length,
              matches_in_page: capped.length,
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
    'swsd-sla-risk-ui',
    UI_RESOURCE_URI,
    { description: 'SLA risk dashboard rendered by Apps-capable hosts.' },
    () => ({
      contents: [
        {
          uri: UI_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: loadUiResource('sla-risk'),
        },
      ],
    }),
  );
}
