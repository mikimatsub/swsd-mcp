import type { McpServer } from '@modelcontextprotocol/server';
import type { ToolContext } from '../../config/toolRegistry.js';
import { toCommentSummary } from '../../swsd/mappers/comment.js';
import { registerSafeSubresourceDelete } from '../shared/safeDelete.js';

export function registerDeleteComment(server: McpServer, ctx: ToolContext): void {
  registerSafeSubresourceDelete(server, ctx, {
    kind: 'comment',
    toolName: 'swsd_delete_comment',
    collection: 'comments',
    idField: 'comment_id',
    envelopeKey: 'comment',
    summarize: (raw) => {
      const comment = toCommentSummary(raw);
      return comment ? {
        id: comment.id,
        author_email: comment.author_email ?? null,
        body: comment.body.slice(0, 120),
      } : null;
    },
  });
}
