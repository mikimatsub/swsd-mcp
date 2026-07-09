import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AddIncidentCommentInput } from '../../schemas/comment.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { toCommentSummary } from '../../swsd/mappers/comment.js';
import { resolveIncidentRef } from '../../utils/idResolver.js';
import { checkWriteMode } from '../shared/writeMode.js';
import type { ToolContext } from '../../config/toolRegistry.js';

export function registerAddIncidentComment(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_add_incident_comment',
    {
      description:
        'Add a comment to a SWSD incident. Set `is_private: true` to make the comment ' +
        'internal-only (default false = visible to the requester). To edit a comment ' +
        'after posting, use `swsd_update_comment`. WRITE — does not retry on transient failure.',
      inputSchema: AddIncidentCommentInput.shape,
      annotations: { readOnlyHint: false, openWorldHint: true, idempotentHint: false },
    },
    async ({ incident_id, body, is_private }) => {
      try {
        const { id: resolvedIncidentId } = await resolveIncidentRef(incident_id, ctx.client);
        const payload = { comment: { body, is_private } };
        const path = `/incidents/${String(resolvedIncidentId)}/comments.json`;
        const gated = checkWriteMode(ctx, {
          method: 'POST',
          path,
          body: payload,
          action: `add comment to incident ${String(resolvedIncidentId)}`,
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
          `Added ${visibility} comment ${String(comment.id)} on incident ${String(resolvedIncidentId)}.`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
