import type { McpServer } from '@modelcontextprotocol/server';
import type { ToolContext } from '../../config/toolRegistry.js';
import { registerSafeDelete } from '../shared/safeDelete.js';

export function registerDeleteChange(server: McpServer, ctx: ToolContext): void {
  registerSafeDelete(server, ctx, {
    kind: 'change',
    toolName: 'swsd_delete_change',
    collectionPath: '/changes',
    envelopeKey: 'change',
  });
}
