import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CreateSolutionInput } from '../../schemas/solution.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { mapSwsdError } from '../../swsd/errors.js';
import {
  buildSolutionWritePayload,
  toSolutionDetail,
} from '../../swsd/mappers/solution.js';
import { checkWriteMode } from '../shared/writeMode.js';
import type { ToolContext } from '../../config/toolRegistry.js';

export function registerCreateSolution(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_create_solution',
    {
      description:
        'Create a new SWSD knowledge-base solution article. Required: `name` (title). ' +
        'Strongly recommended: `description` (article body — HTML supported), `state` ' +
        '(common values: "Internal", "Published", "Draft" — tenant-specific). ' +
        'Returns the created solution\'s ID for follow-up calls. ' +
        'WRITE — does not retry on transient failure; verify with swsd_get_solution before retrying.' +
        ' To set tenant-specific custom field values, pass `custom_fields: [{name, value}]` — call swsd_describe_custom_fields first to discover field names and (for Dropdowns) allowed values. Solutions require `name` keying (custom_field_id alone is rejected with HTTP 400). Validated for Text, Dropdown, Number, Checkbox, and Date types.',
      inputSchema: CreateSolutionInput.shape,
      annotations: { readOnlyHint: false, openWorldHint: true, idempotentHint: false },
    },
    async (input) => {
      try {
        const payload = buildSolutionWritePayload(input);
        const path = '/solutions.json';
        const gated = checkWriteMode(ctx, {
          method: 'POST',
          path,
          body: payload,
          action: 'create solution',
        });
        if (gated) return gated;
        const { body } = await ctx.client.post<unknown>(path, payload);
        const solution = toSolutionDetail(body);
        if (!solution) {
          return toolError('Could not parse created-solution response from SWSD.');
        }
        const name = typeof solution.name === 'string' ? solution.name : '(no name)';
        return structuredResult(
          { solution },
          `Created solution ${String(solution.id)}: ${name}`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
