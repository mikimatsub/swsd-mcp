import { describe, it, expect } from 'vitest';
import { computeSlaRisk, sortByRisk } from '../../../src/swsd/mappers/slaRisk.js';

const NOW = new Date('2026-06-01T12:00:00Z');

describe('computeSlaRisk', () => {
  it('returns "breached" when due_at is in the past', () => {
    const result = computeSlaRisk('2026-06-01T11:00:00Z', [], 24, NOW);
    expect(result.risk).toBe('breached');
    expect(result.minutes_to_breach).toBe(-60);
  });

  it('returns "breached" when sla_violations is non-empty even if due_at is future', () => {
    const violations = [{ name: 'First Response', violation_type: 'response' }];
    const result = computeSlaRisk('2026-06-02T12:00:00Z', violations, 24, NOW);
    expect(result.risk).toBe('breached');
    expect(result.sla_violations).toHaveLength(1);
  });

  it('returns "critical" when due_at is exactly now (0 minutes remaining)', () => {
    const result = computeSlaRisk('2026-06-01T12:00:00Z', [], 24, NOW);
    expect(result.risk).toBe('critical');
    expect(result.minutes_to_breach).toBe(0);
  });

  it('returns "critical" when due within 4 hours', () => {
    const result = computeSlaRisk('2026-06-01T15:30:00Z', [], 24, NOW);
    expect(result.risk).toBe('critical');
    expect(result.minutes_to_breach).toBe(210);
  });

  it('returns "critical" at exactly 4 hours boundary', () => {
    const result = computeSlaRisk('2026-06-01T16:00:00Z', [], 24, NOW);
    expect(result.risk).toBe('critical');
    expect(result.minutes_to_breach).toBe(240);
  });

  it('returns "warning" when due within at_risk_within_hours', () => {
    const result = computeSlaRisk('2026-06-02T08:00:00Z', [], 24, NOW);
    expect(result.risk).toBe('warning');
    expect(result.minutes_to_breach).toBe(1200);
  });

  it('returns "warning" at exactly at_risk_within_hours boundary', () => {
    const result = computeSlaRisk('2026-06-02T12:00:00Z', [], 24, NOW);
    expect(result.risk).toBe('warning');
    expect(result.minutes_to_breach).toBe(1440);
  });

  it('returns "ok" when due beyond at_risk_within_hours', () => {
    const result = computeSlaRisk('2026-06-03T12:00:00Z', [], 24, NOW);
    expect(result.risk).toBe('ok');
    expect(result.minutes_to_breach).toBe(2880);
  });

  it('returns "no_due_date" when due_at is undefined and no violations', () => {
    const result = computeSlaRisk(undefined, [], 24, NOW);
    expect(result.risk).toBe('no_due_date');
    expect(result.minutes_to_breach).toBeUndefined();
    expect(result.due_at).toBeUndefined();
  });

  it('returns "breached" when due_at is undefined but sla_violations exist', () => {
    const violations = [{ name: 'Resolution', violation_type: 'resolution' }];
    const result = computeSlaRisk(undefined, violations, 24, NOW);
    expect(result.risk).toBe('breached');
    expect(result.minutes_to_breach).toBeUndefined();
  });

  it('returns "no_due_date" for empty string due_at', () => {
    const result = computeSlaRisk('', [], 24, NOW);
    expect(result.risk).toBe('no_due_date');
  });

  it('returns "no_due_date" for unparseable due_at without violations', () => {
    const result = computeSlaRisk('not-a-date', [], 24, NOW);
    expect(result.risk).toBe('no_due_date');
  });

  it('returns "breached" for unparseable due_at with violations', () => {
    const violations = [{ name: 'X', violation_type: 'y' }];
    const result = computeSlaRisk('not-a-date', violations, 24, NOW);
    expect(result.risk).toBe('breached');
  });

  it('respects custom at_risk_within_hours (small window)', () => {
    const result = computeSlaRisk('2026-06-01T17:00:00Z', [], 4, NOW);
    expect(result.risk).toBe('ok');
    expect(result.minutes_to_breach).toBe(300);
  });

  it('handles negative minutes correctly for overdue', () => {
    const result = computeSlaRisk('2026-06-01T09:30:00Z', [], 24, NOW);
    expect(result.risk).toBe('breached');
    expect(result.minutes_to_breach).toBe(-150);
  });
});

describe('sortByRisk', () => {
  it('puts breached first, then critical, warning, ok, no_due_date last', () => {
    const items = [
      { risk: 'ok' as const, minutes_to_breach: 5000 },
      { risk: 'breached' as const, minutes_to_breach: -100 },
      { risk: 'no_due_date' as const, minutes_to_breach: undefined },
      { risk: 'critical' as const, minutes_to_breach: 120 },
      { risk: 'warning' as const, minutes_to_breach: 600 },
    ];
    const sorted = sortByRisk(items);
    expect(sorted.map((i) => i.risk)).toEqual([
      'breached',
      'critical',
      'warning',
      'ok',
      'no_due_date',
    ]);
  });

  it('sorts breached by most overdue first (most negative minutes_to_breach)', () => {
    const items = [
      { risk: 'breached' as const, minutes_to_breach: -30 },
      { risk: 'breached' as const, minutes_to_breach: -120 },
      { risk: 'breached' as const, minutes_to_breach: -5 },
    ];
    const sorted = sortByRisk(items);
    expect(sorted.map((i) => i.minutes_to_breach)).toEqual([-120, -30, -5]);
  });

  it('sorts non-breached by minutes_to_breach ascending', () => {
    const items = [
      { risk: 'ok' as const, minutes_to_breach: 5000 },
      { risk: 'critical' as const, minutes_to_breach: 60 },
      { risk: 'warning' as const, minutes_to_breach: 600 },
    ];
    const sorted = sortByRisk(items);
    expect(sorted.map((i) => i.minutes_to_breach)).toEqual([60, 600, 5000]);
  });

  it('does not mutate the input array', () => {
    const items = [
      { risk: 'ok' as const, minutes_to_breach: 5000 },
      { risk: 'breached' as const, minutes_to_breach: -100 },
    ];
    const original = [...items];
    sortByRisk(items);
    expect(items).toEqual(original);
  });
});
