import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ListLookupInput } from '../../schemas/lookup.js';
import { PaginationOutput } from '../../schemas/output.js';
import { structuredResult } from '../../mcp/output.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { toSiteSummary } from '../../swsd/mappers/lookup.js';
import { fetchAndMap } from '../../swsd/list-helper.js';
import type { ToolContext } from '../../config/toolRegistry.js';

const SiteSummaryOutput = z.object({
  id: z.number().int(),
  name: z.string(),
  location: z.string().optional(),
  description: z.string().optional(),
  time_zone: z.string().optional(),
});

export function registerListSites(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_list_sites',
    {
      description:
        'List SWSD sites (physical office/branch locations). Returns id, name, location code, ' +
        'description, time_zone. Use this to validate site_name before incident write tools.',
      inputSchema: ListLookupInput.shape,
      outputSchema: z.object({
        sites: z.array(SiteSummaryOutput),
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
          '/sites.json',
          toSiteSummary,
          params,
        );
        return structuredResult(
          { sites: items, pagination },
          `Returned ${String(items.length)} sites (page ${String(pagination.page)}${pagination.has_more ? ', more available' : ''}).`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
