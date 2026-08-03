import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SearchSolutionsInput } from '../../schemas/solution.js';
import { PaginationOutput } from '../../schemas/output.js';
import { structuredResult } from '../../mcp/output.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { toSolutionSummary } from '../../swsd/mappers/solution.js';
import { fetchAndMap } from '../../swsd/list-helper.js';
import type { ToolContext } from '../../config/toolRegistry.js';

const SolutionSummaryOutput = z.object({
  id: z.number().int(),
  number: z.number().int().optional(),
  name: z.string(),
  state: z.string().optional(),
  category: z.string().optional(),
  excerpt: z.string().optional(),
  requester_email: z.string().optional(),
  updated_at: z.string().optional(),
  href: z
    .string()
    .optional()
    .describe('Relative API path to the solution (e.g. /solutions/1234.json).'),
});

export function registerSearchSolutions(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_search_solutions',
    {
      description:
        'Search SWSD knowledge-base solution articles. Pass `query` for free-text ' +
        'search across titles and descriptions; pass `category` to filter to a ' +
        'category name. Returns compact summaries with truncated excerpts (240 chars). ' +
        'Use swsd_get_solution for the full HTML body of any one result. ' +
        'NOTE: search is asynchronously indexed — articles created or updated in the ' +
        'last few minutes (sometimes hours) may not appear yet. To verify a just-created ' +
        'article, use swsd_get_solution with the ID returned by swsd_create_solution.',
      inputSchema: SearchSolutionsInput.shape,
      outputSchema: z.object({
        solutions: z.array(SolutionSummaryOutput),
        pagination: PaginationOutput,
      }).shape,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    },
    async (input) => {
      try {
        const params: Record<string, unknown> = { page: input.page, per_page: input.per_page };
        if (input.query) params.query = input.query;
        if (input.category) params.category = input.category;
        const { items, pagination } = await fetchAndMap(
          ctx.client,
          '/solutions.json',
          toSolutionSummary,
          params,
        );
        const filterNote = input.query ? ` matching "${input.query}"` : '';
        const summary = `Returned ${String(items.length)} solutions${filterNote} (page ${String(pagination.page)}${pagination.has_more ? ', more available' : ''}).`;
        return structuredResult({ solutions: items, pagination }, summary);
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
