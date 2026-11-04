import { z } from 'zod';
import {
  EmailInput,
  IsoDateOrDateTimeInput,
  MAX_FILTER_ITEMS,
  MAX_LABEL_CHARS,
  RelativeTimeAliasInput,
} from './limits.js';

export const MyQueueInput = z.object({
  assignee_email: EmailInput
    .optional()
    .describe(
      'Override the default (authenticated user) with a specific assignee email. ' +
        'Applied client-side because SWSD ignores it server-side.',
    ),
  assigned_to_group: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Filter to incidents assigned to this group ID (server-side). When set without assignee_email, defaults to group mode instead of "my" mode.'),
  states: z
    .array(z.string().min(1).max(MAX_LABEL_CHARS))
    .max(MAX_FILTER_ITEMS)
    .optional()
    .describe('Filter to incidents matching ANY of these states.'),
  state_is_not: z
    .array(z.string().min(1).max(MAX_LABEL_CHARS))
    .max(MAX_FILTER_ITEMS)
    .default(['Resolved', 'Closed'])
    .describe('Negative state filter. Defaults to excluding Resolved and Closed (open work only).'),
  priorities: z
    .array(z.string().min(1).max(MAX_LABEL_CHARS))
    .max(MAX_FILTER_ITEMS)
    .optional()
    .describe('Filter to incidents matching ANY of these priorities.'),
  updated_within: RelativeTimeAliasInput
    .optional()
    .describe('Convenience alias for updated_from. Accepts "Nh", "Nd", or "Nw".'),
  updated_from: IsoDateOrDateTimeInput
    .optional()
    .describe('Filter to incidents updated on or after this ISO date or datetime.'),
  sort_by: z
    .enum(['due_at', 'updated_at', 'priority', 'created_at'])
    .default('due_at')
    .describe('Sort key. Default due_at ASC.'),
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
});

export type MyQueueInput = z.infer<typeof MyQueueInput>;
