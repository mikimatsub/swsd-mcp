import type { Env } from '../config/env.js';
import { buildHeaders } from './headers.js';
import { serializeQuery } from './query.js';
import { extractPagination, type PaginationMeta } from './pagination.js';
import { SwsdDecodeError, SwsdHttpError, SwsdNetworkError, SwsdTooLargeError } from './errors.js';
import { redactValue } from '../utils/secrets.js';

export interface SwsdGetResult<T> {
  body: T;
  pagination: PaginationMeta;
  headers: Headers;
}

export interface SwsdRawResult {
  body: unknown;
  headers: Headers;
  status: number;
}

export interface SwsdRequestInit {
  method?: string;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface SwsdMutationResult<T> {
  body: T;
  headers: Headers;
  status: number;
}

export interface SwsdDownloadResult {
  bytes: Uint8Array;
  /** Media type from the response (parameters such as charset removed), or '' when absent. */
  contentType: string;
}

export interface SwsdClient {
  get<T = unknown>(path: string, params?: Record<string, unknown>): Promise<SwsdGetResult<T>>;
  post<T = unknown>(path: string, body: unknown): Promise<SwsdMutationResult<T>>;
  put<T = unknown>(path: string, body: unknown): Promise<SwsdMutationResult<T>>;
  delete<T = unknown>(path: string): Promise<SwsdMutationResult<T>>;
  rawRequest(path: string, init: SwsdRequestInit): Promise<SwsdRawResult>;
  /**
   * Download a binary file (an attachment) without decoding it as text. Throws
   * SwsdTooLargeError once the body exceeds `maxBytes`.
   */
  download(path: string, maxBytes: number): Promise<SwsdDownloadResult>;
}

export interface CreateClientOpts {
  env: Env;
  token: string;
}

const DEFAULT_PER_PAGE = 25;
const RETRY_BASE_DELAY_MS = 250;

export function createSwsdClient({ env, token }: CreateClientOpts): SwsdClient {
  const baseUrl = env.SWSD_BASE_URL.replace(/\/+$/, '');
  const maxRetries = env.SWSD_RETRY_MAX_ATTEMPTS;

  async function fetchWithRetry(
    url: string,
    init: RequestInit,
    retryable: boolean,
  ): Promise<Response> {
    let attempt = 0;
    let delay = RETRY_BASE_DELAY_MS;
    while (true) {
      try {
        // Per-request timeout via AbortSignal.timeout. If the call hangs,
        // fetch rejects with DOMException name "TimeoutError" — handled
        // by the catch below and retried for GET only.
        const res = await fetch(url, {
          ...init,
          signal: AbortSignal.timeout(env.SWSD_REQUEST_TIMEOUT_MS),
        });
        if (retryable && (res.status === 429 || res.status >= 500) && attempt < maxRetries) {
          const ra = res.headers.get('retry-after');
          const wait = ra ? Math.max(delay, parseRetryAfter(ra)) : delay;
          await sleep(wait);
          attempt++;
          delay *= 2;
          continue;
        }
        return res;
      } catch (e) {
        if (retryable && attempt < maxRetries) {
          await sleep(delay);
          attempt++;
          delay *= 2;
          continue;
        }
        throw new SwsdNetworkError(e, token);
      }
    }
  }

  async function rawRequest(path: string, init: SwsdRequestInit): Promise<SwsdRawResult> {
    const qs = init.query ? serializeQuery(init.query) : '';
    const url = `${baseUrl}${ensureLeadingSlash(path)}${qs ? `?${qs}` : ''}`;
    const method = (init.method ?? 'GET').toUpperCase();
    const isRetryable = method === 'GET';

    const isMultipart =
      typeof FormData !== 'undefined' && init.body instanceof FormData;
    const headers = buildHeaders(env, token, init.headers);
    if (isMultipart) {
      delete headers['Content-Type'];
    }

    const requestInit: RequestInit = {
      method,
      headers,
    };
    if (init.body !== undefined) {
      requestInit.body =
        typeof init.body === 'string' || isMultipart
          ? (init.body as RequestInit['body'])
          : JSON.stringify(init.body);
    }

    const res = await fetchWithRetry(url, requestInit, isRetryable);

    const contentType = res.headers.get('content-type') ?? '';
    const isJson = contentType.includes('application/json') || contentType.includes('+json');
    let body: unknown;
    try {
      const text = await res.text();
      // An empty body on a write is not a decode error: the write may already
      // have been applied, and failing it would invite a duplicate retry.
      // Reads must return a document, so an empty GET body still fails.
      const allowsEmpty = method !== 'GET' || res.status === 204 || res.status === 205;
      body = isJson ? text.trim() === '' && allowsEmpty ? null : JSON.parse(text) : text;
    } catch {
      // The request has already reached SWSD. Do not retry a decode failure,
      // or retain parse/body-read exceptions that may contain response data.
      if (res.ok) throw new SwsdDecodeError(res.status);
      throw new SwsdHttpError(res.status, 'Could not decode the SWSD error response.', res.headers.get('retry-after') ?? undefined);
    }

    if (!res.ok) {
      throw new SwsdHttpError(res.status, body, res.headers.get('retry-after') ?? undefined, token);
    }
    return { body: redactValue(body, token), headers: res.headers, status: res.status };
  }

  /**
   * Binary GET for attachments. SWSD answers inline-image paths with a 303 to a
   * pre-signed S3 URL, so redirects are followed manually: at most one hop, https
   * only, and WITHOUT SWSD headers (fetch would otherwise forward the
   * X-Samanage-Authorization token to the third-party host). The size limit is
   * enforced from Content-Length when present and again while streaming.
   */
  async function download(path: string, maxBytes: number): Promise<SwsdDownloadResult> {
    const headers = buildHeaders(env, token, { Accept: '*/*' });
    delete headers['Content-Type'];
    let res = await fetchWithRetry(
      `${baseUrl}${ensureLeadingSlash(path)}`,
      { method: 'GET', headers, redirect: 'manual' },
      true,
    );
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      await res.body?.cancel();
      const target = location ? safeRedirectTarget(location, baseUrl) : undefined;
      if (!target) throw new SwsdHttpError(res.status, 'Unsupported redirect for this download.');
      res = await fetchWithRetry(target, { method: 'GET', redirect: 'error' }, true);
    }
    if (!res.ok) {
      let body: unknown = '';
      try {
        body = await res.text();
      } catch {
        // keep the status; the body is optional detail
      }
      throw new SwsdHttpError(res.status, body, res.headers.get('retry-after') ?? undefined, token);
    }

    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await res.body?.cancel();
      throw new SwsdTooLargeError(maxBytes, declared);
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new SwsdTooLargeError(maxBytes);
        }
        chunks.push(value);
      }
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    return { bytes, contentType };
  }

  return {
    rawRequest,
    download,
    async get<T>(
      path: string,
      params: Record<string, unknown> = {},
    ): Promise<SwsdGetResult<T>> {
      const page = coerceInt(params.page, 1);
      const perPage = coerceInt(params.per_page, DEFAULT_PER_PAGE);
      const merged = { ...params, page, per_page: perPage };
      const { body, headers } = await rawRequest(path, { method: 'GET', query: merged });
      const bodyLength = Array.isArray(body) ? body.length : 1;
      const pagination = extractPagination(headers, page, perPage, bodyLength);
      return { body: body as T, pagination, headers };
    },
    async post<T>(path: string, body: unknown): Promise<SwsdMutationResult<T>> {
      const res = await rawRequest(path, { method: 'POST', body });
      return { body: res.body as T, headers: res.headers, status: res.status };
    },
    async delete<T>(path: string): Promise<SwsdMutationResult<T>> {
      const res = await rawRequest(path, { method: 'DELETE' });
      return { body: res.body as T, headers: res.headers, status: res.status };
    },
    async put<T>(path: string, body: unknown): Promise<SwsdMutationResult<T>> {
      const res = await rawRequest(path, { method: 'PUT', body });
      return { body: res.body as T, headers: res.headers, status: res.status };
    },
  };
}

function coerceInt(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n) && Number.isInteger(n)) return n;
  }
  return fallback;
}

/** An absolute https redirect target, or undefined. Relative targets resolve against the SWSD base URL. */
function safeRedirectTarget(location: string, baseUrl: string): string | undefined {
  try {
    const url = new URL(location, `${baseUrl}/`);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function ensureLeadingSlash(p: string): string {
  return p.startsWith('/') ? p : `/${p}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseRetryAfter(value: string): number {
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return 1000;
}
