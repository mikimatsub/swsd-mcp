import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { ListRecordCommentsInput } from '../../schemas/recordCommentsTasks.js';
import { PaginationOutput } from '../../schemas/output.js';
import { structuredResult } from '../../mcp/output.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { toCommentSummary } from '../../swsd/mappers/comment.js';
import { fetchAndMap } from '../../swsd/list-helper.js';
import type { ToolContext } from '../../config/toolRegistry.js';

const CommentSummaryOutput = z.object({
  id: z.number().int(),
  body: z.string(),
  is_private: z.boolean(),
  author_email: z.string().optional(),
  author_name: z.string().optional(),
  created_at: z.string().optional(),
});

export function registerListRecordComments(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_list_record_comments',
    {
      description:
        'List comments on a SWSD problem, change, or release. Returns id, body, is_private, author_email, ' +
        'author_name, created_at. Use swsd_add_record_comment to add a new comment.',
      inputSchema: ListRecordCommentsInput,
      outputSchema: z.object({
        comments: z.array(CommentSummaryOutput),
        pagination: PaginationOutput,
        record_type: ListRecordCommentsInput.shape.record_type,
        record_id: z.number().int(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    },
    async ({ record_type, record_id, page, per_page }) => {
      try {
        const { items, pagination } = await fetchAndMap(
          ctx.client,
          `/${record_type}/${String(record_id)}/comments.json`,
          toCommentSummary,
          { page, per_page },
        );
        return structuredResult(
          { comments: items, pagination, record_type, record_id },
          `Returned ${String(items.length)} comments on ${record_type} record ${String(record_id)} (page ${String(pagination.page)}${pagination.has_more ? ', more available' : ''}).`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
