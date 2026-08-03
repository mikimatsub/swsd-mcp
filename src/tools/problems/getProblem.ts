import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { GetProblemInput } from '../../schemas/problem.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { toProblemDetail } from '../../swsd/mappers/problem.js';
import { resolveProblemRef } from '../../utils/idResolver.js';
import type { ToolContext } from '../../config/toolRegistry.js';

export function registerGetProblem(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_get_problem',
    {
      description:
        'Fetch one SWSD problem (ITIL problem record) by id or number. Returns the ' +
        'full problem detail as returned by SWSD (passthrough). Use swsd_list_problems ' +
        'first if you only have a name or filter — IDs are not guessable. Pass ' +
        'detail_level: "long" to include comments, audits, tasks, and time_tracks ' +
        'in one call.',
      inputSchema: GetProblemInput.shape,
      outputSchema: z.object({
        problem: z.record(z.string(), z.unknown()),
      }).shape,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    },
    async (input) => {
      try {
        const { id: resolvedId } = await resolveProblemRef(input.id, ctx.client);
        const params = input.detail_level === 'long' ? { layout: 'long' } : {};
        const { body } = await ctx.client.get<unknown>(
          `/problems/${String(resolvedId)}.json`,
          params,
        );
        const problem = toProblemDetail(body);
        if (!problem) {
          return toolError(
            `Could not parse problem ${String(resolvedId)} response from SWSD.`,
            'The response was not a JSON object with a numeric id field. Verify the problem exists with swsd_list_problems.',
          );
        }
        const name = typeof problem.name === 'string' ? `: ${problem.name}` : '';
        const summary = `Problem ${String(problem.id)}${name}`;
        return structuredResult({ problem }, summary);
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
