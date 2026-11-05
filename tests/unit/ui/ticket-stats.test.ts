import { describe, expect, it } from 'vitest';
import { barPercent, breakdownRows, countValue, formatHours, formatWindowDate } from '../../../src/ui/ticket-stats/logic.js';

describe('ticket stats widget logic', () => {
  it('formats dates in the viewer zone, including date rollover and daylight saving', () => {
    expect(formatWindowDate('2026-11-04T01:00:00Z', 'en-US', 'America/New_York')).toBe('Nov 3, 2026, 8:00 PM EST');
    expect(formatWindowDate('2026-10-28T12:00:00Z', 'en-US', 'America/New_York')).toBe('Oct 28, 2026, 8:00 AM EDT');
    expect(formatWindowDate('2026-11-04T01:00:00Z', 'en-US', 'Asia/Tokyo')).toMatch(/Nov 4, 2026, 10:00 AM/);
    const value = '2026-11-04T01:00:00Z';
    expect(formatWindowDate(value)).toBe(new Intl.DateTimeFormat(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    }).format(new Date(value)));
  });
  it.each([undefined, null, '', 'invalid', 123])('uses a placeholder for an invalid date %j', value => {
    expect(formatWindowDate(value)).toBe('—');
  });
  it('formats resolution hours without conflating zero and missing data', () => {
    expect(formatHours(18.55, 'en-US')).toBe('18.6 h');
    expect(formatHours(0, 'en-US')).toBe('0 h');
    for (const value of [null, undefined, -1, NaN, Infinity, '12']) expect(formatHours(value)).toBe('—');
  });
  it('clamps bars and handles empty or malformed totals', () => {
    expect(barPercent(25, 100)).toBe(25);
    expect(barPercent(200, 100)).toBe(100);
    expect(barPercent(-1, 100)).toBe(0);
    expect(barPercent(1, 0)).toBe(0);
    expect(barPercent(NaN, 100)).toBe(0);
    expect(barPercent(1, Infinity)).toBe(0);
  });
  it('accepts only nonnegative safe integer counts', () => {
    expect(countValue(10)).toBe(10);
    for (const value of [-1, 1.5, null, '2', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(countValue(value)).toBe(0);
  });
  it('extracts valid breakdown rows without mutating input and bounds top tens', () => {
    const values = [{ email: 'jane.doe@acme.example', count: 5 }, null, { email: 'alex.kim@acme.example', count: -1 }, { count: 2 }];
    expect(breakdownRows(values, 'email')).toEqual([{ label: 'jane.doe@acme.example', count: 5 }, { label: 'alex.kim@acme.example', count: 0 }]);
    expect(breakdownRows(values, 'email', 1)).toHaveLength(1);
    expect(values).toHaveLength(4);
    expect(breakdownRows(null, 'email')).toEqual([]);
  });
});
