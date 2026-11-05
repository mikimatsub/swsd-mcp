import { z } from 'zod';
import { EmailInput, IsoDateOrDateTimeInput, MAX_FILTER_ITEMS, MAX_LABEL_CHARS, MAX_QUERY_CHARS } from './limits.js';

const Kind = z.enum(['change', 'release']);

export const ChangeCalendarInput = z.object({
  kinds: z.array(Kind).min(1).max(2).default(['change', 'release'])
    .describe('Record kinds to scan; duplicates are ignored.'),
  from: IsoDateOrDateTimeInput.optional().describe('Inclusive window start: ISO date (UTC midnight) or datetime with timezone. Defaults to today at UTC midnight.'),
  to: IsoDateOrDateTimeInput.optional().describe('Exclusive window end: ISO date (UTC midnight) or datetime with timezone. Defaults to 30 days after from.'),
  states: z.array(z.string().min(1).max(MAX_LABEL_CHARS)).max(MAX_FILTER_ITEMS).optional().describe('Client-side state inclusion (case-insensitive).'),
  state_is_not: z.array(z.string().min(1).max(MAX_LABEL_CHARS)).max(MAX_FILTER_ITEMS).optional().describe('Client-side state exclusion (case-insensitive).'),
  assignee_email: EmailInput.optional().describe('Client-side assignee email equality (case-insensitive).'),
  group_assignee_id: z.number().int().positive().optional().describe('Client-side group ID equality.'),
  query: z.string().max(MAX_QUERY_CHARS).optional().describe('Client-side case-insensitive substring search on name only.'),
  max_pages: z.number().int().min(1).max(10).default(3).describe('Maximum pages fetched per kind; the calendar may be incomplete.'),
  per_page: z.number().int().min(1).max(100).default(100),
});
export type ChangeCalendarInput = z.infer<typeof ChangeCalendarInput>;

const NamedId = z.object({ id: z.number().int(), name: z.string() });
export const CalendarItemOutput = z.object({
  kind: Kind,
  id: z.number().int(),
  number: z.number().int().optional(),
  name: z.string(),
  state: z.string().optional(),
  priority: z.string().optional(),
  planned_start_at: z.string(),
  planned_end_at: z.string().optional(),
  assignee_email: z.string().optional(),
  assignee_name: z.string().optional(),
  group_assignee: NamedId.optional(),
  configuration_items: z.array(NamedId),
  url: z.string().optional(),
  conflict_count: z.number().int().nonnegative(),
});
export type CalendarItem = z.infer<typeof CalendarItemOutput>;
const ItemRef = z.object({ kind: Kind, id: z.number().int() });
const CalendarConflictOutput = z.object({
  a: ItemRef,
  b: ItemRef,
  reasons: z.array(z.string()),
  overlap_start: z.string(),
  overlap_end: z.string(),
});
export type CalendarConflict = z.infer<typeof CalendarConflictOutput>;
export const ChangeCalendarOutput = z.object({
  items: z.array(CalendarItemOutput),
  conflicts: z.array(CalendarConflictOutput).max(200).describe('At most 200 conflict details between returned items.'),
  conflict_count: z.number().int().nonnegative().describe('Total conflicting pairs between returned items, including omitted details.'),
  conflicts_truncated: z.boolean().describe('True when some conflict details are omitted; aggregate and per-item counts remain complete for returned items.'),
  days: z.array(z.object({ date: z.string(), items: z.array(CalendarItemOutput) })),
  window: z.object({ from: z.string(), to: z.string() }),
  scan: z.object({
    pages_fetched: z.object({ change: z.number().int(), release: z.number().int() }),
    rows_scanned: z.number().int(),
    unscheduled: z.number().int(),
    truncated: z.boolean(),
  }),
  applied_filters: z.record(z.string(), z.unknown()),
});
export type ChangeCalendarOutput = z.infer<typeof ChangeCalendarOutput>;
