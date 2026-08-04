import { z } from 'zod';
import { MAX_LABEL_CHARS, MAX_QUERY_CHARS } from './limits.js';

const PAGE = z
  .number()
  .int()
  .min(1)
  .max(10_000)
  .default(1)
  .describe('Page number (1-indexed).');

const PER_PAGE = z
  .number()
  .int()
  .min(1)
  .max(100)
  .default(25)
  .describe('Results per page (1-100). SWSD caps at 100.');

export const ListCatalogItemsInput = z.object({
  page: PAGE,
  per_page: PER_PAGE,
  /** Filter by state (e.g. "Approved" — Approved is the production set). */
  state: z
    .string()
    .max(MAX_LABEL_CHARS)
    .optional()
    .describe('Filter by state ("Approved", "Internal", or "Draft").'),
  /** Filter by department name (substring match, server-side). */
  department: z.string().max(MAX_LABEL_CHARS).optional().describe('Filter by department name.'),
  /** Filter by site name. */
  site: z.string().max(MAX_LABEL_CHARS).optional().describe('Filter by site name.'),
  /** Free-text search across catalog item names + descriptions (server-side via the standard `name` query param). */
  query: z
    .string()
    .max(MAX_QUERY_CHARS)
    .optional()
    .describe(
      'Free-text search across catalog item names + descriptions (maps to the SWSD `name` query param).',
    ),
});

export const GetCatalogItemInput = z.object({
  id: z
    .number()
    .int()
    .positive()
    .describe('Catalog item id from swsd_list_catalog_items.'),
});
