import {
  closeSync,
  ftruncateSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { MAX_ATTACHMENT_BYTES } from '../../../src/schemas/attachment.js';
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
  const tempDirectories: string[] = [];

  function makeTempDirectory(): string {
    const directory = mkdtempSync(join(tmpdir(), 'swsd-mcp-attachment-'));
    tempDirectories.push(directory);
    return directory;
  }

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    client = makeFakeClient();
    client.setRawResponse({ id: 555, name: 'evidence.txt' }, 201);
  });

  afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
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

  it('enforces the exactly-one-source refinement through the MCP protocol', async () => {
    registerUploadAttachment(server, makeCtx(client));
    const protocolClient = new Client({ name: 'attachment-test', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      protocolClient.connect(clientTransport),
    ]);

    try {
      const result = await protocolClient.callTool({
        name: 'swsd_upload_attachment',
        arguments: {
          parent_type: 'incidents',
          parent_id: 123,
          file_name: 'evidence.txt',
          content_base64: Buffer.from('hello').toString('base64'),
          file_path: 'C:\\temp\\evidence.txt',
        },
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]).toMatchObject({
        type: 'text',
        text: expect.stringMatching(/exactly one/i),
      });
      expect(client.calls).toEqual([]);
    } finally {
      await protocolClient.close();
      await server.close();
    }
  });

  it('uploads a regular local file over stdio when no attachment root is configured', async () => {
    const directory = makeTempDirectory();
    const filePath = join(directory, 'evidence.txt');
    writeFileSync(filePath, 'hello from disk');
    registerUploadAttachment(server, makeCtx(client));
    const tool = getRegisteredTool(server, 'swsd_upload_attachment');

    const result = (await tool.handler(
      {
        parent_type: 'incidents',
        parent_id: 123,
        file_name: 'evidence.txt',
        file_path: filePath,
      },
      {},
    )) as CallToolResult;

    expect(result.isError).not.toBe(true);
    expect(client.calls).toHaveLength(1);
  });

  it('allows a local file whose real path is inside SWSD_ATTACHMENT_ROOT', async () => {
    const root = makeTempDirectory();
    const filePath = join(root, 'evidence.txt');
    writeFileSync(filePath, 'inside root');
    registerUploadAttachment(server, makeCtx(client, { SWSD_ATTACHMENT_ROOT: root }));
    const tool = getRegisteredTool(server, 'swsd_upload_attachment');

    const result = (await tool.handler(
      {
        parent_type: 'incidents',
        parent_id: 123,
        file_name: 'evidence.txt',
        file_path: filePath,
      },
      {},
    )) as CallToolResult;

    expect(result.isError).not.toBe(true);
    expect(client.calls).toHaveLength(1);
  });

  it('rejects a local file outside SWSD_ATTACHMENT_ROOT', async () => {
    const root = makeTempDirectory();
    const outside = makeTempDirectory();
    const filePath = join(outside, 'evidence.txt');
    writeFileSync(filePath, 'outside root');
    registerUploadAttachment(server, makeCtx(client, { SWSD_ATTACHMENT_ROOT: root }));
    const tool = getRegisteredTool(server, 'swsd_upload_attachment');

    const result = (await tool.handler(
      {
        parent_type: 'incidents',
        parent_id: 123,
        file_name: 'evidence.txt',
        file_path: filePath,
      },
      {},
    )) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('outside SWSD_ATTACHMENT_ROOT'),
    });
    expect(client.calls).toEqual([]);
  });

  it('rejects a directory in place of a regular attachment file', async () => {
    const directory = makeTempDirectory();
    registerUploadAttachment(server, makeCtx(client));
    const tool = getRegisteredTool(server, 'swsd_upload_attachment');

    const result = (await tool.handler(
      {
        parent_type: 'incidents',
        parent_id: 123,
        file_name: 'evidence.txt',
        file_path: directory,
      },
      {},
    )) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('regular file'),
    });
    expect(client.calls).toEqual([]);
  });

  it('rejects unresolved local file paths without disclosing the path', async () => {
    const directory = makeTempDirectory();
    const filePath = join(directory, 'missing.txt');
    registerUploadAttachment(server, makeCtx(client));
    const tool = getRegisteredTool(server, 'swsd_upload_attachment');

    const result = (await tool.handler(
      {
        parent_type: 'incidents',
        parent_id: 123,
        file_name: 'missing.txt',
        file_path: filePath,
      },
      {},
    )) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('could not be resolved'),
    });
    expect(JSON.stringify(result)).not.toContain(filePath);
    expect(client.calls).toEqual([]);
  });

  it('rejects an unresolved SWSD_ATTACHMENT_ROOT', async () => {
    const directory = makeTempDirectory();
    const filePath = join(directory, 'evidence.txt');
    writeFileSync(filePath, 'evidence');
    const missingRoot = join(directory, 'missing-root');
    registerUploadAttachment(server, makeCtx(client, { SWSD_ATTACHMENT_ROOT: missingRoot }));
    const tool = getRegisteredTool(server, 'swsd_upload_attachment');

    const result = (await tool.handler(
      {
        parent_type: 'incidents',
        parent_id: 123,
        file_name: 'evidence.txt',
        file_path: filePath,
      },
      {},
    )) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('SWSD_ATTACHMENT_ROOT could not be resolved'),
    });
    expect(client.calls).toEqual([]);
  });

  it('rejects SWSD_ATTACHMENT_ROOT when it resolves to a file', async () => {
    const directory = makeTempDirectory();
    const filePath = join(directory, 'evidence.txt');
    const rootFile = join(directory, 'not-a-directory.txt');
    writeFileSync(filePath, 'evidence');
    writeFileSync(rootFile, 'not a root');
    registerUploadAttachment(server, makeCtx(client, { SWSD_ATTACHMENT_ROOT: rootFile }));
    const tool = getRegisteredTool(server, 'swsd_upload_attachment');

    const result = (await tool.handler(
      {
        parent_type: 'incidents',
        parent_id: 123,
        file_name: 'evidence.txt',
        file_path: filePath,
      },
      {},
    )) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('must reference a directory'),
    });
    expect(client.calls).toEqual([]);
  });

  it('rejects an oversized local file before reading or uploading it', async () => {
    const directory = makeTempDirectory();
    const filePath = join(directory, 'oversized.bin');
    const descriptor = openSync(filePath, 'w');
    ftruncateSync(descriptor, MAX_ATTACHMENT_BYTES + 1);
    closeSync(descriptor);
    registerUploadAttachment(server, makeCtx(client));
    const tool = getRegisteredTool(server, 'swsd_upload_attachment');

    const result = (await tool.handler(
      {
        parent_type: 'incidents',
        parent_id: 123,
        file_name: 'oversized.bin',
        file_path: filePath,
      },
      {},
    )) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('25 MB'),
    });
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
