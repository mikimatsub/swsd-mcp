import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { UpdateCommentInput } from '../../schemas/comment.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { toCommentSummary } from '../../swsd/mappers/comment.js';
import { resolveIncidentRef } from '../../utils/idResolver.js';
import { checkWriteMode } from '../shared/writeMode.js';
import type { ToolContext } from '../../config/toolRegistry.js';

export function registerUpdateComment(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_update_comment',
    {
      description:
        'Update the body of an existing SWSD incident comment. Pass `incident_id`, ' +
        '`comment_id`, and the new `body`. The is_private flag cannot be changed by ' +
        'this tool — to change visibility, delete and re-create. ' +
        'WRITE — does not retry on transient failure.',
      inputSchema: UpdateCommentInput.shape,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: false },
    },
    async ({ incident_id, comment_id, body }) => {
      try {
        const { id: resolvedIncidentId } = await resolveIncidentRef(incident_id, ctx.client);
        const payload = { comment: { body } };
        const path = `/incidents/${String(resolvedIncidentId)}/comments/${String(comment_id)}.json`;
        const gated = checkWriteMode(ctx, {
          method: 'PUT',
          path,
          body: payload,
          action: `update comment ${String(comment_id)} on incident ${String(resolvedIncidentId)}`,
        });
        if (gated) return gated;
        const { body: respBody } = await ctx.client.put<unknown>(path, payload);
        const comment = toCommentSummary(respBody);
        if (!comment) {
          return toolError('Could not parse updated-comment response from SWSD.');
        }
        return structuredResult(
          { comment },
          `Updated comment ${String(comment_id)} on incident ${String(resolvedIncidentId)}.`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
