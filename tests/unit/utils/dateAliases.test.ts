import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseDateAlias, applyDateAlias } from '../../../src/utils/dateAliases.js';

describe('parseDateAlias', () => {
  afterEach(() => vi.useRealTimers());

  it('returns null for non-aliases (passes through)', () => {
    expect(parseDateAlias('2026-04-30')).toBe(null);
    expect(parseDateAlias('2026-04-30T12:00:00Z')).toBe(null);
    expect(parseDateAlias('garbage')).toBe(null);
  });

  it('parses 7d relative to now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-07T15:00:00Z'));
    expect(parseDateAlias('7d')).toBe('2026-04-30');
  });

  it('parses 1w same as 7d', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-07T15:00:00Z'));
    expect(parseDateAlias('1w')).toBe('2026-04-30');
  });

  it('parses 30d', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-07T15:00:00Z'));
    expect(parseDateAlias('30d')).toBe('2026-04-07');
  });

  it('preserves the time of day for hour aliases', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-07T15:00:00Z'));
    expect(parseDateAlias('24h')).toBe('2026-05-06T15:00:00.000Z');
  });

  it('rejects unsupported aliases (returns null)', () => {
    expect(parseDateAlias('1y')).toBe(null);
    expect(parseDateAlias('2months')).toBe(null);
  });

  it('trims whitespace before matching', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-07T15:00:00Z'));
    expect(parseDateAlias('  7d  ')).toBe('2026-04-30');
  });

  it('rejects zero and negative values', () => {
    expect(parseDateAlias('0d')).toBe(null);
    expect(parseDateAlias('-1d')).toBe(null);
  });

  it('rejects values that exceed 365', () => {
    expect(parseDateAlias('366d')).toBe(null);
    expect(parseDateAlias('500d')).toBe(null);
  });
});

describe('applyDateAlias', () => {
  afterEach(() => vi.useRealTimers());

  it('passes through input untouched when updated_within is absent', () => {
    const input = { page: 1, per_page: 25 };
    expect(applyDateAlias(input)).toBe(input);
  });

  it('translates updated_within to updated_from when no explicit updated_from', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-07T15:00:00Z'));
    const result = applyDateAlias({ updated_within: '7d', page: 1 });
    expect(result.updated_from).toBe('2026-04-30');
    expect((result as { updated_within?: string }).updated_within).toBeUndefined();
    expect(result.page).toBe(1);
  });

  it('respects explicit updated_from over updated_within', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-07T15:00:00Z'));
    const result = applyDateAlias({
      updated_within: '7d',
      updated_from: '2026-01-01',
    });
    expect(result.updated_from).toBe('2026-01-01');
  });

  it('passes through input when updated_within is unparseable', () => {
    const input = { updated_within: 'garbage', page: 1 };
    const result = applyDateAlias(input);
    // Unparseable alias: keep input as-is (don't touch updated_from)
    expect(result).toEqual(input);
  });
});
