import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ListLookupInput } from '../../schemas/lookup.js';
import { PaginationOutput } from '../../schemas/output.js';
import { structuredResult } from '../../mcp/output.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { toRoleSummary } from '../../swsd/mappers/lookup.js';
import { fetchAndMap } from '../../swsd/list-helper.js';
import type { ToolContext } from '../../config/toolRegistry.js';

const RoleSummaryOutput = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string().optional(),
});

export function registerListRoles(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_list_roles',
    {
      description:
        'List SWSD roles (permission profiles). Returns id, name, description. Useful for ' +
        'understanding what users can do in SWSD when triaging permission-related tickets.',
      inputSchema: ListLookupInput.shape,
      outputSchema: z.object({
        roles: z.array(RoleSummaryOutput),
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
          '/roles.json',
          toRoleSummary,
          params,
        );
        return structuredResult(
          { roles: items, pagination },
          `Returned ${String(items.length)} roles (page ${String(pagination.page)}${pagination.has_more ? ', more available' : ''}).`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
