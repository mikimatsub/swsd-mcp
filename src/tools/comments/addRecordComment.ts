import type { McpServer } from '@modelcontextprotocol/server';
import { AddRecordCommentInput } from '../../schemas/recordCommentsTasks.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { toCommentSummary } from '../../swsd/mappers/comment.js';
import { checkWriteMode } from '../shared/writeMode.js';
import type { ToolContext } from '../../config/toolRegistry.js';

export function registerAddRecordComment(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_add_record_comment',
    {
      description:
        'Add a comment to a SWSD problem, change, or release. Set `is_private: true` to make the comment ' +
        'internal-only (default false = visible to the requester). ' +
        'WRITE — does not retry on transient failure.',
      inputSchema: AddRecordCommentInput,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
    },
    async ({ record_type, record_id, body, is_private }) => {
      try {
        const payload = { comment: { body, is_private } };
        const path = `/${record_type}/${String(record_id)}/comments.json`;
        const gated = checkWriteMode(ctx, {
          method: 'POST',
          path,
          body: payload,
          action: `add comment to ${record_type} record ${String(record_id)}`,
        });
        if (gated) return gated;
        const { body: respBody } = await ctx.client.post<unknown>(path, payload);
        const comment = toCommentSummary(respBody);
        if (!comment) {
          return toolError('Could not parse new-comment response from SWSD.');
        }
        const visibility = comment.is_private ? 'private' : 'public';
        return structuredResult(
          { comment },
          `Added ${visibility} comment ${String(comment.id)} on ${record_type} record ${String(record_id)}.`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
