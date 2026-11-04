import { describe, expect, it } from 'vitest';
import { conflictReasons, formatDay, formatTimeRange, formatWindow, groupDays } from '../../../src/ui/change-calendar/logic.js';
import { toCalendarItem } from '../../../src/swsd/mappers/changeCalendar.js';
import fixture from '../mappers/fixtures/change-calendar-api.json';
import type { CalendarConflict } from '../../../src/schemas/changeCalendar.js';

const item = toCalendarItem(fixture.change, 'change')!;
describe('change calendar widget logic', () => {
  it('formats same-day, multiday and assumed-end times in UTC', () => {
    expect(formatTimeRange({ planned_start_at: '2026-11-10T04:00:00-05:00', planned_end_at: '2026-11-10T06:00:00-05:00' })).toBe('09:00–11:00');
    expect(formatTimeRange({ planned_start_at: '2026-11-10T09:00:00Z', planned_end_at: '2026-11-12T10:00:00Z' })).toBe('Nov 10 09:00 → Nov 12');
    expect(formatTimeRange({ planned_start_at: '2026-11-10T23:30:00Z' })).toBe('Nov 10 23:30 → Nov 11');
    expect(formatTimeRange({ planned_start_at: '2026-11-10T09:00:00Z', planned_end_at: 'bad' })).toBe('09:00–10:00');
    expect(formatTimeRange({ planned_start_at: 'bad' })).toBe('Unscheduled');
  });
  it('formats day headings and window boundaries deterministically', () => {
    expect(formatDay('2026-11-10')).toBe('Tue, Nov 10');
    expect(formatDay('bad')).toBe('bad');
    expect(formatWindow({ from: '2026-11-10T04:00:00-05:00', to: '2026-11-11T00:00:00Z' }))
      .toBe('2026-11-10 09:00 → 2026-11-11 00:00 · UTC · end exclusive');
    expect(formatWindow()).toBe('All times UTC');
    expect(formatWindow({ from: 'bad', to: 'bad' })).toBe('All times UTC');
  });
  it('groups sorted items by UTC date without mutating the payload', () => {
    const items = [{ ...item, id: 2, planned_start_at: '2026-11-10T23:30:00-05:00' },
      { ...item, id: 1, planned_start_at: '2026-11-10T00:30:00+05:00' }, { ...item, id: 3, planned_start_at: 'bad' },
      { ...item, id: 4, planned_start_at: '2026-11-11T10:00:00Z' }];
    expect(groupDays(items).map(d => [d.date, d.items.map(i => i.id)])).toEqual([['2026-11-09', [1]], ['2026-11-11', [2, 4]]]);
    expect(items.map(i => i.id)).toEqual([2, 1, 3, 4]);
  });
  it('lists unique conflict reasons using kind plus ID on both sides', () => {
    const conflicts: CalendarConflict[] = [
      { a: { kind: 'change', id: 1 }, b: { kind: 'release', id: 2 }, reasons: ['same group: Ops'], overlap_start: '', overlap_end: '' },
      { a: { kind: 'release', id: 1 }, b: { kind: 'change', id: 1 }, reasons: ['shared CI: DB', 'same group: Ops'], overlap_start: '', overlap_end: '' },
    ];
    expect(conflictReasons({ kind: 'change', id: 1 }, conflicts)).toEqual(['same group: Ops', 'shared CI: DB']);
    expect(conflictReasons({ kind: 'release', id: 2 }, conflicts)).toEqual(['same group: Ops']);
    expect(conflictReasons({ kind: 'change', id: 2 }, conflicts)).toEqual([]);
  });
});
