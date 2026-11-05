import type { Request } from 'express';
import { INVALID_TOKEN_MESSAGE, isValidToken } from '../utils/secrets.js';

const BEARER_PREFIX = 'Bearer ';

function normalizeToken(value: string): string | undefined {
  if ([...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) > 126)) return undefined;
  const token = value.trim();
  return isValidToken(token) ? token : undefined;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Extract the SWSD token from an HTTP request.
 *
 * Implementation note: this is hot-path code (runs on every HTTP request) and
 * the input is fully attacker-controlled. We deliberately avoid regular
 * expressions on the Authorization header. A polynomial-backtracking regex
 * (e.g. `/^Bearer\s+(.+)$/i` with greedy `\s+` that overlaps `(.+)` because
 * `.` matches whitespace) lets an attacker tie up a worker thread by sending
 * `Bearer ` followed by many spaces — see CodeQL `js/polynomial-redos`.
 *
 * Linear-time parsing:
 *   1. Case-insensitive prefix check (slice + toLowerCase, both O(n))
 *   2. Reject control characters and trim surrounding spaces once (O(n))
 *   3. Reject embedded whitespace and empty tokens (so `Bearer    ` errors out
 *      cleanly rather than passing an empty string downstream).
 */
export function parseToken(req: Request): string | undefined {
  const auth = req.header('authorization');
  if (auth) {
    // Case-insensitive prefix match without regex backtracking risk.
    if (auth.length > BEARER_PREFIX.length &&
        auth.slice(0, BEARER_PREFIX.length).toLowerCase() === BEARER_PREFIX.toLowerCase()) {
      const token = normalizeToken(auth.slice(BEARER_PREFIX.length));
      if (token) return token;
    }
  }

  // Fallback: X-SWSD-Token (for Copilot custom connectors that can't preserve Authorization)
  const xToken = req.header('x-swsd-token');
  if (xToken) {
    return normalizeToken(xToken);
  }

  return undefined;
}

export function extractToken(req: Request): string {
  const token = parseToken(req);
  if (token) return token;
  if (req.header('authorization') || req.header('x-swsd-token')) {
    throw new AuthError(INVALID_TOKEN_MESSAGE);
  }

  throw new AuthError(
    'Missing token. Provide either "Authorization: Bearer <token>" or "X-SWSD-Token: <token>" header.',
  );
}
