import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerListIncidentComments } from '../../../src/tools/comments/listIncidentComments.js';
import type { ToolContext } from '../../../src/config/toolRegistry.js';

/**
 * Mirrors the other `*.ui.test.ts` files for `swsd_list_incident_comments`.
 * ext-apps@1.7.1 stores UI metadata at `registeredTool._meta.ui.resourceUri`
 * (preferred) and `registeredTool._meta["ui/resourceUri"]` (deprecated mirror,
 * kept for back-compat). We assert both — if either ever drops out we want a
 * regression signal.
 *
 * `McpServer` exposes registered tools and resources on the (private)
 * `_registeredTools` and `_registeredResources` records keyed by name/uri. We
 * reach into them with a typed cast — the same pattern the upstream SDK's own
 * tests use.
 */
interface RegisteredToolWithUi {
  _meta?: {
    ui?: { resourceUri?: unknown };
    'ui/resourceUri'?: unknown;
    [key: string]: unknown;
  };
}

interface RegisteredResourceWithRead {
  readCallback: (
    uri: URL,
  ) =>
    | Promise<{
        contents: Array<{ uri: string; mimeType: string; text: string }>;
      }>
    | { contents: Array<{ uri: string; mimeType: string; text: string }> };
}

interface McpServerInternals {
  _registeredTools: Record<string, RegisteredToolWithUi>;
  _registeredResources: Record<string, RegisteredResourceWithRead>;
}

describe('swsd_list_incident_comments UI registration', () => {
  it("attaches a ui:// resourceUri to the registered tool's _meta and registers the resource", async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const ctx = {
      client: {} as never,
      profile: 'minimal' as never,
      env: {} as never,
      enabledTools: [],
      token: '',
    } satisfies ToolContext;

    registerListIncidentComments(server, ctx);

    const internals = server as unknown as McpServerInternals;
    const tool = internals._registeredTools['swsd_list_incident_comments'];
    expect(tool).toBeDefined();

    const modernUri = tool?._meta?.ui?.resourceUri;
    expect(modernUri).toBe('ui://swsd/comment-thread.html');

    const legacyUri = tool?._meta?.['ui/resourceUri'];
    expect(legacyUri).toBe(modernUri);

    const registered = internals._registeredResources[modernUri as string];
    expect(registered).toBeDefined();

    // Exercise the read callback so the loadUiResource('comment-thread')
    // path and contents[] assembly are actually covered.
    const result = await registered.readCallback(new URL(modernUri as string));
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0]?.mimeType).toBe('text/html;profile=mcp-app');
    expect(result.contents[0]?.text).toContain('SWSD Comments'); // sentinel from the bundled HTML <title>
    expect(result.contents[0]?.uri).toBe(modernUri);
  });
});
