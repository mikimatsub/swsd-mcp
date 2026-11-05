import type { McpServer } from '@modelcontextprotocol/server';
import type { ToolContext } from '../../config/toolRegistry.js';
import { toTask } from '../../swsd/mappers/task.js';
import { registerSafeSubresourceDelete } from '../shared/safeDelete.js';

export function registerDeleteTask(server: McpServer, ctx: ToolContext): void {
  registerSafeSubresourceDelete(server, ctx, {
    kind: 'task',
    toolName: 'swsd_delete_task',
    collection: 'tasks',
    idField: 'task_id',
    envelopeKey: 'task',
    summarize: (raw) => {
      const task = toTask(raw);
      if (!task) return null;
      const complete = raw && typeof raw === 'object' && 'is_complete' in raw
        && typeof raw.is_complete === 'boolean' ? raw.is_complete : (task.state ? task.completed : null);
      return { id: task.id, name: task.name, is_complete: complete };
    },
  });
}
