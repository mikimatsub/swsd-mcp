import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { structuredResult } from '../../mcp/output.js';
import { mapSwsdError } from '../../swsd/errors.js';
import type { ToolContext } from '../../config/toolRegistry.js';

export function registerHealthCheck(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_health_check',
    {
      description:
        'Verify connectivity and authentication to SWSD by making a minimal request. ' +
        'Returns ok=true on success, otherwise an error explaining the failure (401 = bad token, 403 = insufficient permission, network error = unreachable).',
      inputSchema: {},
      outputSchema: z.object({
        ok: z.boolean(),
        base_url: z.string(),
        api_version: z.string(),
      }).shape,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    },
    async () => {
      try {
        await ctx.client.get('/incidents.json', { per_page: 1 });
        const data = {
          ok: true,
          base_url: ctx.env.SWSD_BASE_URL,
          api_version: ctx.env.SWSD_API_VERSION,
        };
        return structuredResult(
          data,
          `SWSD reachable at ${ctx.env.SWSD_BASE_URL} (API ${ctx.env.SWSD_API_VERSION}).`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
