import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { GetSolutionInput } from '../../schemas/solution.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { toSolutionDetail } from '../../swsd/mappers/solution.js';
import { loadUiResource } from '../../mcp/uiResources.js';
import { resolveSolutionRef } from '../../utils/idResolver.js';
import type { ToolContext } from '../../config/toolRegistry.js';

const UI_RESOURCE_URI = 'ui://swsd/solution-detail.html';

export function registerGetSolution(server: McpServer, ctx: ToolContext): void {
  registerAppTool(
    server,
    'swsd_get_solution',
    {
      description:
        'Fetch one SWSD solution by numeric ID. Returns the full solution as ' +
        'returned by SWSD (passthrough), including both `description` (HTML) and ' +
        '`description_no_html` (plain text) fields, custom_fields_values, comments ' +
        'count, and attachment metadata. Use swsd_search_solutions first if you ' +
        'only have a topic — IDs are not guessable.' +
        ' Pass detail_level: "long" to include attachments, audits, and tags in one call.',
      inputSchema: GetSolutionInput.shape,
      outputSchema: z.object({
        solution: z.record(z.string(), z.unknown()),
      }).shape,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
      _meta: { ui: { resourceUri: UI_RESOURCE_URI } },
    },
    async (input) => {
      try {
        const { id: resolvedId } = await resolveSolutionRef(input.id, ctx.client);
        const params = input.detail_level === 'long' ? { layout: 'long' } : {};
        const { body } = await ctx.client.get<unknown>(
          `/solutions/${String(resolvedId)}.json`,
          params,
        );
        const solution = toSolutionDetail(body);
        if (!solution) {
          return toolError(
            `Could not parse solution ${String(resolvedId)} response from SWSD.`,
            'The response was not a JSON object with a numeric id field. Verify the solution exists with swsd_search_solutions.',
          );
        }
        const name = typeof solution.name === 'string' ? `: ${solution.name}` : '';
        return structuredResult({ solution }, `Solution ${String(solution.id)}${name}`);
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );

  registerAppResource(
    server,
    'swsd-solution-detail-ui',
    UI_RESOURCE_URI,
    { description: 'Solution detail view rendered by Apps-capable hosts.' },
    () => ({
      contents: [
        {
          uri: UI_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: loadUiResource('solution-detail'),
        },
      ],
    }),
  );
}
