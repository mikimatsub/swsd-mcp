import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerGetSolution } from '../../../src/tools/solutions/getSolution.js';
import type { ToolContext } from '../../../src/config/toolRegistry.js';

/**
 * Mirrors `getIncident.ui.test.ts` for `swsd_get_solution`. ext-apps@1.7.1
 * stores UI metadata at `registeredTool._meta.ui.resourceUri` (preferred)
 * and `registeredTool._meta["ui/resourceUri"]` (deprecated mirror, kept for
 * back-compat). We assert both — if either ever drops out we want a
 * regression signal.
 *
 * `McpServer` exposes registered tools and resources on the (private)
 * `_registeredTools` and `_registeredResources` records keyed by name/uri.
 * We reach into them with a typed cast — the same pattern the upstream
 * SDK's own tests use.
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

describe('swsd_get_solution UI registration', () => {
  it("attaches a ui:// resourceUri to the registered tool's _meta and registers the resource", async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const ctx = {
      client: {} as never,
      profile: 'minimal' as never,
      env: {} as never,
      enabledTools: [],
      token: '',
    } satisfies ToolContext;

    registerGetSolution(server, ctx);

    const internals = server as unknown as McpServerInternals;
    const solution = internals._registeredTools['swsd_get_solution'];
    expect(solution).toBeDefined();

    // Modern shape: _meta.ui.resourceUri — pinned to the exact URI the
    // implementation registers. A typo in 'solution-detail' would no longer
    // slip through.
    const modernUri = solution._meta?.ui?.resourceUri;
    expect(modernUri).toBe('ui://swsd/solution-detail.html');

    // Legacy mirror written by registerAppTool for older hosts.
    const legacyUri = solution._meta?.['ui/resourceUri'];
    expect(legacyUri).toBe(modernUri);

    // The tool's _meta points at a resource URI — assert the resource itself
    // is actually registered. Without this, a future refactor could delete
    // the resource registration and every host that fetches the URI would
    // 404, but the tool-metadata assertion alone would still pass.
    const registered = internals._registeredResources[modernUri as string];
    expect(registered).toBeDefined();

    // Exercise the read callback so the loadUiResource('solution-detail')
    // path and contents[] assembly are actually covered. A future refactor
    // that breaks the bundle path or the resource shape lights up here.
    const result = await registered.readCallback(new URL(modernUri as string));
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0]?.mimeType).toBe('text/html;profile=mcp-app');
    expect(result.contents[0]?.text).toContain('SWSD Solution'); // sentinel from the bundled HTML <title>
    expect(result.contents[0]?.uri).toBe(modernUri);
  });
});
