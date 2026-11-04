import type { McpServer } from '@modelcontextprotocol/server';
import type { ToolContext } from '../../config/toolRegistry.js';
import { resolveProblemRef } from '../../utils/idResolver.js';
import { registerSafeDelete } from '../shared/safeDelete.js';

export function registerDeleteProblem(server: McpServer, ctx: ToolContext): void {
  registerSafeDelete(server, ctx, {
    kind: 'problem',
    toolName: 'swsd_delete_problem',
    collectionPath: '/problems',
    envelopeKey: 'problem',
    resolveRef: resolveProblemRef,
  });
}
