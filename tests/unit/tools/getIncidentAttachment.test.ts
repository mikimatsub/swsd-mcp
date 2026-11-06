import { beforeEach, describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import {
  collectIncidentAttachments,
  registerGetIncidentAttachment,
  toAttachmentPath,
} from '../../../src/tools/attachments/getIncidentAttachment.js';
import { SwsdTooLargeError } from '../../../src/swsd/errors.js';
import {
  getRegisteredTool,
  makeCtx,
  makeFakeClient,
  type FakeClient,
  type RegisteredToolInternals,
} from './_helpers/mockClient.js';

const INCIDENT_ID = 200476208;

const INCIDENT = {
  id: INCIDENT_ID,
  number: 154037,
  name: 'Printer error',
  description:
    '<p>See screenshot</p><img src="/attachments/aaa111/image001-jpg.jpeg?thumb=true">' +
    '<img src="https://cdn.example.com/logo.png"><img src="data:image/png;base64,AAAA">',
  attachments: [
    { id: 501, filename: 'error.png', content_type: 'image/png', size: 2048, url: '/attachments/bbb222/stream' },
    { id: 502, filename: 'huge.zip', content_type: 'application/zip', size: 9 * 1024 * 1024, url: '/attachments/ccc333/stream' },
  ],
  comments: [
    {
      id: 77,
      body: '<p>Again</p><img src="https://helpdesk.example.com/attachments/ddd444/image002.png">',
      attachments: [{ id: 503, filename: 'log.txt', content_type: 'text/plain', size: 10, url: '/attachments/eee555/stream' }],
    },
  ],
};

interface ToolResult {
  isError?: boolean;
  content: Array<Record<string, unknown>>;
  structuredContent?: Record<string, unknown>;
}

describe('toAttachmentPath', () => {
  it('accepts SWSD attachment paths, relative or absolute, and drops the query', () => {
    expect(toAttachmentPath('/attachments/abc/stream')).toBe('/attachments/abc/stream');
    expect(toAttachmentPath('/attachments/abc/image001-jpg.jpeg?thumb=true')).toBe('/attachments/abc/image001-jpg.jpeg');
    expect(toAttachmentPath('https://helpdesk.example.com/attachments/abc/x.png')).toBe('/attachments/abc/x.png');
  });

  it('rejects anything else', () => {
    for (const bad of ['/incidents/1.json', 'https://cdn.example.com/logo.png', 'data:image/png;base64,AAAA',
      'javascript:alert(1)', '/attachments/../users.json', '', 42]) {
      expect(toAttachmentPath(bad)).toBeUndefined();
    }
  });
});

describe('collectIncidentAttachments', () => {
  it('finds attachments, comment attachments and inline images; ignores non-SWSD images', () => {
    const items = collectIncidentAttachments(INCIDENT);
    expect(items.map((a) => [a.ref, a.source])).toEqual([
      ['501', 'incident'],
      ['502', 'incident'],
      ['/attachments/aaa111/image001-jpg.jpeg', 'description_inline'],
      ['503', 'comment'],
      ['/attachments/ddd444/image002.png', 'comment_inline'],
    ]);
    expect(items.find((a) => a.ref === '503')?.comment_id).toBe(77);
  });

  it('de-duplicates the same path', () => {
    const items = collectIncidentAttachments({
      description: '<img src="/attachments/aaa/x.png"><img src="/attachments/aaa/x.png?thumb=true">',
    });
    expect(items).toHaveLength(1);
  });
});

describe('swsd_get_incident_attachment', () => {
  let client: FakeClient;
  let tool: RegisteredToolInternals;

  function register(env = {}): RegisteredToolInternals {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerGetIncidentAttachment(server, makeCtx(client, env));
    return getRegisteredTool(server, 'swsd_get_incident_attachment');
  }

  beforeEach(() => {
    client = makeFakeClient();
    client.setBodyForPath((p) => p === `/incidents/${String(INCIDENT_ID)}.json`, INCIDENT);
    tool = register();
  });

  it('lists attachments with layout=long and never exposes the download path', async () => {
    const result = (await tool.handler({ id: INCIDENT_ID }, {})) as ToolResult;

    const get = client.calls.find((c) => c.type === 'get');
    expect(get?.type === 'get' ? get.params : {}).toMatchObject({ layout: 'long' });
    const list = result.structuredContent?.attachments as Array<Record<string, unknown>>;
    expect(list).toHaveLength(5);
    expect(list[0]).toEqual({ ref: '501', filename: 'error.png', content_type: 'image/png', size: 2048, source: 'incident' });
    expect(JSON.stringify(result)).not.toContain('/attachments/bbb222/stream');
    expect(client.calls.some((c) => c.type === 'download')).toBe(false);
  });

  it('returns an image attachment as image content', async () => {
    client.setDownload((p) => p === '/attachments/bbb222/stream', {
      bytes: new Uint8Array([1, 2, 3]),
      contentType: 'image/png',
    });

    const result = (await tool.handler({ id: INCIDENT_ID, attachment: '501' }, {})) as ToolResult;

    expect(result.isError).toBeUndefined();
    const image = result.content.find((c) => c.type === 'image');
    expect(image).toEqual({ type: 'image', data: Buffer.from([1, 2, 3]).toString('base64'), mimeType: 'image/png' });
    expect(result.structuredContent?.attachment).toMatchObject({ ref: '501', content_type: 'image/png', size: 3 });
    const dl = client.calls.find((c) => c.type === 'download');
    expect(dl).toEqual({ type: 'download', path: '/attachments/bbb222/stream', maxBytes: 5 * 1024 * 1024 });
  });

  it('returns an inline image by its path ref (with or without the query)', async () => {
    client.setDownload((p) => p === '/attachments/aaa111/image001-jpg.jpeg', {
      bytes: new Uint8Array([9]),
      contentType: 'image/jpeg',
    });

    const result = (await tool.handler(
      { id: INCIDENT_ID, attachment: '/attachments/aaa111/image001-jpg.jpeg?thumb=true' },
      {},
    )) as ToolResult;

    expect(result.content.find((c) => c.type === 'image')).toMatchObject({ mimeType: 'image/jpeg' });
  });

  it('returns any other file as an embedded resource, whatever its type', async () => {
    client.setDownload((p) => p === '/attachments/eee555/stream', {
      bytes: new TextEncoder().encode('hello'),
      contentType: 'text/plain',
    });

    const result = (await tool.handler({ id: INCIDENT_ID, attachment: '503' }, {})) as ToolResult;

    const resource = result.content.find((c) => c.type === 'resource') as { resource: Record<string, unknown> };
    expect(resource.resource).toEqual({
      uri: `swsd://incidents/${String(INCIDENT_ID)}/attachments/503`,
      mimeType: 'text/plain',
      blob: Buffer.from('hello').toString('base64'),
    });
  });

  it('refuses a file whose listed size is over the limit without downloading it', async () => {
    const result = (await tool.handler({ id: INCIDENT_ID, attachment: '502' }, {})) as ToolResult;

    expect(result.isError).toBe(true);
    expect(String(result.content[0]?.text)).toContain('9.0 MB, over the 5.0 MB limit');
    expect(client.calls.some((c) => c.type === 'download')).toBe(false);
  });

  it('reports a download stopped by the size limit', async () => {
    client.setDownload((p) => p === '/attachments/aaa111/image001-jpg.jpeg', new SwsdTooLargeError(5 * 1024 * 1024));

    const result = (await tool.handler(
      { id: INCIDENT_ID, attachment: '/attachments/aaa111/image001-jpg.jpeg' },
      {},
    )) as ToolResult;

    expect(result.isError).toBe(true);
    expect(String(result.content[0]?.text)).toContain('larger than the 5.0 MB limit');
  });

  it('uses SWSD_MAX_ATTACHMENT_BYTES when set', async () => {
    tool = register({ SWSD_MAX_ATTACHMENT_BYTES: 1024 });

    const result = (await tool.handler({ id: INCIDENT_ID, attachment: '501' }, {})) as ToolResult;

    expect(result.isError).toBe(true);
    expect(String(result.content[0]?.text)).toContain('2.0 KB, over the 1.0 KB limit');
  });

  it('refuses a ref that is not on the incident (no download)', async () => {
    for (const ref of ['999', '/attachments/zzz999/stream', 'https://evil.example/attachments/bbb222/other']) {
      const result = (await tool.handler({ id: INCIDENT_ID, attachment: ref }, {})) as ToolResult;
      expect(result.isError).toBe(true);
    }
    expect(client.calls.some((c) => c.type === 'download')).toBe(false);
  });
});
