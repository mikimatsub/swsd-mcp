import type { McpServer } from '@modelcontextprotocol/server';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { TicketStatsInput, TicketStatsOutput } from '../../schemas/ticketStats.js';
import { IsoDateOrDateTimeInput } from '../../schemas/limits.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { toIncidentDetail, toIncidentSummary } from '../../swsd/mappers/incident.js';
import { computeSlaRisk } from '../../swsd/mappers/slaRisk.js';
import { loadUiResource } from '../../mcp/uiResources.js';
import type { ToolContext } from '../../config/toolRegistry.js';

const UI_RESOURCE_URI = 'ui://swsd/ticket-stats.html';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function timestamp(value: unknown): number {
  return IsoDateOrDateTimeInput.safeParse(value).success ? Date.parse(value as string) : NaN;
}

function increment(counts: Map<string, number>, label: string): void {
  counts.set(label, (counts.get(label) ?? 0) + 1);
}

function ranked(counts: Map<string, number>): Array<[string, number]> {
  return [...counts].sort(([a, x], [b, y]) => y - x || a.localeCompare(b, 'en'));
}

function hasIndividualAssignee(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const assignee = value as Record<string, unknown>;
  if (assignee.is_user === false || assignee.is_user === 'false') return false;
  return (typeof assignee.id === 'number' && assignee.id > 0) ||
    (typeof assignee.id === 'string' && /^\d+$/.test(assignee.id) && Number(assignee.id) > 0) ||
    (typeof assignee.email === 'string' && assignee.email.trim().length > 0) ||
    (typeof assignee.name === 'string' && assignee.name.trim().length > 0);
}

