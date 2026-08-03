import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ListUsersInput } from '../../schemas/lookup.js';
import { PaginationOutput } from '../../schemas/output.js';
import { structuredResult } from '../../mcp/output.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { toUserSummary } from '../../swsd/mappers/lookup.js';
import { fetchAndMap } from '../../swsd/list-helper.js';
import type { ToolContext } from '../../config/toolRegistry.js';

const UserSummaryOutput = z.object({
  id: z.number().int(),
  name: z.string(),
  email: z.string().optional(),
  disabled: z.boolean(),
  available_for_assignment: z.boolean().optional(),
  role: z.string().optional(),
  site: z.string().optional(),
  department: z.string().optional(),
  title: z.string().optional(),
});

export function registerListUsers(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_list_users',
    {
      description:
        'List SWSD users. Returns id, name, email, disabled, available_for_assignment, role, ' +
        'site, department, title. Set `available_for_assignment_only: true` to find valid ' +
        'assignees for swsd_assign_incident. Set `email` to look up one user exactly.',
      inputSchema: ListUsersInput.shape,
      outputSchema: z.object({
        users: z.array(UserSummaryOutput),
        pagination: PaginationOutput,
      }).shape,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    },
    async (input) => {
      try {
        const params: Record<string, unknown> = { page: input.page, per_page: input.per_page };
        if (input.query) params.name = input.query;
        if (input.email) params.email = input.email;
        const { items, pagination } = await fetchAndMap(
          ctx.client,
          '/users.json',
          toUserSummary,
          params,
        );
        const filtered = input.available_for_assignment_only
          ? items.filter((u) => u.available_for_assignment === true)
          : items;
        return structuredResult(
          { users: filtered, pagination },
          `Returned ${String(filtered.length)} users (page ${String(pagination.page)}${pagination.has_more ? ', more available' : ''}${input.available_for_assignment_only ? ', filtered to assignable' : ''}).`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
