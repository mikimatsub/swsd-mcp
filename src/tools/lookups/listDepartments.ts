import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ListLookupInput } from '../../schemas/lookup.js';
import { PaginationOutput } from '../../schemas/output.js';
import { structuredResult } from '../../mcp/output.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { toDepartmentSummary } from '../../swsd/mappers/lookup.js';
import { fetchAndMap } from '../../swsd/list-helper.js';
import type { ToolContext } from '../../config/toolRegistry.js';

const DepartmentSummaryOutput = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string().optional(),
});

export function registerListDepartments(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_list_departments',
    {
      description:
        'List SWSD departments (organizational divisions). Returns id, name, description. ' +
        'Use this to validate department_name before incident write tools.',
      inputSchema: ListLookupInput.shape,
      outputSchema: z.object({
        departments: z.array(DepartmentSummaryOutput),
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
          '/departments.json',
          toDepartmentSummary,
          params,
        );
        return structuredResult(
          { departments: items, pagination },
          `Returned ${String(items.length)} departments (page ${String(pagination.page)}${pagination.has_more ? ', more available' : ''}).`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
