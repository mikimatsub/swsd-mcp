import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ListCatalogItemsInput } from '../../schemas/catalogItem.js';
import { PaginationWithScopeOutput } from '../../schemas/output.js';
import { structuredResult } from '../../mcp/output.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { toCatalogItemSummary } from '../../swsd/mappers/catalogItem.js';
import type { ToolContext } from '../../config/toolRegistry.js';

const CatalogItemSummaryOutput = z.object({
  id: z.number().int(),
  name: z.string(),
  state: z.string().optional(),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  department: z.string().optional(),
  site: z.string().optional(),
  request_count: z.number().int().optional(),
  updated_at: z.string().optional(),
  variable_count: z.number().int().optional(),
});

export function registerListCatalogItems(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_list_catalog_items',
    {
      description:
        'List catalog items available in SolarWinds Service Desk. Each item ' +
        'represents an offerable service request template (e.g., "New Employee ' +
        'Onboarding", "Software Request") with a defined set of input variables ' +
        '(form fields). Use swsd_get_catalog_item to inspect a single item\'s ' +
        'variables, then swsd_create_service_request to submit a request.',
      inputSchema: ListCatalogItemsInput.shape,
      outputSchema: z.object({
        items: z.array(CatalogItemSummaryOutput),
        pagination: PaginationWithScopeOutput,
        applied_filters: z
          .record(z.string(), z.unknown())
          .describe(
            'Echo of the filters applied to this query — empty object if none. Use this to reason about whether the result count reflects your filters or the tenant total.',
          ),
      }).shape,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    },
    async (input) => {
      try {
        const params: Record<string, unknown> = {
          page: input.page,
          per_page: input.per_page,
        };
        const applied_filters: Record<string, unknown> = {};
        if (input.state) {
          params.state = input.state;
          applied_filters.state = input.state;
        }
        if (input.department) {
          params.department = input.department;
          applied_filters.department = input.department;
        }
        if (input.site) {
          params.site = input.site;
          applied_filters.site = input.site;
        }
        if (input.query) {
          params.name = input.query;
          applied_filters.query = input.query;
        }

        const { body, pagination } = await ctx.client.get<unknown>(
          '/catalog_items.json',
          params,
        );
        const raw = Array.isArray(body) ? body : [];
        const items = raw
          .map(toCatalogItemSummary)
          .filter((i): i is NonNullable<typeof i> => i !== null);

        const hasAnyFilter = Object.keys(applied_filters).length > 0;
        const total_scope: 'filtered' | 'tenant' | 'unknown' =
          pagination.total === undefined
            ? 'unknown'
            : hasAnyFilter
              ? 'filtered'
              : 'tenant';

        const totalNote =
          pagination.total !== undefined ? ` of ${String(pagination.total)}` : '';
        const moreNote = pagination.has_more ? ', more available' : '';
        const scopeNote = hasAnyFilter ? 'filtered' : 'tenant-wide';
        const summary = `Returned ${String(items.length)} catalog items${totalNote} (page ${String(pagination.page)}, ${scopeNote}${moreNote}).`;
        return structuredResult(
          {
            items,
            pagination: { ...pagination, total_scope },
            applied_filters,
          },
          summary,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
