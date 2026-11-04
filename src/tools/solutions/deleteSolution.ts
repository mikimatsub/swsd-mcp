import type { McpServer } from '@modelcontextprotocol/server';
import type { ToolContext } from '../../config/toolRegistry.js';
import { resolveSolutionRef } from '../../utils/idResolver.js';
import { registerSafeDelete } from '../shared/safeDelete.js';

export function registerDeleteSolution(server: McpServer, ctx: ToolContext): void {
  registerSafeDelete(server, ctx, { kind: 'solution', resolveRef: resolveSolutionRef });
}
