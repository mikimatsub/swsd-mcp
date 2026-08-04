import { z } from 'zod';
import { CustomFieldsArray } from './customFieldWrite.js';
import {
  EmailInput,
  IsoDateOrDateTimeInput,
  MAX_FILTER_ITEMS,
  MAX_LABEL_CHARS,
  MAX_LONG_TEXT_CHARS,
  MAX_QUERY_CHARS,
  RelativeTimeAliasInput,
} from './limits.js';

export const ListIncidentsInput = z.object({
  page: z
    .number()
    .int()
    .min(1)
    .max(10_000)
    .default(1)
    .describe('Page number (1-indexed).'),
  per_page: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(25)
    .describe('Results per page (1-100). SWSD caps at 100.'),
  states: z
    .array(z.string().min(1).max(MAX_LABEL_CHARS))
    .max(MAX_FILTER_ITEMS)
    .optional()
    .describe('Filter to incidents matching ANY of these states (e.g. ["New", "Assigned"]).'),
  priorities: z
    .array(z.string().min(1).max(MAX_LABEL_CHARS))
    .max(MAX_FILTER_ITEMS)
    .optional()
    .describe('Filter to incidents matching ANY of these priorities (e.g. ["High", "Medium"]).'),
  categories: z
    .array(z.string().min(1).max(MAX_LABEL_CHARS))
    .max(MAX_FILTER_ITEMS)
    .optional()
    .describe('Filter to incidents matching ANY of these category names.'),
  assignee_email: EmailInput
    .optional()
    .describe('Filter to incidents assigned to this email.'),
  requester_email: EmailInput
    .optional()
    .describe('Filter to incidents requested by this email.'),
  updated_from: IsoDateOrDateTimeInput
    .optional()
    .describe('Filter to incidents updated on or after this ISO date or datetime (YYYY-MM-DD or RFC 3339).'),
  updated_within: RelativeTimeAliasInput
    .optional()
    .describe(
      'Convenience alias for updated_from. Accepts "Nh" (hours), "Nd" (days), or "Nw" (weeks). ' +
        'Examples: "24h", "7d", "1w", "30d". Ignored if updated_from is explicitly set.',
    ),
  updated_to: IsoDateOrDateTimeInput
    .optional()
    .describe('Filter to incidents updated on or before this ISO date or datetime. Pair with updated_from for an explicit range.'),
  created_from: IsoDateOrDateTimeInput
    .optional()
    .describe('Filter to incidents created on or after this ISO date or datetime (YYYY-MM-DD or RFC 3339).'),
  created_to: IsoDateOrDateTimeInput
    .optional()
    .describe('Filter to incidents created on or before this ISO date or datetime.'),
  sites: z
    .array(z.string().min(1).max(MAX_LABEL_CHARS))
    .max(MAX_FILTER_ITEMS)
    .optional()
    .describe('Filter to incidents at any of these site names (use swsd_list_sites to discover).'),
  departments: z
    .array(z.string().min(1).max(MAX_LABEL_CHARS))
    .max(MAX_FILTER_ITEMS)
    .optional()
    .describe('Filter to incidents in any of these department names.'),
  assigned_to_group: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Filter to incidents assigned to this group ID. Use swsd_list_groups to find the ID. NOTE: this is GROUP id, not user id.'),
  state_is_not: z
    .array(z.string().min(1).max(MAX_LABEL_CHARS))
    .max(MAX_FILTER_ITEMS)
    .optional()
    .describe('Negative state filter: exclude incidents in any of these states (e.g. ["Resolved", "Closed"] to see only open work).'),
  sort_by: z
    .enum(['created_at', 'updated_at', 'priority', 'name', 'due_at'])
    .optional()
    .describe('Sort key. Default is SWSD-side (typically updated_at desc).'),
  sort_order: z
    .enum(['ASC', 'DESC'])
    .optional()
    .describe('Sort direction. Use uppercase per SWSD convention.'),
  query: z
    .string()
    .min(1)
    .max(MAX_QUERY_CHARS)
    .optional()
    .describe('Free-text search across incident title and description. Same async-indexing caveat as solution search — just-created tickets may not appear for a few minutes.'),
});

export const GetIncidentInput = z.object({
  id: z
    .number()
    .int()
    .positive()
    .describe(
      'SWSD incident reference. Accepts either the internal id (>=7 digits, e.g. 180457930) or the human-facing number (<=6 digits, e.g. 60310). The handler auto-detects via digit count.',
    ),
  detail_level: z
    .enum(['short', 'long'])
    .default('short')
    .describe(
      'Use "long" to include comments, attachments, audits, SLA data, tags, ' +
        'statistics, satisfaction, and resolution detail in one call. Default ' +
        '"short" is faster and cheaper. Recommend "long" when the user asks ' +
        '"show me everything about ticket X" or wants comments/attachments/audits.',
    ),
});

