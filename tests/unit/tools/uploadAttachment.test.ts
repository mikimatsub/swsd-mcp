import { describe, expect, it, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { registerUploadAttachment } from '../../../src/tools/attachments/uploadAttachment.js';
import {
  getRegisteredTool,
  makeCtx,
  makeFakeClient,
  type FakeClient,
} from './_helpers/mockClient.js';

describe('swsd_upload_attachment', () => {
  let server: McpServer;
  let client: FakeClient;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    client = makeFakeClient();
    client.setRawResponse({ id: 555, name: 'evidence.txt' }, 201);
  });

  it('uploads base64 content as multipart form data', async () => {
    registerUploadAttachment(server, makeCtx(client, { SWSD_TRANSPORT: 'http' }));
    const tool = getRegisteredTool(server, 'swsd_upload_attachment');

    const result = (await tool.handler(
      {
        parent_type: 'incidents',
        parent_id: 123,
        file_name: 'evidence.txt',
        content_base64: Buffer.from('hello').toString('base64'),
      },
      {},
    )) as CallToolResult;

    expect(client.calls).toHaveLength(1);
    const raw = client.calls[0];
    expect(raw?.type).toBe('raw');
    if (raw?.type === 'raw') {
      expect(raw.path).toBe('/attachments.json');
      expect(raw.init.method).toBe('POST');
      expect(raw.init.body).toBeInstanceOf(FormData);
      expect(raw.init.headers).toEqual({ Accept: 'application/vnd.samanage.v1.3+json' });
    }
    expect(result.structuredContent).toMatchObject({
      parent: { type: 'incidents', id: 123 },
      status: 201,
    });
  });

  it('blocks file_path over HTTP transport', async () => {
    registerUploadAttachment(server, makeCtx(client, { SWSD_TRANSPORT: 'http' }));
    const tool = getRegisteredTool(server, 'swsd_upload_attachment');

    const result = (await tool.handler(
      {
        parent_type: 'incidents',
        parent_id: 123,
        file_name: 'evidence.txt',
        file_path: 'C:\\temp\\evidence.txt',
      },
      {},
    )) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(client.calls).toEqual([]);
  });

  it('returns a byte-count preview in dry-run mode', async () => {
    registerUploadAttachment(
      server,
      makeCtx(client, { SWSD_WRITE_MODE: 'dry-run', SWSD_TRANSPORT: 'http' }),
    );
    const tool = getRegisteredTool(server, 'swsd_upload_attachment');

    const result = (await tool.handler(
      {
        parent_type: 'changes',
        parent_id: 456,
        file_name: 'plan.txt',
        content_base64: Buffer.from('change plan').toString('base64'),
      },
      {},
    )) as CallToolResult;

    expect(client.calls).toEqual([]);
    expect(result.structuredContent).toEqual({
      dry_run: true,
      request: {
        method: 'POST',
        path: '/attachments.json',
        body: {
          file: {
            attachable_type: 'Change',
            attachable_id: 456,
            attachment: {
              file_name: 'plan.txt',
              bytes: 11,
            },
          },
        },
      },
    });
  });
});
