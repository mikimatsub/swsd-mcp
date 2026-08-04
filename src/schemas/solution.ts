import { z } from 'zod';
import { CustomFieldsArray } from './customFieldWrite.js';
import { MAX_LABEL_CHARS, MAX_LONG_TEXT_CHARS, MAX_QUERY_CHARS } from './limits.js';

export const SearchSolutionsInput = z.object({
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
    .describe('Results per page (1-100).'),
  query: z
    .string()
    .min(1)
    .max(MAX_QUERY_CHARS)
    .optional()
    .describe('Free-text search across solution titles and descriptions. Empirically the canonical search parameter for SWSD solutions (verified against tenant 2026-05-03).'),
  category: z
    .string()
    .max(MAX_LABEL_CHARS)
    .optional()
    .describe('Filter to solutions in this category name. Use swsd_list_categories to validate names.'),
});

export const GetSolutionInput = z.object({
  id: z
    .number()
    .int()
    .positive()
    .describe(
      'SWSD solution reference. Accepts either the internal id (>=7 digits) or the human-facing number (<=4 digits). The handler auto-detects via digit count.',
    ),
  detail_level: z
    .enum(['short', 'long'])
    .default('short')
    .describe(
      'Use "long" to include attachments, audits, tags, and full statistics ' +
        'in one call. Default "short" is faster.',
    ),
});

export const CreateSolutionInput = z.object({
  name: z
    .string()
    .min(1)
    .max(255)
    .describe('Solution title (required).'),
  description: z
    .string()
    .max(MAX_LONG_TEXT_CHARS)
    .optional()
    .describe('Solution body. Plain text or HTML. SWSD auto-derives a description_no_html version for plain-text consumers.'),
  state: z
    .string()
    .max(MAX_LABEL_CHARS)
    .optional()
    .describe('Visibility state. Common tenant values: "Internal" (agents only), "Published" (visible in service catalog), "Draft". Tenant-specific.'),
  category_name: z
    .string()
    .max(MAX_LABEL_CHARS)
    .optional()
    .describe('Category name (see swsd_list_categories — solution and incident categories share the same backing in SWSD).'),
  custom_fields: CustomFieldsArray,
});

export const UpdateSolutionInput = z.object({
  id: z
    .number()
    .int()
    .positive()
    .describe(
      'SWSD solution reference. Accepts either the internal id (>=7 digits) or the human-facing number (<=4 digits). The handler auto-detects via digit count.',
    ),
  name: z.string().min(1).max(255).optional().describe('New title.'),
  description: z.string().max(MAX_LONG_TEXT_CHARS).optional().describe('New body (replaces existing).'),
  state: z.string().max(MAX_LABEL_CHARS).optional().describe('New visibility state.'),
  category_name: z.string().max(MAX_LABEL_CHARS).optional().describe('New category name.'),
  custom_fields: CustomFieldsArray,
});

export type SearchSolutionsInput = z.infer<typeof SearchSolutionsInput>;
export type GetSolutionInput = z.infer<typeof GetSolutionInput>;
export type CreateSolutionInput = z.infer<typeof CreateSolutionInput>;
export type UpdateSolutionInput = z.infer<typeof UpdateSolutionInput>;
