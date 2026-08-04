import { z } from 'zod';
import { EmailInput, MAX_QUERY_CHARS } from './limits.js';

const PaginationFields = {
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
};

export const ListLookupInput = z.object({
  ...PaginationFields,
  query: z
    .string()
    .max(MAX_QUERY_CHARS)
    .optional()
    .describe('Optional name substring filter.'),
});

export const ListUsersInput = z.object({
  ...PaginationFields,
  query: z
    .string()
    .max(MAX_QUERY_CHARS)
    .optional()
    .describe('Optional name or email substring filter.'),
  email: EmailInput
    .optional()
    .describe('Filter to a specific email exactly.'),
  available_for_assignment_only: z
    .boolean()
    .default(false)
    .describe('If true, only return users who can be assigned tickets.'),
});

export type ListLookupInput = z.infer<typeof ListLookupInput>;
export type ListUsersInput = z.infer<typeof ListUsersInput>;
