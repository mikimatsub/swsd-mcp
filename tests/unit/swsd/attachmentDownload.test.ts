import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnvSchema } from '../../../src/config/env.js';
import { attachmentPath, downloadAttachment, isAttachmentStorageUrl } from '../../../src/swsd/attachmentDownload.js';

const env = EnvSchema.parse({ SWSD_REQUEST_TIMEOUT_MS: 1000 });
const path = '/attachments/opaque-key/screenshot.png';
afterEach(() => vi.unstubAllGlobals());
describe('attachment download boundary', () => {
  it.each(['https://s3.us-east-1.amazonaws.com/a', 'https://s3.eu-west-1.amazonaws.com/a', 'https://bucket.s3.eu-central-1.amazonaws.com/a'])('accepts approved regional S3 service endpoints: %s', value => {
    expect(isAttachmentStorageUrl(new URL(value))).toBe(true);
  });
  it.each(['//evil.test/attachments/key/file', 'https://evil.test/attachments/key/file', '/attachments/key/%2e%2e/users', '/attachments/key/a%2fb', '/attachments/key/%252e%252e', '/attachments/key/a\\b', 'https://api.samanage.com:444/attachments/key/file', 'https://user@api.samanage.com/attachments/key/file'])('rejects unsafe source %s', value => {
    expect(attachmentPath(value)).toBeUndefined();
  });
  it('accepts encoded filenames and removes thumbnail queries', () => {
    expect(attachmentPath('https://tenant.samanage.com/attachments/key/my%20file.png?thumb=true')).toBe('/attachments/key/my%20file.png');
  });
  it('follows exactly one S3 redirect with no credential headers', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 303, headers: { location: 'https://s3.us-east-1.amazonaws.com/bucket/file?signature=private' } }))
      .mockResolvedValueOnce(new Response('abc', { headers: { 'content-type': 'application/pdf; charset=utf-8' } }));
    vi.stubGlobal('fetch', fetcher);
    expect(await downloadAttachment(env, 'SYNTHETIC_TOKEN', path, 3)).toMatchObject({ contentType: 'application/pdf', bytes: new Uint8Array([97, 98, 99]) });
    expect(fetcher.mock.calls[0]?.[1].headers['X-Samanage-Authorization']).toBe('Bearer SYNTHETIC_TOKEN');
    expect(fetcher.mock.calls[1]?.[1]).not.toHaveProperty('headers');
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ redirect: 'manual', credentials: 'omit' });
  });
  it.each(['https://127.0.0.1/file', 'https://169.254.169.254/file', 'http://s3.amazonaws.com/file', 'https://s3.amazonaws.com.evil.test/file', 'https://evil.test/file', 'https://user:pass@s3.amazonaws.com/file', 'https://s3.amazonaws.com:444/file', '/relative', 'https://api.samanage.com/other'])('refuses redirect %s before a second request', async location => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 303, headers: { location } }));
    vi.stubGlobal('fetch', fetcher);
    await expect(downloadAttachment(env, 'SYNTHETIC_TOKEN', path, 10)).rejects.toThrow('approved');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('refuses a second redirect without reading its body or leaking its location', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 303, headers: { location: 'https://s3.amazonaws.com/a' } }))
      .mockResolvedValueOnce(new Response('SECRET', { status: 302, headers: { location: 'https://internal.test/' } }));
    vi.stubGlobal('fetch', fetcher);
    await expect(downloadAttachment(env, 'SYNTHETIC_TOKEN', path, 10)).rejects.toThrow('HTTP 302');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([true, false])('enforces the byte limit with declared length=%s', async declared => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('12345', { headers: declared ? { 'content-length': '5' } : {} })));
    await expect(downloadAttachment(env, 'SYNTHETIC_TOKEN', path, 4)).rejects.toThrow('exceeds');
  });
  it('does not expose signed URLs in network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('https://s3.amazonaws.com/a?signature=SECRET')));
    await expect(downloadAttachment(env, 'SYNTHETIC_TOKEN', path, 10)).rejects.toThrow('failed or timed out');
  });
  it('bounds a stalled download including its body', async () => {
    vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('signed URL'))))));
    await expect(downloadAttachment({ ...env, SWSD_REQUEST_TIMEOUT_MS: 10 }, 'SYNTHETIC_TOKEN', path, 10)).rejects.toThrow('timed out');
  });
  it('validates byte limits before network I/O', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(downloadAttachment(env, 'SYNTHETIC_TOKEN', path, NaN)).rejects.toThrow('limit');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
