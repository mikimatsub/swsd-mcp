import type { McpServer } from '@modelcontextprotocol/server';
import type { ToolContext } from '../../config/toolRegistry.js';
import { resolveIncidentRef } from '../../utils/idResolver.js';
import { registerSafeDelete } from '../shared/safeDelete.js';

export function registerDeleteIncident(server: McpServer, ctx: ToolContext): void {
  registerSafeDelete(server, ctx, { kind: 'incident', resolveRef: resolveIncidentRef });
}
