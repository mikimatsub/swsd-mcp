import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { UpdateSolutionInput } from '../../schemas/solution.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { mapSwsdError } from '../../swsd/errors.js';
import {
  buildSolutionWritePayload,
  toSolutionDetail,
} from '../../swsd/mappers/solution.js';
import { resolveSolutionRef } from '../../utils/idResolver.js';
import { checkWriteMode } from '../shared/writeMode.js';
import type { ToolContext } from '../../config/toolRegistry.js';

export function registerUpdateSolution(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_update_solution',
    {
      description:
        'Update an existing SWSD knowledge-base solution. Pass `id` and any fields ' +
        'to change. Only provided fields are sent — others stay as-is. To replace ' +
        'the description entirely, pass the full new body. WRITE — does not retry ' +
        'on transient failure.' +
        ' To set tenant-specific custom field values, pass `custom_fields: [{name, value}]` — call swsd_describe_custom_fields first to discover field names and (for Dropdowns) allowed values. Solutions require `name` keying (custom_field_id alone is rejected with HTTP 400). Validated for Text, Dropdown, Number, Checkbox, and Date types.',
      inputSchema: UpdateSolutionInput.shape,
      annotations: { readOnlyHint: false, openWorldHint: true, idempotentHint: false },
    },
    async (input) => {
      try {
        const { id, ...fields } = input;
        const payload = buildSolutionWritePayload(fields);
        if (Object.keys(payload.solution).length === 0) {
          return toolError(
            'No fields to update — provide at least one field besides id.',
            'Pass any of: name, description, state, category_name, custom_fields.',
          );
        }
        const { id: resolvedId } = await resolveSolutionRef(id, ctx.client);
        const path = `/solutions/${String(resolvedId)}.json`;
        const gated = checkWriteMode(ctx, {
          method: 'PUT',
          path,
          body: payload,
          action: `update solution ${String(resolvedId)}`,
        });
        if (gated) return gated;
        const { body } = await ctx.client.put<unknown>(path, payload);
        const solution = toSolutionDetail(body);
        if (!solution) {
          return toolError('Could not parse updated-solution response from SWSD.');
        }
        const changed = Object.keys(payload.solution);
        return structuredResult(
          { solution, changed_fields: changed },
          `Updated solution ${String(resolvedId)} (${changed.join(', ')}).`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
