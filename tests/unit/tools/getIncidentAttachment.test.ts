import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it, vi } from 'vitest';
import { EnvSchema } from '../../../src/config/env.js';
import { GetIncidentAttachmentInput } from '../../../src/schemas/attachment.js';
import { collectIncidentAttachments, rasterImageType } from '../../../src/swsd/incidentAttachments.js';
import { SwsdHttpError } from '../../../src/swsd/errors.js';
import { registerGetIncidentAttachment } from '../../../src/tools/attachments/getIncidentAttachment.js';
import { getRegisteredTool, makeCtx, makeFakeClient } from './_helpers/mockClient.js';

const incident = { attachments: [{ url: '/attachments/key/stream', filename: 'test.pdf', content_type: 'application/pdf' }], description: '<img src="/attachments/image/a.png?thumb=true"><img data-src="/attachments/ignored/file"><img src=https://evil.test/attachments/key/file>' };
function setup() {
  const client = makeFakeClient();
  client.setBodyForPath(p => p === '/incidents/123456789.json', incident);
  const server = new McpServer({ name: 'test', version: '0' });
  registerGetIncidentAttachment(server, { ...makeCtx(client, EnvSchema.parse({ SWSD_WRITE_MODE: 'disabled' })), token: 'SYNTHETIC_TOKEN' });
  return { client, call: (input: unknown) => getRegisteredTool(server, 'swsd_get_incident_attachment').handler(input, {}) as Promise<{ isError?: boolean; structuredContent: { attachments: Array<{ ref: string; source: string }> }; content: Array<Record<string, unknown>> }> };
}
describe('incident attachment tool', () => {
  it('lists without downloading, with opaque stable refs scoped to incident and credential', async () => {
    const { client, call } = setup(); const download = vi.spyOn(client, 'download');
    const out = await call({ id: 123456789 });
    expect(out.structuredContent.attachments).toHaveLength(2);
    expect(out.structuredContent.attachments[0]?.ref).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(out)).not.toContain('/attachments/key/stream');
    expect(download).not.toHaveBeenCalled();
    expect(collectIncidentAttachments(incident, [], 123456789, 'SYNTHETIC_TOKEN')[0]?.ref).toBe(out.structuredContent.attachments[0]?.ref);
    expect(collectIncidentAttachments(incident, [], 123456788, 'SYNTHETIC_TOKEN')[0]?.ref).not.toBe(out.structuredContent.attachments[0]?.ref);
    expect(collectIncidentAttachments(incident, [], 123456789, 'DIFFERENT_TOKEN')[0]?.ref).not.toBe(out.structuredContent.attachments[0]?.ref);
  });
  it('returns a PDF resource and rejects a ref not present on the incident', async () => {
    const { client, call } = setup();
    const download = vi.spyOn(client, 'download').mockResolvedValue({ bytes: Buffer.from('%PDF-test'), contentType: 'application/pdf' });
    const listed = await call({ id: 123456789 });
    const out = await call({ id: 123456789, ref: listed.structuredContent.attachments[0]?.ref });
    expect(out.content.at(-1)).toMatchObject({ type: 'resource', resource: { mimeType: 'application/pdf', blob: Buffer.from('%PDF-test').toString('base64') } });
    expect((await call({ id: 123456789, ref: 'a'.repeat(64) })).isError).toBe(true);
    expect(download).toHaveBeenCalledTimes(1);
  });
  it('detects raster bytes rather than trusting a supplied image media type', () => {
    expect(rasterImageType(Buffer.from([137,80,78,71,13,10,26,10]))).toBe('image/png');
    expect(rasterImageType(Buffer.from([255,216,255]))).toBe('image/jpeg');
    expect(rasterImageType(Buffer.from('GIF89a'))).toBe('image/gif');
    expect(rasterImageType(Buffer.from('RIFFxxxxWEBP'))).toBe('image/webp');
    expect(rasterImageType(Buffer.from('<svg onload="evil"/>'))).toBeUndefined();
  });
  it('returns raster images as MCP image blocks and SVG as an opaque resource', async () => {
    const { client, call } = setup();
    const download = vi.spyOn(client, 'download').mockResolvedValueOnce({ bytes: Buffer.from([255,216,255]), contentType: 'application/octet-stream' })
      .mockResolvedValueOnce({ bytes: Buffer.from('<svg/>'), contentType: 'image/svg+xml' });
    const ref = (await call({ id: 123456789 })).structuredContent.attachments[0]?.ref;
    expect((await call({ id: 123456789, ref })).content.at(-1)).toMatchObject({ type: 'image', mimeType: 'image/jpeg' });
    expect((await call({ id: 123456789, ref })).content.at(-1)).toMatchObject({ type: 'resource', resource: { mimeType: 'application/octet-stream' } });
    expect(download).toHaveBeenCalledTimes(2);
  });
  it('fetches later comment pages and deduplicates inline paths with thumbnail flags', async () => {
    const { client, call } = setup();
    const original = client.get;
    vi.spyOn(client, 'get').mockImplementation(async <T>(path: string, params?: Record<string, unknown>) => {
      if (!path.endsWith('/comments.json')) return original<T>(path, params);
      return { body: (params?.page === 1 ? [] : [{ id: 99, body: '<IMG SRC=&#47;attachments/comment/c.png><img src="/attachments/image/a.png">' }]) as T,
        headers: new Headers(), pagination: { page: Number(params?.page), per_page: 100, has_more: params?.page === 1 } };
    });
    const out = await call({ id: 123456789 });
    expect(out.structuredContent.attachments).toHaveLength(3);
    expect(out.structuredContent.attachments.at(-1)).toMatchObject({ source: 'comment_inline', comment_id: 99 });
  });
  it('rejects arbitrary URLs and overlong references at the schema boundary', () => {
    for (const ref of ['https://evil.test', '/attachments/key/stream', 'a'.repeat(65)]) {
      expect(GetIncidentAttachmentInput.safeParse({ id: 123456789, ref }).success).toBe(false);
    }
  });
  it('requires incident access before listing or downloading', async () => {
    const { client, call } = setup();
    vi.spyOn(client, 'get').mockRejectedValue(new SwsdHttpError(403, 'Forbidden'));
    const download = vi.spyOn(client, 'download');
    expect(await call({ id: 123456789, ref: 'a'.repeat(64) })).toMatchObject({ isError: true });
    expect(download).not.toHaveBeenCalled();
  });
  it('refuses oversized metadata before downloading', async () => {
    const { client, call } = setup();
    vi.spyOn(client, 'get').mockImplementation(async <T>(path: string) => ({
      body: (path.endsWith('/comments.json') ? [] : { attachments: [{ url: '/attachments/key/stream', size: 6 * 1024 * 1024 }] }) as T,
      headers: new Headers(), pagination: { page: 1, per_page: 100, has_more: false },
    }));
    const download = vi.spyOn(client, 'download');
    const ref = (await call({ id: 123456789 })).structuredContent.attachments[0]?.ref;
    expect(await call({ id: 123456789, ref })).toMatchObject({ isError: true });
    expect(download).not.toHaveBeenCalled();
  });
  it('rejects incomplete or malformed comment scans instead of claiming a complete list', async () => {
    const { client, call } = setup();
    const original = client.get;
    vi.spyOn(client, 'get').mockImplementation(async <T>(path: string, params?: Record<string, unknown>) => {
      if (!path.endsWith('/comments.json')) return original<T>(path, params);
      return { body: [] as T, headers: new Headers(), pagination: { page: 1, per_page: 100, has_more: true, next_page: 1 } };
    });
    expect(await call({ id: 123456789 })).toMatchObject({ isError: true });
  });
});
