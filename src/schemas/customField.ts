import { z } from 'zod';
import { MAX_LABEL_CHARS } from './limits.js';

export const DescribeCustomFieldsInput = z.object({
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
  scope: z
    .string()
    .max(MAX_LABEL_CHARS)
    .optional()
    .describe(
      'Filter to fields with this scope (e.g. "Global", "Service_Catalog", "Incident"). Tenant-specific.',
    ),
  module: z
    .string()
    .max(MAX_LABEL_CHARS)
    .optional()
    .describe('Filter to fields scoped to this module (when set on the field).'),
  active_only: z
    .boolean()
    .default(true)
    .describe(
      'If true (default), only return active fields. Set false to include retired/inactive fields too.',
    ),
});

export type DescribeCustomFieldsInput = z.infer<typeof DescribeCustomFieldsInput>;
