import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CreateProblemInput } from '../../schemas/problem.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { mapSwsdError } from '../../swsd/errors.js';
import {
  buildProblemWritePayload,
  toProblemDetail,
} from '../../swsd/mappers/problem.js';
import { checkWriteMode } from '../shared/writeMode.js';
import type { ToolContext } from '../../config/toolRegistry.js';

export function registerCreateProblem(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_create_problem',
    {
      description:
        'Create a new SWSD problem (ITIL problem record). Required: `name`. ' +
        'Strongly recommended: `description`, `priority`, `category`. The created ' +
        'problem\'s id is returned for follow-up calls. Use this when promoting a ' +
        'recurring incident to a problem record so root-cause analysis and known-error ' +
        'tracking can be tied to multiple incidents. ' +
        'WRITE — does not retry on transient failure; the agent should verify with ' +
        'swsd_get_problem before retrying.',
      inputSchema: CreateProblemInput.shape,
      annotations: { readOnlyHint: false, openWorldHint: true, idempotentHint: false },
    },
    async (input) => {
      try {
        const payload = buildProblemWritePayload(input);
        const path = '/problems.json';
        const gated = checkWriteMode(ctx, {
          method: 'POST',
          path,
          body: payload,
          action: 'create problem',
        });
        if (gated) return gated;
        const { body } = await ctx.client.post<unknown>(path, payload);
        const problem = toProblemDetail(body);
        if (!problem) {
          return toolError('Could not parse created-problem response from SWSD.');
        }
        const name = typeof problem.name === 'string' ? problem.name : '(no name)';
        return structuredResult(
          { problem },
          `Created problem ${String(problem.id)}: ${name}`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