export function registerTicketStats(server: McpServer, ctx: ToolContext): void {
  registerAppTool(server, 'swsd_ticket_stats', {
    description: 'Summarize scanned tickets created OR last updated in [from, to), defaulting to the last seven days. ' +
      'Alternates created and updated incident-list queries, deduplicates IDs, and shares max_pages across both scans. ' +
      'Totals and breakdowns cover only scanned matching rows, not the tenant backlog or a historical state snapshot. ' +
      'Open excludes Resolved/Closed; unassigned means no individual assignee. Breached uses computeSlaRisk on open tickets at scan time, ' +
      'using due_at and any returned sla_violations (list rows may omit violations). ' +
      'Resolution counts and median elapsed hours use valid resolved_at timestamps in the window only; ' +
      'rows without resolved_at are excluded, never approximated with updated_at. The list API may omit resolved_at, so resolution metrics may be incomplete. ' +
      'An older ticket resolved during the window but last updated afterward can also be absent from these date-filtered scans. ' +
      'Median is null if no valid nonnegative created_at-to-resolved_at durations exist. Assignee/category breakdowns return the top ten.',
    inputSchema: TicketStatsInput,
    outputSchema: TicketStatsOutput,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    _meta: { ui: { resourceUri: UI_RESOURCE_URI } },
  }, async (rawInput) => {
    try {
      const parsed = TicketStatsInput.safeParse(rawInput);
      if (!parsed.success) return toolError('Invalid ticket stats input: ' + parsed.error.message);
      const input = parsed.data;
      const now = new Date();
      const toMs = input.to ? timestamp(input.to) : now.getTime();
      const fromMs = input.from ? timestamp(input.from) : toMs - WEEK_MS;
      if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
        return toolError('Ticket stats window must have a valid from strictly before to.');
      }
      const window = { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() };
      const inWindow = (ms: number): boolean => ms >= fromMs && ms < toMs;
      // Separate queries preserve OR semantics: combining the date filters would
      // incorrectly exclude older incidents updated/resolved during this window.
      // Query keys follow listIncidents.ts and https://apidoc.samanage.com/.
      const scans: Array<{ page: number; params: Record<string, unknown> }> = [
        { page: 1, params: { created_from: window.from, created_to: window.to } },
        { page: 1, params: { updated_at: ['greater_than', window.from], updated_to: window.to } },
      ];
      const scan = { pages_scanned: 0, truncated: false };
      const candidates = new Map<number, NonNullable<ReturnType<typeof toIncidentDetail>>>();
      while (scans.length > 0 && scan.pages_scanned < input.max_pages) {
        const current = scans.shift()!;
        const params: Record<string, unknown> = { ...current.params, page: current.page, per_page: input.per_page };
        if (input.assigned_to_group !== undefined) params.assigned_to = input.assigned_to_group;
        const { body, pagination } = await ctx.client.get<unknown>('/incidents.json', params);
        scan.pages_scanned++;
        if (!Array.isArray(body)) return toolError('Unexpected SWSD incident list response: expected an array.');
        for (const row of body) {
          const detail = toIncidentDetail(row);
          if (!detail || !Number.isSafeInteger(detail.id) || detail.id <= 0) continue;
          const previous = candidates.get(detail.id);
          if (!previous || !(timestamp(previous.updated_at) > timestamp(detail.updated_at))) {
            candidates.set(detail.id, detail);
          }
        }
        if (pagination.has_more) {
          current.page = pagination.next_page && pagination.next_page > current.page
            ? pagination.next_page : current.page + 1;
          scans.push(current);
        }
      }
      scan.truncated = scans.length > 0;
      const totals = { total: 0, open: 0, resolved_in_window: 0, created_in_window: 0, breached: 0, unassigned: 0 };
      const states = new Map<string, number>();
      const priorities = new Map<string, number>();
      const assignees = new Map<string, number>();
      const categories = new Map<string, number>();
      const resolutionHours: number[] = [];
      for (const detail of candidates.values()) {
        const created = timestamp(detail.created_at);
        if (!inWindow(created) && !inWindow(timestamp(detail.updated_at))) continue;
        const summary = toIncidentSummary(detail)!;
        totals.total++;
        const state = summary.state?.trim() || 'Unknown';
        const open = !['resolved', 'closed'].includes(state.toLowerCase());
        if (open) {
          totals.open++;
          if (computeSlaRisk(summary.due_at, detail.sla_violations ?? [], 24, now).risk === 'breached') totals.breached++;
        }
        if (inWindow(created)) totals.created_in_window++;
        if (!hasIndividualAssignee(detail.assignee)) totals.unassigned++;
        // resolved_at is documented by SolarWinds' Power BI connector field
        // reference (2026-11-04); it is optional on REST list rows. Missing
        // timestamps stay missing; updated_at is never a resolution proxy.
        // https://documentation.solarwinds.com/en/success_center/swsd/content/completeguidetoswsd/powerbi.htm
        const resolved = timestamp(detail.resolved_at);
        if (inWindow(resolved)) {
          totals.resolved_in_window++;
          if (Number.isFinite(created) && resolved >= created) resolutionHours.push((resolved - created) / 3_600_000);
        }
        increment(states, state);
        increment(priorities, summary.priority?.trim() || 'Unknown');
        const email = summary.assignee_email?.trim().toLowerCase();
        if (email && hasIndividualAssignee(detail.assignee)) increment(assignees, email);
        increment(categories, summary.category?.trim() || 'Uncategorized');
      }
      resolutionHours.sort((a, b) => a - b);
      const middle = Math.floor(resolutionHours.length / 2);
      const median = resolutionHours.length === 0 ? null : resolutionHours.length % 2
        ? resolutionHours[middle]!
        : (resolutionHours[middle - 1]! + resolutionHours[middle]!) / 2;
      const result: TicketStatsOutput = {
        window, totals,
        by_state: ranked(states).map(([state, count]) => ({ state, count })),
        by_priority: ranked(priorities).map(([priority, count]) => ({ priority, count })),
        by_assignee: ranked(assignees).slice(0, 10).map(([email, count]) => ({ email, count })),
        by_category: ranked(categories).slice(0, 10).map(([category, count]) => ({ category, count })),
        median_resolution_hours: median,
        scan,
      };
      return structuredResult(result,
        'Ticket stats: ' + String(totals.total) + ' scanned tickets, ' + String(totals.open) + ' open, ' +
        String(totals.breached) + ' breached; ' + String(scan.pages_scanned) + ' pages scanned.' +
        (scan.truncated ? ' Partial scan: more tickets may exist.' : '') +
        ' Resolution metrics include only rows supplying resolved_at; missing timestamps are excluded.');
    } catch (err) {
      return mapSwsdError(err);
    }
  });
  registerAppResource(server, 'swsd-ticket-stats-ui', UI_RESOURCE_URI,
    { description: 'Ticket stats summary rendered by Apps-capable hosts.' },
    () => ({ contents: [{ uri: UI_RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: loadUiResource('ticket-stats') }] }));
}
