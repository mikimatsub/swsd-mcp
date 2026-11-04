import { describe, it, expect, beforeEach } from 'vitest';
import { loadUiResource, _resetCacheForTests } from '../../../src/mcp/uiResources.js';

describe('loadUiResource — happy path', () => {
  beforeEach(() => _resetCacheForTests());

  it('reads a UI bundle from dist/ui/<name>.html and caches it', () => {
    // dist/ui/incident-detail.html is produced by `npm run build:ui` (run before tests in CI).
    const html = loadUiResource('incident-detail');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('SWSD Incident');
  });

  it('caches reads (second call returns the same string reference)', () => {
    const a = loadUiResource('incident-detail');
    const b = loadUiResource('incident-detail');
    expect(a).toBe(b);
  });

  it('accepts every allowlisted slug', () => {
    // Each UI bundle must load without
    // error — drift here means a tool will fail at startup.
    for (const slug of ['incident-detail', 'solution-detail', 'incident-list', 'custom-fields', 'comment-thread', 'audit-timeline', 'catalog-item-form', 'change-calendar']) {
      expect(() => loadUiResource(slug)).not.toThrow();
    }
  });
});

describe('loadUiResource — allowlist guard (path-injection defense)', () => {
  beforeEach(() => _resetCacheForTests());

  it('rejects an unknown slug with a clear allowlist-error message', () => {
    expect(() => loadUiResource('does-not-exist')).toThrow(
      /UI resource name "does-not-exist" is not in the allowlist/,
    );
  });

  it('rejects path-traversal payloads before any filesystem call', () => {
    // The closed allowlist runs before path resolution, so traversal payloads
    // like these never touch the filesystem regardless of the resolved path
    // they would have produced.
    const traversals = [
      '../../etc/passwd',
      '../../../tmp/secrets',
      '/etc/passwd',
      '..\\..\\Windows\\System32\\drivers\\etc\\hosts',
      'incident-detail/../../../etc/passwd',
    ];
    for (const payload of traversals) {
      expect(() => loadUiResource(payload)).toThrow(/not in the allowlist/);
    }
  });

  it('rejects an empty string', () => {
    expect(() => loadUiResource('')).toThrow(/not in the allowlist/);
  });

  it('rejects case variants of allowlisted slugs (allowlist is case-sensitive)', () => {
    // Hardens against future inconsistency between server-side registration
    // (always lowercase) and any caller that might apply a normalization step.
    expect(() => loadUiResource('Incident-Detail')).toThrow(/not in the allowlist/);
    expect(() => loadUiResource('INCIDENT-DETAIL')).toThrow(/not in the allowlist/);
  });

  it('error message lists the permitted slugs to aid debugging', () => {
    let thrown: Error | undefined;
    try {
      loadUiResource('bogus');
    } catch (e) {
      if (e instanceof Error) thrown = e;
    }
    expect(thrown?.message).toContain('Permitted:');
    expect(thrown?.message).toContain('incident-detail');
    expect(thrown?.message).toContain('solution-detail');
    expect(thrown?.message).toContain('incident-list');
    expect(thrown?.message).toContain('custom-fields');
  });
});