export const CreateIncidentInput = z.object({
  name: z
    .string()
    .min(1)
    .max(200)
    .describe('Short incident title (required).'),
  description: z
    .string()
    .max(MAX_LONG_TEXT_CHARS)
    .optional()
    .describe('Long-form description of the issue. Plain text or HTML.'),
  priority: z
    .string()
    .max(MAX_LABEL_CHARS)
    .optional()
    .describe('Priority name (e.g., "Low", "Medium", "High"). Tenant-specific values.'),
  requester_email: EmailInput
    .optional()
    .describe('Email of the user the ticket is for. Defaults to the token owner if omitted.'),
  assignee_email: EmailInput
    .optional()
    .describe('Email of the agent to assign on creation. Use swsd_assign_incident later instead if you want to defer.'),
  category_name: z
    .string()
    .max(MAX_LABEL_CHARS)
    .optional()
    .describe('Category name (must match an existing SWSD category — see swsd_list_categories).'),
  site_name: z
    .string()
    .max(MAX_LABEL_CHARS)
    .optional()
    .describe('Site name (see swsd_list_sites).'),
  department_name: z
    .string()
    .max(MAX_LABEL_CHARS)
    .optional()
    .describe('Department name (see swsd_list_departments).'),
  custom_fields: CustomFieldsArray,
});

export const UpdateIncidentInput = z.object({
  id: z
    .number()
    .int()
    .positive()
    .describe(
      'SWSD incident reference. Accepts either the internal id (>=7 digits, e.g. 180457930) or the human-facing number (<=6 digits, e.g. 60310). The handler auto-detects via digit count.',
    ),
  name: z.string().min(1).max(200).optional().describe('New short title.'),
  description: z.string().max(MAX_LONG_TEXT_CHARS).optional().describe('New description (replaces existing).'),
  priority: z.string().max(MAX_LABEL_CHARS).optional().describe('New priority name.'),
  category_name: z.string().max(MAX_LABEL_CHARS).optional().describe('New category name.'),
  site_name: z.string().max(MAX_LABEL_CHARS).optional().describe('New site name.'),
  department_name: z.string().max(MAX_LABEL_CHARS).optional().describe('New department name.'),
  custom_fields: CustomFieldsArray,
});

export const LinkSolutionToIncidentInput = z.object({
  incident_id: z
    .number()
    .int()
    .positive()
    .describe(
      'SWSD incident reference. Accepts either the internal id (>=7 digits, e.g. 180457930) or the human-facing number (<=6 digits, e.g. 60310). The handler auto-detects via digit count.',
    ),
  solution_id: z
    .number()
    .int()
    .positive()
    .describe(
      'SWSD solution reference. Accepts either the internal id (>=7 digits) ' +
        'or the human-facing number (<=4 digits). Use swsd_search_solutions to find one. ' +
        'The handler auto-detects via digit count.',
    ),
});

export const AssignIncidentInput = z.object({
  id: z
    .number()
    .int()
    .positive()
    .describe(
      'SWSD incident reference. Accepts either the internal id (>=7 digits, e.g. 180457930) or the human-facing number (<=6 digits, e.g. 60310). The handler auto-detects via digit count.',
    ),
  assignee_email: EmailInput
    .describe('Email of the agent to assign. Must be an SWSD user with available_for_assignment=true.'),
});

export const UpdateIncidentStateInput = z.object({
  id: z
    .number()
    .int()
    .positive()
    .describe(
      'SWSD incident reference. Accepts either the internal id (>=7 digits, e.g. 180457930) or the human-facing number (<=6 digits, e.g. 60310). The handler auto-detects via digit count.',
    ),
  state: z
    .string()
    .min(1)
    .max(MAX_LABEL_CHARS)
    .describe('New state name. Must match a valid SWSD state for this tenant — common values: "New - Unassigned", "Assigned", "In Progress", "Awaiting Input", "Resolved", "Closed". Use swsd_get_incident to see the current state.'),
});

export type ListIncidentsInput = z.infer<typeof ListIncidentsInput>;
export type GetIncidentInput = z.infer<typeof GetIncidentInput>;
export type CreateIncidentInput = z.infer<typeof CreateIncidentInput>;
export type UpdateIncidentInput = z.infer<typeof UpdateIncidentInput>;
export type AssignIncidentInput = z.infer<typeof AssignIncidentInput>;
export type UpdateIncidentStateInput = z.infer<typeof UpdateIncidentStateInput>;
export type LinkSolutionToIncidentInput = z.infer<typeof LinkSolutionToIncidentInput>;
