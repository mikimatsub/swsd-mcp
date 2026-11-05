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
import { requireListArray } from '../../swsd/list-helper.js';
import { withTotalScope, type PaginationMeta } from '../../swsd/pagination.js';
import { toIncidentDetail, toIncidentSummary } from '../../swsd/mappers/incident.js';
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
          pages_scanned: z.number().int(),
          truncated: z.boolean().describe('True when candidate pages remain or max_results omitted scanned matches.'),
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
        if (input.states?.length) params.state = input.states;
        if (input.priorities?.length) params.priority = input.priorities;
        if (input.assigned_to_group !== undefined) params.assigned_to = input.assigned_to_group;
        if (input.state_is_not?.length) params.state_is_not = input.state_is_not;
        if (input.updated_from) params.updated_at = ['greater_than', input.updated_from];

        const assigneeLower = input.assignee_email?.toLowerCase();
        const atRiskHours = input.at_risk_within_hours ?? 24;
        const includeNoDue = input.include_no_due_date ?? false;
        const clientFilterApplied = assigneeLower !== undefined || !includeNoDue;
        const kept: Array<NonNullable<ReturnType<typeof toIncidentSummary>> & ReturnType<typeof computeSlaRisk>> = [];
        const seen = new Set<number>();
        let pagination: PaginationMeta;
        let page = input.page;
        let pagesScanned = 0;
        let candidatesScanned = 0;
        do {
          const response = await ctx.client.get<unknown>('/incidents.json', { ...params, page });
          pagination = response.pagination;
          const raw = requireListArray(response.body);
          pagesScanned++;
          candidatesScanned += raw.length;
          for (const row of raw) {
            const inc = toIncidentSummary(row);
            if (!inc || seen.has(inc.id)) continue;
            seen.add(inc.id);
            if (assigneeLower !== undefined && inc.assignee_email?.toLowerCase() !== assigneeLower) continue;
            const detail = toIncidentDetail(row);
            const risk = computeSlaRisk(inc.due_at, detail?.sla_violations ?? [], atRiskHours, now);
            if (includeNoDue || risk.risk !== 'no_due_date') kept.push({ ...inc, ...risk });
          }
          page++;
        } while (input.max_results !== undefined && kept.length < input.max_results
          && pagination.has_more && pagesScanned < 10 && page <= 10_000);

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
        if (input.states?.length) applied_filters.states = input.states;
        if (input.state_is_not?.length) applied_filters.state_is_not = input.state_is_not;
        if (input.priorities?.length) applied_filters.priorities = input.priorities;
        if (input.assigned_to_group !== undefined) applied_filters.assigned_to_group = input.assigned_to_group;
        if (input.assignee_email) applied_filters.assignee_email = input.assignee_email;
        if (input.updated_from) applied_filters.updated_from = input.updated_from;

        const hasAnyFilter = Object.keys(applied_filters).length > 0;
        const truncated = pagination.has_more || capped.length < kept.length;

        const breachedCount = String(counts['breached'] ?? 0);
        const totalCount = String(capped.length);
        const summary =
          `SLA risk scan: ${totalCount} incidents (${breachedCount} breached, ` +
          `${String(counts['critical'] ?? 0)} critical, ${String(counts['warning'] ?? 0)} warning, ` +
          `${String(counts['ok'] ?? 0)} ok, ${String(counts['no_due_date'] ?? 0)} no due date) ` +
          `from ${String(candidatesScanned)} candidates across ${String(pagesScanned)} page(s)` +
          `${truncated ? ' (truncated)' : ''}.`;

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
            pagination: withTotalScope(pagination, clientFilterApplied, hasAnyFilter, kept.length,
              input.page === 1 && !pagination.has_more),
            applied_filters,
            scan: {
              candidates_scanned: candidatesScanned,
              matches_in_page: capped.length,
              unscanned_candidates_remain: pagination.has_more,
              client_filter_applied: clientFilterApplied,
              pages_scanned: pagesScanned,
              truncated,
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
