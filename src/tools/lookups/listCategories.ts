import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ListLookupInput } from '../../schemas/lookup.js';
import { PaginationOutput } from '../../schemas/output.js';
import { structuredResult } from '../../mcp/output.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { toCategorySummary } from '../../swsd/mappers/lookup.js';
import { fetchAndMap } from '../../swsd/list-helper.js';
import type { ToolContext } from '../../config/toolRegistry.js';

const CategorySummaryOutput = z.object({
  id: z.number().int(),
  name: z.string(),
  parent_id: z.number().int().optional(),
  children: z
    .array(z.object({ id: z.number().int(), name: z.string() }))
    .optional(),
  default_assignee_id: z.number().int().optional(),
});

export function registerListCategories(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_list_categories',
    {
      description:
        'List SWSD incident/solution categories. Returns id, name, parent_id, immediate ' +
        'children, and default_assignee_id. Categories form a hierarchy (parent_id links). ' +
        'Use this to validate category_name before swsd_create_incident or swsd_update_incident.',
      inputSchema: ListLookupInput.shape,
      outputSchema: z.object({
        categories: z.array(CategorySummaryOutput),
        pagination: PaginationOutput,
      }).shape,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    },
    async (input) => {
      try {
        const params: Record<string, unknown> = { page: input.page, per_page: input.per_page };
        if (input.query) params.name = input.query;
        const { items, pagination } = await fetchAndMap(
          ctx.client,
          '/categories.json',
          toCategorySummary,
          params,
        );
        return structuredResult(
          { categories: items, pagination },
          `Returned ${String(items.length)} categories (page ${String(pagination.page)}${pagination.has_more ? ', more available' : ''}).`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
