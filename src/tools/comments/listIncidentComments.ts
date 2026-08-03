import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { ListIncidentCommentsInput } from '../../schemas/comment.js';
import { PaginationOutput } from '../../schemas/output.js';
import { structuredResult } from '../../mcp/output.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { toCommentSummary } from '../../swsd/mappers/comment.js';
import { fetchAndMap } from '../../swsd/list-helper.js';
import { resolveIncidentRef } from '../../utils/idResolver.js';
import { loadUiResource } from '../../mcp/uiResources.js';
import type { ToolContext } from '../../config/toolRegistry.js';

const UI_RESOURCE_URI = 'ui://swsd/comment-thread.html';

const CommentSummaryOutput = z.object({
  id: z.number().int(),
  body: z.string(),
  is_private: z.boolean(),
  author_email: z.string().optional(),
  author_name: z.string().optional(),
  created_at: z.string().optional(),
});

export function registerListIncidentComments(server: McpServer, ctx: ToolContext): void {
  registerAppTool(
    server,
    'swsd_list_incident_comments',
    {
      description:
        'List comments on a SWSD incident. Returns id, body, is_private, author_email, ' +
        'author_name, created_at. Use swsd_add_incident_comment to add a new comment.',
      inputSchema: ListIncidentCommentsInput.shape,
      outputSchema: z.object({
        comments: z.array(CommentSummaryOutput),
        pagination: PaginationOutput,
        incident_id: z.number().int(),
      }).shape,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
      _meta: { ui: { resourceUri: UI_RESOURCE_URI } },
    },
    async ({ incident_id, page, per_page }) => {
      try {
        const { id: resolvedIncidentId } = await resolveIncidentRef(incident_id, ctx.client);
        const { items, pagination } = await fetchAndMap(
          ctx.client,
          `/incidents/${String(resolvedIncidentId)}/comments.json`,
          toCommentSummary,
          { page, per_page },
        );
        return structuredResult(
          { comments: items, pagination, incident_id: resolvedIncidentId },
          `Returned ${String(items.length)} comments on incident ${String(resolvedIncidentId)} (page ${String(pagination.page)}${pagination.has_more ? ', more available' : ''}).`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );

  registerAppResource(
    server,
    'swsd-comment-thread-ui',
    UI_RESOURCE_URI,
    { description: 'Comment thread view rendered by Apps-capable hosts.' },
    () => ({
      contents: [
        {
          uri: UI_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: loadUiResource('comment-thread'),
        },
      ],
    }),
  );
}
