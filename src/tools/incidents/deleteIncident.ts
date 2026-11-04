import type { McpServer } from '@modelcontextprotocol/server';
import type { ToolContext } from '../../config/toolRegistry.js';
import { resolveIncidentRef } from '../../utils/idResolver.js';
import { registerSafeDelete } from '../shared/safeDelete.js';

export function registerDeleteIncident(server: McpServer, ctx: ToolContext): void {
<<<<<<< HEAD
  registerSafeDelete(server, ctx, {
    kind: 'incident',
    toolName: 'swsd_delete_incident',
    collectionPath: '/incidents',
    envelopeKey: 'incident',
    resolveRef: resolveIncidentRef,
  });
=======
  registerSafeDelete(server, ctx, { kind: 'incident', resolveRef: resolveIncidentRef });
>>>>>>> origin/main
}
