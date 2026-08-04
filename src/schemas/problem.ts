import { z } from 'zod';
import {
  EmailInput,
  MAX_FILTER_ITEMS,
  MAX_LABEL_CHARS,
  MAX_LONG_TEXT_CHARS,
  MAX_QUERY_CHARS,
} from './limits.js';

export const ListProblemsInput = z.object({
  state: z
    .array(z.string().min(1).max(MAX_LABEL_CHARS))
    .max(MAX_FILTER_ITEMS)
    .optional()
    .describe('Filter to problems matching ANY of these states (e.g. ["New", "In Progress"]).'),
  state_is_not: z
    .array(z.string().min(1).max(MAX_LABEL_CHARS))
    .max(MAX_FILTER_ITEMS)
    .optional()
    .describe('Negative state filter: exclude problems in any of these states (e.g. ["Resolved", "Closed"]).'),
  priority: z
    .array(z.string().min(1).max(MAX_LABEL_CHARS))
    .max(MAX_FILTER_ITEMS)
    .optional()
    .describe('Filter to problems matching ANY of these priorities (e.g. ["High", "Medium"]).'),
  assignee_email: EmailInput
    .optional()
    .describe('Filter to problems assigned to this email.'),
  requester_email: EmailInput
    .optional()
    .describe('Filter to problems requested by this email.'),
  query: z
    .string()
    .min(1)
    .max(MAX_QUERY_CHARS)
    .optional()
    .describe('Free-text search on name + description.'),
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

export const GetProblemInput = z.object({
  id: z
    .number()
    .int()
    .positive()
    .describe(
      'SWSD problem reference. Accepts either the internal id (>=7 digits) or the human-facing number (<=6 digits). The handler auto-detects via digit count.',
    ),
  detail_level: z
    .enum(['short', 'long'])
    .default('short')
    .describe(
      'Use "long" for inline comments/audits/tasks/time_tracks. Default "short" is faster and cheaper.',
    ),
});

export const CreateProblemInput = z.object({
  name: z
    .string()
    .min(1)
    .max(200)
    .describe('Problem title (required).'),
  description: z
    .string()
    .max(MAX_LONG_TEXT_CHARS)
    .optional()
    .describe('Description (HTML or plain text).'),
  priority: z
    .string()
    .max(MAX_LABEL_CHARS)
    .optional()
    .describe('Priority name (e.g. High, Medium, Low). Tenant-specific values.'),
  category: z
    .string()
    .max(MAX_LABEL_CHARS)
    .optional()
    .describe('Category name (must match an existing SWSD category — see swsd_list_categories).'),
  subcategory: z
    .string()
    .max(MAX_LABEL_CHARS)
    .optional()
    .describe('Subcategory name (nested under category).'),
  assignee_email: EmailInput
    .optional()
    .describe('Email of the agent to assign the problem to.'),
  requester_email: EmailInput
    .optional()
    .describe('Email of the user the problem is for. Defaults to the token owner if omitted.'),
});

export type ListProblemsInputT = z.infer<typeof ListProblemsInput>;
export type GetProblemInputT = z.infer<typeof GetProblemInput>;
export type CreateProblemInputT = z.infer<typeof CreateProblemInput>;
