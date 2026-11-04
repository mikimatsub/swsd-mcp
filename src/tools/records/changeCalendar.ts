import type { McpServer } from '@modelcontextprotocol/server';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { ChangeCalendarInput, ChangeCalendarOutput, type CalendarItem } from '../../schemas/changeCalendar.js';
import type { ToolContext } from '../../config/toolRegistry.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { loadUiResource } from '../../mcp/uiResources.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { buildCalendar, calendarWindow, isUnscheduled, matchesCalendarFilters, toCalendarItem } from '../../swsd/mappers/changeCalendar.js';

const UI_RESOURCE_URI = 'ui://swsd/change-calendar.html';
const PATHS = { change: '/changes.json', release: '/releases.json' } as const;

export function registerChangeCalendar(server: McpServer, ctx: ToolContext): void {
  registerAppTool(server, 'swsd_change_calendar', {
    description: 'Show a UTC change/release calendar widget and shared-CI/group scheduling conflicts. ' +
      'Fetches up to max_pages per kind (default 3, maximum 10); ONLY page/per_page are sent to SWSD. ' +
      'All date, state, assignee, group and name-search filters are client-side, over scanned rows only. ' +
      'Defaults to today at UTC midnight through 30 days later. Windows use overlap, with an exclusive end; ' +
      'missing, invalid or non-positive planned ends use start + 1 hour. Rows without a valid planned start ' +
      'are excluded and counted as unscheduled. Conflicts cover only returned items, not the whole tenant. ' +
      'scan reports pages_fetched per kind, rows_scanned, unscheduled and truncated; when truncated is true, ' +
      'unscanned records may contain more matches or conflicts. No server-side search or date ordering is assumed.',
    inputSchema: ChangeCalendarInput,
    outputSchema: ChangeCalendarOutput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    _meta: { ui: { resourceUri: UI_RESOURCE_URI } },
  }, async (input) => {
    try {
      let window: { from: string; to: string };
      try {
        window = calendarWindow(input.from, input.to, new Date());
      } catch {
        return toolError('Calendar window must have a valid from strictly before to.');
      }
      const kinds = [...new Set(input.kinds)];
      const scan = { pages_fetched: { change: 0, release: 0 }, rows_scanned: 0, unscheduled: 0, truncated: false };
      const candidates: CalendarItem[] = [];
      for (const kind of kinds) {
        for (let page = 1; page <= input.max_pages; page++) {
          const { body, pagination } = await ctx.client.get<unknown>(PATHS[kind], { page, per_page: input.per_page });
          scan.pages_fetched[kind]++;
          const rows = Array.isArray(body) ? body : [];
          scan.rows_scanned += rows.length;
          for (const row of rows) {
            if (isUnscheduled(row, kind)) scan.unscheduled++;
            const item = toCalendarItem(row, kind);
            if (item && matchesCalendarFilters(item, input, window)) candidates.push(item);
          }
          if (!pagination.has_more) break;
          if (page === input.max_pages) scan.truncated = true;
        }
      }
      const calendar = buildCalendar(candidates);
      const { max_pages: _maxPages, per_page: _perPage, ...filters } = input;
      return structuredResult({
        ...calendar, window, scan, applied_filters: { ...filters, kinds, ...window },
      }, `Change calendar: ${String(calendar.items.length)} scheduled items, ${String(calendar.conflicts.length)} conflicts ` +
        `from ${String(scan.rows_scanned)} rows scanned; ${String(scan.unscheduled)} unscheduled.` +
        (scan.truncated ? ' Scan truncated: more records and conflicts may exist.' : ' All available pages scanned.'));
    } catch (err) {
      return mapSwsdError(err);
    }
  });
  registerAppResource(server, 'swsd-change-calendar-ui', UI_RESOURCE_URI,
    { description: 'UTC change and release calendar with scheduling conflicts.' },
    () => ({ contents: [{ uri: UI_RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: loadUiResource('change-calendar') }] }));
}
