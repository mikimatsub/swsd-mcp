import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerUpdateComment } from '../../../src/tools/comments/updateComment.js';
import {
  makeFakeClient,
  makeCtx,
  getRegisteredTool,
  type FakeClient,
  type RegisteredToolInternals,
} from './_helpers/mockClient.js';

describe('swsd_update_comment — id_or_number resolution', () => {
  let server: McpServer;
  let client: FakeClient;
  let tool: RegisteredToolInternals;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    client = makeFakeClient();
    registerUpdateComment(server, makeCtx(client));
    tool = getRegisteredTool(server, 'swsd_update_comment');
  });

  it('resolves a 5-digit incident_id reference to id before PUTing the comment update', async () => {
    client.setLookupBody([{ id: 180457930, number: 60310 }]);
    client.setPutResponse({ id: 88888, body: 'updated', is_private: false });

    await tool.handler(
      { incident_id: 60310, comment_id: 88888, body: 'updated text' },
      {},
    );

    const lookup = client.calls.find((c) => c.type === 'get');
    expect(lookup?.path).toBe('/incidents.json');
    expect(lookup?.type === 'get' ? lookup.params : {}).toMatchObject({
      query: 60310,
    });

    // PUT must use the RESOLVED incident id, not the input number
    const put = client.calls.find((c) => c.type === 'put');
    expect(put?.path).toBe('/incidents/180457930/comments/88888.json');
  });
});
