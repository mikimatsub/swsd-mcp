import type { CallToolResult } from '@modelcontextprotocol/server';
import { toolError } from '../mcp/errors.js';
import { InputError } from '../utils/idResolver.js';

export class SwsdHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    public readonly retryAfter?: string,
  ) {
    super(`SWSD HTTP ${status}`);
    this.name = 'SwsdHttpError';
  }
}

export class SwsdNetworkError extends Error {
  constructor(cause: unknown) {
    super(
      `SWSD network error: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.name = 'SwsdNetworkError';
  }
}

export function mapSwsdError(err: unknown): CallToolResult {
  if (err instanceof SwsdHttpError) return mapHttpError(err);
  if (err instanceof SwsdNetworkError) {
    return toolError(
      `Network error contacting SWSD: ${err.cause instanceof Error ? err.cause.message : 'unknown'}.`,
      'Check SWSD_BASE_URL, your network connection, and tenant region (US vs EU).',
    );
  }
  if (err instanceof InputError) {
    // InputError messages are already user-friendly (e.g. "No incident found
    // with number 99999 in this tenant. ..."). No "Unexpected error:" prefix —
    // the resolver throws this for legitimate user-input failures, not bugs.
    return toolError(err.message);
  }
  if (err instanceof Error) return toolError(`Unexpected error: ${err.message}`);
  return toolError(`Unexpected error: ${String(err)}`);
}

function mapHttpError(err: SwsdHttpError): CallToolResult {
  const body = bodyToString(err.body);
  switch (err.status) {
    case 400:
      return toolError(`Bad request to SWSD: ${body}`);
    case 401:
      return toolError(
        'Unauthorized.',
        'Check that the SWSD token is valid and forwarded correctly via Authorization or X-SWSD-Token header.',
      );
    case 403:
      return toolError(
        'Forbidden.',
        'The SWSD user for this token lacks permission for this action.',
      );
    case 404: {
      const detail = body.trim().replace(/^"|"$/g, '');
      const isGeneric = !detail || detail.toLowerCase() === 'not found';
      return isGeneric
        ? toolError(
            'Not found.',
            'The requested resource does not exist or is not visible to this token.',
          )
        : toolError(`Not found: ${detail}`);
    }
    case 422: {
      const flattened = flatten422(err.body);
      return toolError(`Validation failed:\n${flattened}`, 'Fix the listed fields and retry.');
    }
    case 429: {
      const ra = err.retryAfter ? ` Retry-After: ${err.retryAfter}.` : '';
      return toolError(
        `Rate limited (429).${ra}`,
        'Slow down and retry after the indicated interval.',
      );
    }
    default:
      if (err.status >= 500) {
        return toolError(
          `SWSD server error (${err.status}): ${body}`,
          'Transient — retry after a brief pause if the call is idempotent.',
        );
      }
      return toolError(`SWSD HTTP ${err.status}: ${body}`);
  }
}

function bodyToString(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object') {
    try {
      return JSON.stringify(body);
    } catch {
      return String(body);
    }
  }
  return String(body);
}

/**
 * SWSD 422 commonly returns either { errors: { field: [messages] } } or
 * { field: [messages] } directly. Both shapes flatten to "field: message" lines.
 */
function flatten422(body: unknown): string {
  if (!body || typeof body !== 'object') return String(body);
  const obj = body as Record<string, unknown>;
  const fields =
    obj.errors && typeof obj.errors === 'object'
      ? (obj.errors as Record<string, unknown>)
      : (obj as Record<string, unknown>);

  const lines: string[] = [];
  for (const [field, messages] of Object.entries(fields)) {
    if (Array.isArray(messages)) {
      for (const m of messages) lines.push(`  ${field}: ${String(m)}`);
    } else if (typeof messages === 'string') {
      lines.push(`  ${field}: ${messages}`);
    }
  }
  return lines.length > 0 ? lines.join('\n') : JSON.stringify(body);
}
