import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnvSchema, type Env } from '../../../src/config/env.js';
import { createSwsdClient } from '../../../src/swsd/client.js';
import { SwsdNetworkError } from '../../../src/swsd/errors.js';
import type { SwsdHttpError } from '../../../src/swsd/errors.js';

function makeEnv(overrides: Record<string, string | number> = {}): Env {
  return EnvSchema.parse({
    SWSD_BASE_URL: 'https://api.samanage.com/',
    SWSD_RETRY_MAX_ATTEMPTS: 0,
    SWSD_REQUEST_TIMEOUT_MS: 5_000,
    ...overrides,
  });
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(body), { ...init, headers });
}

describe('createSwsdClient request boundary', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('builds an authenticated GET with encoded query values and pagination defaults', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse([{ id: 1 }], {
        status: 200,
        headers: { 'x-total-count': '1' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = createSwsdClient({ env: makeEnv(), token: 'tenant-token' });

    const result = await client.get('incidents.json', { query: 'printer & scanner' });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      'https://api.samanage.com/incidents.json?query=printer%20%26%20scanner&page=1&per_page=25',
    );
    expect(init).toMatchObject({ method: 'GET' });
    expect(init?.headers).toMatchObject({
      'X-Samanage-Authorization': 'Bearer tenant-token',
      Accept: 'application/vnd.samanage.v2.1+json',
      'Content-Type': 'application/json',
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(result.body).toEqual([{ id: 1 }]);
    expect(result.pagination).toMatchObject({ page: 1, per_page: 25, total: 1 });
  });

  it('serializes JSON writes and does not retry non-idempotent requests', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ error: 'temporary' }, { status: 503 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = createSwsdClient({
      env: makeEnv({ SWSD_RETRY_MAX_ATTEMPTS: 3 }),
      token: 'tenant-token',
    });

    await expect(client.post('/incidents.json', { incident: { name: 'Printer' } })).rejects.toEqual(
      expect.objectContaining<SwsdHttpError>({ status: 503, body: { error: 'temporary' } }),
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ incident: { name: 'Printer' } }),
    });
  });

  it('preserves multipart bodies while letting fetch set the content type boundary', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ id: 4 }, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createSwsdClient({ env: makeEnv(), token: 'tenant-token' });
    const form = new FormData();
    form.set('file[attachment]', new Blob(['evidence']), 'evidence.txt');

    await client.rawRequest('/attachments.json', { method: 'POST', body: form });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.body).toBe(form);
    expect(init?.headers).not.toHaveProperty('Content-Type');
  });

  it('retries idempotent 5xx responses and returns the later success', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse([{ id: 2 }], { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createSwsdClient({
      env: makeEnv({ SWSD_RETRY_MAX_ATTEMPTS: 1 }),
      token: 'tenant-token',
    });

    const request = client.get('/incidents.json');
    await vi.runAllTimersAsync();

    await expect(request).resolves.toMatchObject({ body: [{ id: 2 }] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('wraps a terminal fetch failure as SwsdNetworkError after bounded retries', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('ECONNRESET'));
    vi.stubGlobal('fetch', fetchMock);
    const client = createSwsdClient({
      env: makeEnv({ SWSD_RETRY_MAX_ATTEMPTS: 1 }),
      token: 'tenant-token',
    });

    const request = client.get('/incidents.json');
    const rejection = expect(request).rejects.toBeInstanceOf(SwsdNetworkError);
    await vi.runAllTimersAsync();

    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns plain-text success bodies and normalizes invalid JSON to null', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('accepted', { status: 202 }))
      .mockResolvedValueOnce(
        new Response('{invalid', {
          status: 200,
          headers: { 'content-type': 'application/problem+json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const client = createSwsdClient({ env: makeEnv(), token: 'tenant-token' });

    await expect(client.rawRequest('/plain', { method: 'HEAD' })).resolves.toMatchObject({
      body: 'accepted',
      status: 202,
    });
    await expect(client.rawRequest('/invalid-json', { method: 'GET' })).resolves.toMatchObject({
      body: null,
      status: 200,
    });
  });

  it('supports PUT and string request bodies without double encoding', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ id: 7 }, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createSwsdClient({ env: makeEnv(), token: 'tenant-token' });

    const result = await client.put('/changes/7.json', { change: { state: 'Approved' } });
    expect(result).toMatchObject({ body: { id: 7 }, status: 200 });

    await client.rawRequest('/raw', { method: 'POST', body: 'already-encoded' });
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe('already-encoded');
  });
});
