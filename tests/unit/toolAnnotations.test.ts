import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';
import { registerTools } from '../../src/config/toolRegistry.js';
import { makeCtx, makeFakeClient } from './tools/_helpers/mockClient.js';

interface RegisteredToolInternals {
  annotations?: Record<string, unknown>;
}

interface McpServerInternals {
  _registeredTools: Record<string, RegisteredToolInternals>;
}

const REQUIRED_HINTS = [
  'readOnlyHint',
  'destructiveHint',
  'idempotentHint',
  'openWorldHint',
] as const;

const DESTRUCTIVE_TOOLS = [
  'swsd_assign_incident',
  'swsd_update_change',
  'swsd_update_comment',
  'swsd_update_incident',
  'swsd_update_incident_state',
  'swsd_update_release',
  'swsd_update_solution',
  'swsd_update_task_state',
  'swsd_update_time_track',
] as const;

describe('tool annotations', () => {
  it('declares every MCP annotation hint explicitly for every tool', () => {
    const server = new McpServer({ name: 'annotation-test', version: '0.0.0' });
    const ctx = makeCtx(makeFakeClient(), { SWSD_ENABLE_EXTRAS: [] });
    ctx.profile = 'full';

    registerTools(server, ctx);

    const internals = server as unknown as McpServerInternals;
    const registeredTools = Object.entries(internals._registeredTools);
    expect(registeredTools.length).toBeGreaterThan(0);

    for (const [name, tool] of registeredTools) {
      for (const hint of REQUIRED_HINTS) {
        expect(typeof tool.annotations?.[hint], `${name}.${hint}`).toBe('boolean');
      }
    }

    for (const name of DESTRUCTIVE_TOOLS) {
      expect(
        internals._registeredTools[name]?.annotations?.destructiveHint,
        `${name}.destructiveHint`,
      ).toBe(true);
    }
  });
});
