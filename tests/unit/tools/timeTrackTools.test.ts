import { describe, expect, it, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  registerListTimeTracks,
  registerLogTime,
  registerUpdateTimeTrack,
} from '../../../src/tools/timeTracks/timeTrackTools.js';
import {
  getRegisteredTool,
  makeCtx,
  makeFakeClient,
  type FakeClient,
} from './_helpers/mockClient.js';

describe('time-track tools', () => {
  let server: McpServer;
  let client: FakeClient;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    client = makeFakeClient();
  });

  it('lists time tracks for supported parent objects', async () => {
    client.setLookupBody([{ id: 9, name: 'Investigation', minutes_parsed: 30 }]);
    registerListTimeTracks(server, makeCtx(client));
    const tool = getRegisteredTool(server, 'swsd_list_time_tracks');

    const result = (await tool.handler(
      { object_type: 'incidents', id: 123, page: 1, per_page: 5 },
      {},
    )) as CallToolResult;

    expect(client.calls[0]).toEqual({
      type: 'get',
      path: '/incidents/123/time_tracks.json',
      params: { page: 1, per_page: 5 },
    });
    expect(result.structuredContent).toMatchObject({
      time_tracks: [{ id: 9, name: 'Investigation', minutes_parsed: 30 }],
    });
  });

  it('logs time with the SWSD time_track envelope', async () => {
    client.setPostResponse({ id: 10, name: 'Resolution', minutes_parsed: 45 });
    registerLogTime(server, makeCtx(client));
    const tool = getRegisteredTool(server, 'swsd_log_time');

    await tool.handler(
      { object_type: 'problems', id: 77, name: 'Resolution', minutes_parsed: 45 },
      {},
    );

    expect(client.calls[0]).toEqual({
      type: 'post',
      path: '/problems/77/time_tracks.json',
      body: { time_track: { name: 'Resolution', minutes_parsed: 45 } },
    });
  });

  it('rejects empty updates before calling SWSD', async () => {
    registerUpdateTimeTrack(server, makeCtx(client));
    const tool = getRegisteredTool(server, 'swsd_update_time_track');

    const result = (await tool.handler(
      { object_type: 'changes', id: 88, time_track_id: 7 },
      {},
    )) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(client.calls).toEqual([]);
  });
});
