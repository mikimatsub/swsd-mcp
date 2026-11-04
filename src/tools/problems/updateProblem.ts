import type { McpServer } from '@modelcontextprotocol/server';
import { UpdateProblemInput } from '../../schemas/problem.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { mapSwsdError } from '../../swsd/errors.js';
import {
  buildProblemWritePayload,
  toProblemDetail,
} from '../../swsd/mappers/problem.js';
import { resolveProblemRef } from '../../utils/idResolver.js';
import { checkWriteMode } from '../shared/writeMode.js';
import type { ToolContext } from '../../config/toolRegistry.js';

export function registerUpdateProblem(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_update_problem',
    {
      description:
        'Update an existing SWSD problem. Pass `id` and any fields to change. ' +
        'Only provided fields are sent — others stay as-is. To replace the ' +
        'description entirely, pass the full new body. WRITE — does not retry ' +
        'on transient failure.',
      inputSchema: UpdateProblemInput,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: false },
    },
    async (input) => {
      try {
        const { id, ...fields } = input;
        const payload = buildProblemWritePayload(fields);
        if (Object.keys(payload.problem).length === 0) {
          return toolError(
            'No fields to update — provide at least one field besides id.',
            'Pass any of: name, description, priority, category, subcategory, assignee_email, requester_email, state, root_cause, symptoms, workaround.',
          );
        }
        const { id: resolvedId } = await resolveProblemRef(id, ctx.client);
        const path = `/problems/${String(resolvedId)}.json`;
        const gated = checkWriteMode(ctx, {
          method: 'PUT',
          path,
          body: payload,
          action: `update problem ${String(resolvedId)}`,
        });
        if (gated) return gated;
        const { body } = await ctx.client.put<unknown>(path, payload);
        const problem = toProblemDetail(body);
        if (!problem) {
          return toolError('Could not parse updated-problem response from SWSD.');
        }
        const changed = Object.keys(payload.problem);
        return structuredResult(
          { problem, changed_fields: changed },
          `Updated problem ${String(resolvedId)} (${changed.join(', ')}).`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
