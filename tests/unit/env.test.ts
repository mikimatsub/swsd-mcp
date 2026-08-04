import { describe, it, expect } from 'vitest';
import { EnvSchema } from '../../src/config/env.js';

describe('EnvSchema SWSD_BASE_URL allowlist (SSRF defense)', () => {
  it('accepts the default api.samanage.com', () => {
    const r = EnvSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.SWSD_BASE_URL).toBe('https://api.samanage.com');
  });

  it('accepts the EU regional base apieu.samanage.com', () => {
    const r = EnvSchema.safeParse({ SWSD_BASE_URL: 'https://apieu.samanage.com' });
    expect(r.success).toBe(true);
  });

  it('accepts samanage.com itself (apex domain)', () => {
    const r = EnvSchema.safeParse({ SWSD_BASE_URL: 'https://samanage.com' });
    expect(r.success).toBe(true);
  });

  it('rejects an arbitrary host', () => {
    const r = EnvSchema.safeParse({ SWSD_BASE_URL: 'https://evil.example.com' });
    expect(r.success).toBe(false);
  });

  it('rejects subdomain confusion (samanage.com as a subdomain of evil)', () => {
    const r = EnvSchema.safeParse({ SWSD_BASE_URL: 'https://samanage.com.evil.com' });
    expect(r.success).toBe(false);
  });

  it('rejects look-alike domain (samanagex.com)', () => {
    const r = EnvSchema.safeParse({ SWSD_BASE_URL: 'https://api.samanagex.com' });
    expect(r.success).toBe(false);
  });

  it('rejects malformed URLs', () => {
    const r = EnvSchema.safeParse({ SWSD_BASE_URL: 'not-a-url' });
    expect(r.success).toBe(false);
  });
});

describe('EnvSchema SWSD_TRUST_PROXY transform', () => {
  it('parses "true" / "false" as booleans', () => {
    const t = EnvSchema.safeParse({ SWSD_TRUST_PROXY: 'true' });
    const f = EnvSchema.safeParse({ SWSD_TRUST_PROXY: 'false' });
    expect(t.success && t.data.SWSD_TRUST_PROXY).toBe(true);
    expect(f.success && f.data.SWSD_TRUST_PROXY).toBe(false);
  });

  it('parses non-negative integers as hop counts', () => {
    const r = EnvSchema.safeParse({ SWSD_TRUST_PROXY: '1' });
    expect(r.success && r.data.SWSD_TRUST_PROXY).toBe(1);
  });

  it('passes string IP/cidr values through', () => {
    const r = EnvSchema.safeParse({ SWSD_TRUST_PROXY: 'loopback' });
    expect(r.success && r.data.SWSD_TRUST_PROXY).toBe('loopback');
  });

  it('defaults to false when unset', () => {
    const r = EnvSchema.safeParse({});
    expect(r.success && r.data.SWSD_TRUST_PROXY).toBe(false);
  });
});

describe('EnvSchema rate limit + timeout defaults', () => {
  it('defaults rate limit to 100 per 60s and timeout to 30s', () => {
    const r = EnvSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.SWSD_RATE_LIMIT_MAX).toBe(100);
      expect(r.data.SWSD_RATE_LIMIT_WINDOW_MS).toBe(60_000);
      expect(r.data.SWSD_REQUEST_TIMEOUT_MS).toBe(30_000);
    }
  });

  it('coerces numeric strings', () => {
    const r = EnvSchema.safeParse({
      SWSD_RATE_LIMIT_MAX: '500',
      SWSD_REQUEST_TIMEOUT_MS: '15000',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.SWSD_RATE_LIMIT_MAX).toBe(500);
      expect(r.data.SWSD_REQUEST_TIMEOUT_MS).toBe(15000);
    }
  });

  it('rejects rate limit max above bound', () => {
    const r = EnvSchema.safeParse({ SWSD_RATE_LIMIT_MAX: '999999999' });
    expect(r.success).toBe(false);
  });

  it('rejects timeout below minimum (1s)', () => {
    const r = EnvSchema.safeParse({ SWSD_REQUEST_TIMEOUT_MS: '500' });
    expect(r.success).toBe(false);
  });
});

describe('EnvSchema SWSD_ATTACHMENT_ROOT', () => {
  it('is optional and trims a configured root', () => {
    const unset = EnvSchema.safeParse({});
    const configured = EnvSchema.safeParse({ SWSD_ATTACHMENT_ROOT: '  C:\\safe-attachments  ' });

    expect(unset.success && unset.data.SWSD_ATTACHMENT_ROOT).toBeUndefined();
    expect(configured.success && configured.data.SWSD_ATTACHMENT_ROOT).toBe('C:\\safe-attachments');
  });

  it('treats an explicitly empty root as unset and rejects an oversized root', () => {
    const empty = EnvSchema.safeParse({ SWSD_ATTACHMENT_ROOT: '   ' });
    expect(empty.success && empty.data.SWSD_ATTACHMENT_ROOT).toBeUndefined();
    expect(EnvSchema.safeParse({ SWSD_ATTACHMENT_ROOT: 'x'.repeat(4_097) }).success).toBe(false);
  });
});
