import type { McpServer } from '@modelcontextprotocol/server';
import type { ToolContext } from '../../config/toolRegistry.js';
import { registerSafeDelete } from '../shared/safeDelete.js';

export function registerDeleteRelease(server: McpServer, ctx: ToolContext): void {
  registerSafeDelete(server, ctx, {
    kind: 'release',
    toolName: 'swsd_delete_release',
    collectionPath: '/releases',
    envelopeKey: 'release',
  });
}
