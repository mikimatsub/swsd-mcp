import { z } from 'zod';

/**
 * Pagination block emitted on every list-shaped tool response.
 * Mirrors the runtime shape returned by extractPagination().
 */
export const PaginationOutput = z.object({
  page: z.number().int().describe('Current page (1-indexed).'),
  per_page: z.number().int().describe('Items per page used in the request.'),
  total: z
    .number()
    .int()
    .optional()
    .describe('Total record count when SWSD returns X-Total-Count.'),
  has_more: z.boolean().describe('True when more pages exist beyond this one.'),
  next_page: z
    .number()
    .int()
    .optional()
    .describe('The next page number to request, when has_more is true.'),
});

/**
 * total_scope discriminator on pagination blocks.
 * - "upstream" — total counts candidates before local filtering.
 * - "filtered" — total reflects server-side filters with no local filtering.
 * - "tenant"   — no filters applied AND SWSD returned X-Total-Count, so
 *   the total is the tenant-wide count.
 * - "unknown"  — SWSD did not return X-Total-Count.
 */
export const TotalScope = z.enum(['filtered', 'tenant', 'unknown', 'upstream']);

/**
 * Extended pagination output that includes total_scope.
 * Used on list tools where filter-vs-tenant total disambiguation matters.
 */
export const PaginationWithScopeOutput = PaginationOutput.extend({
  total_scope: TotalScope.describe(
    "Scope of the upstream `total`: 'upstream' = candidates before local filtering; " +
      "'filtered' = server-filtered count with no local filtering; 'tenant' = unfiltered count; 'unknown' = total absent. Sorting and display options are not filters.",
  ),
  matched_total: z.number().int().nonnegative().nullable().optional().describe(
    'Total matching records, or null when unknown. After local filtering, known only when all candidate pages were scanned from page 1. Independent of display caps.',
  ),
});
