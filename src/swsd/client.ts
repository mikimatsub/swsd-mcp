import type { Env } from '../config/env.js';
import { buildHeaders } from './headers.js';
import { serializeQuery } from './query.js';
import { extractPagination, type PaginationMeta } from './pagination.js';
import { SwsdHttpError, SwsdNetworkError } from './errors.js';

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

export interface SwsdClient {
  get<T = unknown>(path: string, params?: Record<string, unknown>): Promise<SwsdGetResult<T>>;
  post<T = unknown>(path: string, body: unknown): Promise<SwsdMutationResult<T>>;
  put<T = unknown>(path: string, body: unknown): Promise<SwsdMutationResult<T>>;
  rawRequest(path: string, init: SwsdRequestInit): Promise<SwsdRawResult>;
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
        // by the catch below and retried for idempotent methods.
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
        throw new SwsdNetworkError(e);
      }
    }
  }

  async function rawRequest(path: string, init: SwsdRequestInit): Promise<SwsdRawResult> {
    const qs = init.query ? serializeQuery(init.query) : '';
    const url = `${baseUrl}${ensureLeadingSlash(path)}${qs ? `?${qs}` : ''}`;
    const method = (init.method ?? 'GET').toUpperCase();
    const isRetryable = method === 'GET' || method === 'HEAD';

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
    if (isJson) {
      body = await res.json().catch(() => null);
    } else {
      body = await res.text().catch(() => '');
    }

    if (!res.ok) {
      throw new SwsdHttpError(res.status, body, res.headers.get('retry-after') ?? undefined);
    }
    return { body, headers: res.headers, status: res.status };
  }

  return {
    rawRequest,
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
