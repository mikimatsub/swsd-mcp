import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnvSchema, type Env } from '../../../src/config/env.js';
import { createSwsdClient } from '../../../src/swsd/client.js';
import { SwsdHttpError, SwsdTooLargeError } from '../../../src/swsd/errors.js';

function makeEnv(): Env {
  return EnvSchema.parse({
    SWSD_BASE_URL: 'https://api.samanage.com/',
    SWSD_RETRY_MAX_ATTEMPTS: 0,
    SWSD_REQUEST_TIMEOUT_MS: 5_000,
  });
}

const TOKEN = 'synthetic-download-token';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

function headersOf(init: RequestInit | undefined): Record<string, string> {
  return (init?.headers ?? {}) as Record<string, string>;
}

describe('SwsdClient.download', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns the bytes and media type without decoding them as text', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(PNG, { status: 200, headers: { 'content-type': 'image/png; charset=binary' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = createSwsdClient({ env: makeEnv(), token: TOKEN });

    const result = await client.download('/attachments/abc123/stream', 1024);

    expect([...result.bytes]).toEqual([...PNG]);
    expect(result.contentType).toBe('image/png');
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.samanage.com/attachments/abc123/stream');
    expect(init?.redirect).toBe('manual');
    expect(headersOf(init)['X-Samanage-Authorization']).toBe(`Bearer ${TOKEN}`);
    expect(headersOf(init)['Content-Type']).toBeUndefined();
  });

  it('follows one https redirect WITHOUT sending the SWSD token to the other host', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, {
        status: 303,
        headers: { location: 'https://s3.example.com/bucket/image001.jpeg?X-Amz-Signature=abc' },
      }))
      .mockResolvedValueOnce(new Response(PNG, { status: 200, headers: { 'content-type': 'image/jpeg' } }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createSwsdClient({ env: makeEnv(), token: TOKEN });

    const result = await client.download('/attachments/abc123/image001-jpg.jpeg', 1024);

    expect(result.contentType).toBe('image/jpeg');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1] ?? [];
    expect(url).toBe('https://s3.example.com/bucket/image001.jpeg?X-Amz-Signature=abc');
    expect(JSON.stringify(init ?? {})).not.toContain(TOKEN);
    expect(init?.headers).toBeUndefined();
    expect(init?.redirect).toBe('error');
  });

  it('refuses a non-https redirect', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'http://insecure.example.com/file' } }),
    ));
    const client = createSwsdClient({ env: makeEnv(), token: TOKEN });

    await expect(client.download('/attachments/abc123/x.png', 1024)).rejects.toBeInstanceOf(SwsdHttpError);
  });

  it('refuses before reading when Content-Length is over the limit', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(
      new Response(PNG, { status: 200, headers: { 'content-type': 'image/png', 'content-length': '9999' } }),
    ));
    const client = createSwsdClient({ env: makeEnv(), token: TOKEN });

    const err = await client.download('/attachments/abc123/stream', 1024).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SwsdTooLargeError);
    expect((err as SwsdTooLargeError).sizeBytes).toBe(9999);
  });

  it('stops streaming once the body passes the limit (no Content-Length)', async () => {
    const big = new Uint8Array(4096);
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(big);
          controller.enqueue(big);
          controller.close();
        },
      }), { status: 200, headers: { 'content-type': 'application/pdf' } }),
    ));
    const client = createSwsdClient({ env: makeEnv(), token: TOKEN });

    await expect(client.download('/attachments/abc123/stream', 5000)).rejects.toBeInstanceOf(SwsdTooLargeError);
  });

  it('maps an HTTP error to SwsdHttpError with the status', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('Not Found', { status: 404 })));
    const client = createSwsdClient({ env: makeEnv(), token: TOKEN });

    const err = await client.download('/attachments/missing/stream', 1024).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SwsdHttpError);
    expect((err as SwsdHttpError).status).toBe(404);
  });
});
