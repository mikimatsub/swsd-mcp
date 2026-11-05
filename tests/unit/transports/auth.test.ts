import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import { extractToken, AuthError } from '../../../src/transports/auth.js';

/**
 * `extractToken` reads two headers (`authorization` and `x-swsd-token`).
 * We mock the Express `Request` interface with just the `header()` method
 * the implementation actually uses — keeps tests fast and avoids pulling
 * in a real Express request object.
 */
function fakeReq(headers: Record<string, string | undefined>): Request {
  return {
    header(name: string): string | undefined {
      return headers[name.toLowerCase()];
    },
  } as unknown as Request;
}

describe('extractToken — Authorization: Bearer <token>', () => {
  it('extracts a simple bearer token', () => {
    const req = fakeReq({ authorization: 'Bearer abc123' });
    expect(extractToken(req)).toBe('abc123');
  });

  it('is case-insensitive on the Bearer prefix', () => {
    expect(extractToken(fakeReq({ authorization: 'bearer abc123' }))).toBe('abc123');
    expect(extractToken(fakeReq({ authorization: 'BEARER abc123' }))).toBe('abc123');
    expect(extractToken(fakeReq({ authorization: 'BeArEr abc123' }))).toBe('abc123');
  });

  it('trims trailing whitespace from the token', () => {
    expect(extractToken(fakeReq({ authorization: 'Bearer abc123   ' }))).toBe('abc123');
  });

  it('preserves internal characters (JWTs contain dots, hyphens, etc.)', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature-here';
    expect(extractToken(fakeReq({ authorization: `Bearer ${jwt}` }))).toBe(jwt);
  });

  it('does not match without a token after Bearer', () => {
    // Just "Bearer" with no token should fall through to xToken check, then error.
    expect(() => extractToken(fakeReq({ authorization: 'Bearer' }))).toThrow(AuthError);
    expect(() => extractToken(fakeReq({ authorization: 'Bearer ' }))).toThrow(AuthError);
    expect(() => extractToken(fakeReq({ authorization: 'Bearer    ' }))).toThrow(AuthError);
  });

  it('does not match a different scheme like Basic', () => {
    expect(() => extractToken(fakeReq({ authorization: 'Basic dXNlcjpwYXNz' }))).toThrow(
      AuthError,
    );
  });

  it('requires a single SP after Bearer (rejects tab/CR/LF separators per RFC 7235)', () => {
    // The pre-fix regex `/^Bearer\s+/` accepted any whitespace separator (tab,
    // newline, etc.). The linear-parse fix uses the literal "Bearer " prefix,
    // which is what RFC 7235 §2.1 actually mandates ("auth-scheme = token"
    // followed by SP). This test pins the (correct, stricter) behavior so a
    // future "be liberal in what you accept" refactor doesn't silently widen
    // the input surface back to whitespace classes.
    expect(() => extractToken(fakeReq({ authorization: 'Bearer\tabc123' }))).toThrow(
      AuthError,
    );
    expect(() => extractToken(fakeReq({ authorization: 'Bearer\nabc123' }))).toThrow(
      AuthError,
    );
  });

  it('handles a worst-case ReDoS payload in linear time', () => {
    // Pre-fix `/^Bearer\s+(.+)$/i` would backtrack catastrophically here.
    // Linear-time `startsWith + slice + trim` finishes in microseconds.
    const adversarial = 'Bearer ' + ' '.repeat(100_000);
    const start = Date.now();
    expect(() => extractToken(fakeReq({ authorization: adversarial }))).toThrow(AuthError);
    const elapsedMs = Date.now() - start;
    // Generous bound: linear-time string ops on 100k chars should finish in
    // well under 100ms even on a slow CI worker. Pre-fix regex would have
    // taken minutes (or hung indefinitely) on the same input.
    expect(elapsedMs).toBeLessThan(100);
  });
});

describe('extractToken — X-SWSD-Token fallback', () => {
  it('extracts from X-SWSD-Token when Authorization is absent', () => {
    expect(extractToken(fakeReq({ 'x-swsd-token': 'xyz789' }))).toBe('xyz789');
  });

  it('trims X-SWSD-Token', () => {
    expect(extractToken(fakeReq({ 'x-swsd-token': '  xyz789  ' }))).toBe('xyz789');
  });

  it('prefers Authorization over X-SWSD-Token when both are present', () => {
    const req = fakeReq({ authorization: 'Bearer auth-token', 'x-swsd-token': 'fallback' });
    expect(extractToken(req)).toBe('auth-token');
  });

  it('falls back to X-SWSD-Token if Authorization has wrong scheme', () => {
    const req = fakeReq({ authorization: 'Basic dXNlcjpwYXNz', 'x-swsd-token': 'fallback' });
    expect(extractToken(req)).toBe('fallback');
  });

  it('rejects empty / whitespace-only X-SWSD-Token', () => {
    expect(() => extractToken(fakeReq({ 'x-swsd-token': '' }))).toThrow(AuthError);
    expect(() => extractToken(fakeReq({ 'x-swsd-token': '   ' }))).toThrow(AuthError);
  });
});

describe('extractToken — error path', () => {
  it.each(['SYNTHETIC_TOKEN\nBAD', 'SYNTHETIC_TOKEN\t', 'SYNTHETIC TOKEN', 'SYNTHETIC_TOKEN\u007f'])('rejects whitespace and control characters without echoing the token (%j)', (token) => {
    for (const headers of [{ authorization: `Bearer ${token}` }, { 'x-swsd-token': token }]) {
      expect(() => extractToken(fakeReq(headers))).toThrow('Invalid SWSD token. Tokens must contain only visible ASCII characters without whitespace.');
    }
  });
  it('throws AuthError when no headers are present', () => {
    expect(() => extractToken(fakeReq({}))).toThrow(AuthError);
  });

  it('error message names both supported headers', () => {
    let thrown: AuthError | undefined;
    try {
      extractToken(fakeReq({}));
    } catch (e) {
      if (e instanceof AuthError) thrown = e;
    }
    expect(thrown?.message).toContain('Authorization: Bearer');
    expect(thrown?.message).toContain('X-SWSD-Token');
  });
});
