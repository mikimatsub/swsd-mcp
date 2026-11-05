import { z } from 'zod';
import {
  EmailInput,
  IsoDateOrDateTimeInput,
  MAX_FILTER_ITEMS,
  MAX_LABEL_CHARS,
  RelativeTimeAliasInput,
  RELATIVE_TIME_DESCRIPTION,
} from './limits.js';

export const SlaRiskInput = z.object({
  states: z
    .array(z.string().min(1).max(MAX_LABEL_CHARS))
    .max(MAX_FILTER_ITEMS)
    .optional()
    .describe('Filter to incidents matching ANY of these states.'),
  state_is_not: z
    .array(z.string().min(1).max(MAX_LABEL_CHARS))
    .max(MAX_FILTER_ITEMS)
    .default(['Resolved', 'Closed'])
    .describe('Negative state filter. Defaults to excluding Resolved and Closed.'),
  priorities: z
    .array(z.string().min(1).max(MAX_LABEL_CHARS))
    .max(MAX_FILTER_ITEMS)
    .optional()
    .describe('Filter to incidents matching ANY of these priorities.'),
  assigned_to_group: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Filter to incidents assigned to this group ID (server-side).'),
  assignee_email: EmailInput
    .optional()
    .describe('Client-side case-insensitive filter on assignee email (SWSD ignores it server-side).'),
  updated_within: RelativeTimeAliasInput
    .optional()
    .describe(RELATIVE_TIME_DESCRIPTION),
  updated_from: IsoDateOrDateTimeInput
    .optional()
    .describe('Filter to incidents updated on or after this ISO date or datetime.'),
  at_risk_within_hours: z
    .number()
    .int()
    .min(1)
    .max(720)
    .default(24)
    .describe('Hours threshold for "warning" risk bucket. Default 24, max 720 (30 days).'),
  include_no_due_date: z
    .boolean()
    .default(false)
    .describe('Include incidents with no due_at in results. Default false.'),
  per_page: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(25)
    .describe('Results per page (1-100). SWSD caps at 100.'),
  page: z
    .number()
    .int()
    .min(1)
    .max(10_000)
    .default(1)
    .describe('Page number (1-indexed).'),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe('Cap returned incidents while scanning up to 10 pages from page (also bounded by page 10000). Stops when enough matches are found; ranks the scanned matches only. scan.truncated reports omitted matches or remaining pages. Without this option, scans one page.'),
});

export type SlaRiskInput = z.infer<typeof SlaRiskInput>;
