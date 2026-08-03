import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ListLookupInput } from '../../schemas/lookup.js';
import { PaginationOutput } from '../../schemas/output.js';
import { structuredResult } from '../../mcp/output.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { toGroupSummary } from '../../swsd/mappers/lookup.js';
import { fetchAndMap } from '../../swsd/list-helper.js';
import type { ToolContext } from '../../config/toolRegistry.js';

const GroupSummaryOutput = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string().optional(),
  disabled: z.boolean(),
  member_count: z.number().int().optional(),
});

export function registerListGroups(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_list_groups',
    {
      description:
        'List SWSD groups (assignment teams). Returns id, name, description, disabled, ' +
        'member_count. Useful for understanding team structure when triaging tickets.',
      inputSchema: ListLookupInput.shape,
      outputSchema: z.object({
        groups: z.array(GroupSummaryOutput),
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
          '/groups.json',
          toGroupSummary,
          params,
        );
        return structuredResult(
          { groups: items, pagination },
          `Returned ${String(items.length)} groups (page ${String(pagination.page)}${pagination.has_more ? ', more available' : ''}).`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
