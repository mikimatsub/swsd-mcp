import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ListProblemsInput } from '../../schemas/problem.js';
import { PaginationWithScopeOutput } from '../../schemas/output.js';
import { structuredResult } from '../../mcp/output.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { toProblemSummary } from '../../swsd/mappers/problem.js';
import type { ToolContext } from '../../config/toolRegistry.js';

const ProblemSummaryOutput = z.object({
  id: z.number().int(),
  number: z.number().int().optional(),
  name: z.string(),
  state: z.string().optional(),
  priority: z.string().optional(),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  description: z.string().optional(),
  description_no_html: z.string().optional(),
  requester: z
    .object({
      id: z.number().int().optional(),
      name: z.string().optional(),
      email: z.string().optional(),
    })
    .optional(),
  assignee: z
    .object({
      id: z.number().int().optional(),
      name: z.string().optional(),
      email: z.string().optional(),
    })
    .optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  url: z
    .string()
    .optional()
    .describe('SWSD UI URL for this problem (from href_account_domain).'),
});

export function registerListProblems(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_list_problems',
    {
      description:
        'List SWSD problems (ITIL problem records) with structured filters and ' +
        'pagination. Returns compact summaries (id, name, state, priority, category, ' +
        'requester, assignee, updated_at) — call swsd_get_problem for the full ' +
        'detail of any one row. Filters use SWSD repeated-key array semantics ' +
        '(multiple values within a filter are OR-ed). Use this when investigating ' +
        'recurring incidents or identifying root causes that span multiple tickets.',
      inputSchema: ListProblemsInput.shape,
      outputSchema: z.object({
        problems: z.array(ProblemSummaryOutput),
        pagination: PaginationWithScopeOutput,
        applied_filters: z
          .record(z.string(), z.unknown())
          .describe(
            'Echo of the filters applied to this query — empty object if none. Use this to reason about whether the result count reflects your filters or the tenant total.',
          ),
      }).shape,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    },
    async (input) => {
      try {
        const params: Record<string, unknown> = {
          page: input.page,
          per_page: input.per_page,
        };
        if (input.state) params.state = input.state;
        if (input.state_is_not) params.state_is_not = input.state_is_not;
        if (input.priority) params.priority = input.priority;
        if (input.assignee_email) params.assignee_email = input.assignee_email;
        if (input.requester_email) params.requester_email = input.requester_email;
        if (input.query) params.query = input.query;

        const { body, pagination } = await ctx.client.get<unknown>('/problems.json', params);
        const raw = Array.isArray(body) ? body : [];
        const problems = raw
          .map(toProblemSummary)
          .filter((x): x is NonNullable<typeof x> => x !== null);

        const applied_filters: Record<string, unknown> = {};
        if (input.state) applied_filters.state = input.state;
        if (input.state_is_not) applied_filters.state_is_not = input.state_is_not;
        if (input.priority) applied_filters.priority = input.priority;
        if (input.assignee_email) applied_filters.assignee_email = input.assignee_email;
        if (input.requester_email) applied_filters.requester_email = input.requester_email;
        if (input.query) applied_filters.query = input.query;

        const hasAnyFilter = Object.keys(applied_filters).length > 0;
        const total_scope: 'filtered' | 'tenant' | 'unknown' =
          pagination.total === undefined
            ? 'unknown'
            : hasAnyFilter
              ? 'filtered'
              : 'tenant';

        const filterDescription = hasAnyFilter
          ? `matching your filters (${Object.entries(applied_filters)
              .slice(0, 3)
              .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : String(v)}`)
              .join(', ')}${Object.keys(applied_filters).length > 3 ? ', ...' : ''})`
          : 'tenant-wide';
        const totalNote =
          pagination.total !== undefined ? ` of ${String(pagination.total)}` : '';
        const moreNote = pagination.has_more ? ', more available' : '';
        const summary = `Returned ${String(problems.length)}${totalNote} ${filterDescription} problems (page ${String(pagination.page)}${moreNote}).`;

        return structuredResult(
          {
            problems,
            pagination: { ...pagination, total_scope },
            applied_filters,
          },
          summary,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
