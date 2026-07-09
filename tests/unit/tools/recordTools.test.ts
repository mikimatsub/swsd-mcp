import { describe, expect, it, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  registerCreateChange,
  registerGetHardwareAsset,
  registerListChanges,
} from '../../../src/tools/records/recordTools.js';
import {
  getRegisteredTool,
  makeCtx,
  makeFakeClient,
  type FakeClient,
  type RegisteredToolInternals,
} from './_helpers/mockClient.js';

describe('generic record tools', () => {
  let server: McpServer;
  let client: FakeClient;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    client = makeFakeClient();
  });

  it('lists changes with documented pagination/layout parameters only', async () => {
    client.setLookupBody([
      { id: 101, name: 'Firewall patch', state: 'Planned', priority: 'High' },
    ]);
    registerListChanges(server, makeCtx(client));
    const tool = getRegisteredTool(server, 'swsd_list_changes');

    const result = (await tool.handler(
      { page: 2, per_page: 10, detail_level: 'long' },
      {},
    )) as CallToolResult;

    expect(client.calls).toEqual([
      {
        type: 'get',
        path: '/changes.json',
        params: { page: 2, per_page: 10, layout: 'long' },
      },
    ]);
    expect(result.structuredContent).toMatchObject({
      changes: [{ id: 101, name: 'Firewall patch', state: 'Planned' }],
    });
  });

  it('fetches a hardware asset with layout=long when supported', async () => {
    client.setLookupBody({ id: 501, name: 'Laptop 501', asset_tag: 'L501' });
    registerGetHardwareAsset(server, makeCtx(client));
    const tool = getRegisteredTool(server, 'swsd_get_hardware_asset');

    const result = (await tool.handler(
      { id: 501, detail_level: 'long' },
      {},
    )) as CallToolResult;

    expect(client.calls).toEqual([
      {
        type: 'get',
        path: '/hardwares/501.json',
        params: { layout: 'long' },
      },
    ]);
    expect(result.structuredContent).toMatchObject({
      hardware_asset: { id: 501, name: 'Laptop 501', asset_tag: 'L501' },
    });
  });

  it('honors dry-run for change creation without POSTing', async () => {
    registerCreateChange(
      server,
      makeCtx(client, { SWSD_WRITE_MODE: 'dry-run' }),
    );
    const tool: RegisteredToolInternals = getRegisteredTool(server, 'swsd_create_change');

    const result = (await tool.handler(
      {
        name: 'Firewall patch',
        requester_email: 'pat@example.com',
      },
      {},
    )) as CallToolResult;

    expect(client.calls).toEqual([]);
    expect(result.structuredContent).toEqual({
      dry_run: true,
      request: {
        method: 'POST',
        path: '/changes.json',
        body: {
          change: {
            name: 'Firewall patch',
            requester: { email: 'pat@example.com' },
          },
        },
      },
    });
  });
});
