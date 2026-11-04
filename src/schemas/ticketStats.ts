import { z } from 'zod';
import { IsoDateOrDateTimeInput } from './limits.js';

export const TicketStatsInput = z.object({
  from: IsoDateOrDateTimeInput.optional().describe('Inclusive window start. Date-only values mean UTC midnight. Defaults to seven days before to.'),
  to: IsoDateOrDateTimeInput.optional().describe('Exclusive window end. Date-only values mean UTC midnight. Defaults to now.'),
  assigned_to_group: z.number().int().positive().optional().describe('Server-side assignment group ID.'),
  max_pages: z.number().int().min(1).max(10).default(5).describe('Total page budget shared by the created and updated scans (1-10).'),
  per_page: z.number().int().min(1).max(100).default(25).describe('Results per page (1-100), matching swsd_sla_risk.'),
});
export type TicketStatsInput = z.infer<typeof TicketStatsInput>;

const Count = z.number().int().nonnegative();
export const TicketStatsOutput = z.strictObject({
  window: z.strictObject({ from: z.iso.datetime(), to: z.iso.datetime() }),
  totals: z.strictObject({
    total: Count,
    open: Count,
    resolved_in_window: Count,
    created_in_window: Count,
    breached: Count,
    unassigned: Count,
  }),
  by_state: z.array(z.strictObject({ state: z.string(), count: Count })),
  by_priority: z.array(z.strictObject({ priority: z.string(), count: Count })),
  by_assignee: z.array(z.strictObject({ email: z.string(), count: Count })).max(10),
  by_category: z.array(z.strictObject({ category: z.string(), count: Count })).max(10),
  median_resolution_hours: z.number().nonnegative().nullable(),
  scan: z.strictObject({ pages_scanned: Count.max(10), truncated: z.boolean() }),
});
export type TicketStatsOutput = z.infer<typeof TicketStatsOutput>;
