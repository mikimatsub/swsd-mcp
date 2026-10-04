import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerListMyIncidents } from '../../../src/tools/incidents/listMyIncidents.js';
import { registerListIncidents } from '../../../src/tools/incidents/listIncidents.js';
import type { ToolContext } from '../../../src/config/toolRegistry.js';

/**
 * Mirrors `listIncidents.ui.test.ts` for the assignee-scoped variant.
 *
 * `swsd_list_my_incidents` returns the SAME `IncidentSummary[]` shape as
 * `swsd_list_incidents`, so it should reuse the SAME `incident-list` widget.
 * The fix (audit Section A finding #2) switches its registration from
 * `server.registerTool` to `registerAppTool` and attaches `_meta.ui.resourceUri`
 * pointing at the URI the existing resource serves — without a duplicate
 * `registerAppResource` call (which would conflict at startup on the resource
 * name shared with `listIncidents`).
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

function makeCtx(): ToolContext {
  return {
    client: {} as never,
    profile: 'minimal' as never,
    env: {} as never,
    enabledTools: [],
    token: '',
  } satisfies ToolContext;
}

describe('swsd_list_my_incidents UI registration', () => {
  it("advertises ui://swsd/incident-list.html via _meta.ui.resourceUri (modern + legacy mirror)", () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerListMyIncidents(server, makeCtx());

    const internals = server as unknown as McpServerInternals;
    const tool = internals._registeredTools['swsd_list_my_incidents'];
    expect(tool).toBeDefined();

    // Modern shape — the agent should see a UI advertisement on this tool.
    const modernUri = tool._meta?.ui?.resourceUri;
    expect(modernUri).toBe('ui://swsd/incident-list.html');

    // Legacy mirror written by registerAppTool for older hosts.
    const legacyUri = tool._meta?.['ui/resourceUri'];
    expect(legacyUri).toBe(modernUri);
  });

  it('does NOT register the incident-list resource itself — that is owned by registerListIncidents', () => {
    // Critical: if registerListMyIncidents were to ALSO call registerAppResource
    // for 'ui://swsd/incident-list.html', wiring both tools into the same
    // server would startup-conflict on the resource name. This test pins down
    // that registerListMyIncidents only attaches the tool-side metadata.
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerListMyIncidents(server, makeCtx());

    const internals = server as unknown as McpServerInternals;
    const resource = internals._registeredResources['ui://swsd/incident-list.html'];
    expect(resource).toBeUndefined();
  });

  it('coexists with registerListIncidents — both tools point at the single shared resource', async () => {
    // The realistic case: the production server registers BOTH list tools.
    // The shared resource must be registered exactly once (by listIncidents),
    // and both tools must surface the same `_meta.ui.resourceUri`.
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const ctx = makeCtx();

    // Order matters only insofar as one of them owns the resource — pick the
    // realistic order (registerListIncidents in production is registered first
    // by registerCoreTools). Either order should work; the assertion is just
    // "no throw + resource exactly once".
    registerListIncidents(server, ctx);
    registerListMyIncidents(server, ctx);

    const internals = server as unknown as McpServerInternals;
    const URI = 'ui://swsd/incident-list.html';

    // Both tools advertise the same widget URI.
    expect(internals._registeredTools['swsd_list_incidents']?._meta?.ui?.resourceUri).toBe(URI);
    expect(internals._registeredTools['swsd_list_my_incidents']?._meta?.ui?.resourceUri).toBe(URI);

    // The resource is registered (exactly once — _registeredResources is a
    // map keyed by URI, so a duplicate registration would have thrown above).
    const resource = internals._registeredResources[URI];
    expect(resource).toBeDefined();

    // Sanity: the shared resource still serves the bundled incident-list HTML.
    const result = await resource.readCallback(new URL(URI));
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0]?.mimeType).toBe('text/html;profile=mcp-app');
    expect(result.contents[0]?.text).toContain('SWSD Incidents'); // sentinel from the bundled HTML <title>
    expect(result.contents[0]?.uri).toBe(URI);
  });
});
