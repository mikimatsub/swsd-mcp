import { describe, expect, it } from 'vitest';
import fixture from './fixtures/change-calendar-api.json';
import { buildCalendar, calendarWindow, findCalendarConflicts, isUnscheduled, plannedWindow, toCalendarItem } from '../../../src/swsd/mappers/changeCalendar.js';
import type { CalendarItem } from '../../../src/schemas/changeCalendar.js';

const base = toCalendarItem(fixture.change, 'change')!;
function item(overrides: Partial<CalendarItem> = {}): CalendarItem {
  return { ...base, id: 1, planned_start_at: '2026-11-10T09:00:00.000Z', planned_end_at: '2026-11-10T11:00:00.000Z',
    configuration_items: [{ id: 100, name: 'Database' }], group_assignee: undefined, ...overrides };
}

describe('change calendar mapping and window', () => {
  it.each(['change', 'release'] as const)('maps the fetched official %s example using only allowed fields', kind => {
    const mapped = toCalendarItem(fixture[kind], kind)!;
    expect(mapped).toEqual({
      kind, id: 10000, number: 1000, name: kind === 'change' ? 'Change Name' : 'Release Name', state: 'New', priority: 'High',
      planned_start_at: '2024-12-31T23:00:00.000Z', planned_end_at: '2025-01-01T04:00:00.000Z',
      assignee_email: 'john.doe@email.com', assignee_name: 'John Doe', group_assignee: { id: 1, name: 'Helpdesk Team' },
      configuration_items: [{ id: 100, name: '100' }], url: undefined, conflict_count: 0,
    });
  });
  it('maps bare rows, prefers account URL and drops malformed nested values', () => {
    const row = { ...fixture.change.change, href_account_domain: 'https://tenant.example/changes/1', href: 'https://api.example/changes/1',
      name: null, assignee: [], group_assignee: { id: '2' }, configuration_items: [null, { id: 'bad' }, { id: '3', name: 'CI' }] };
    expect(toCalendarItem(row, 'change')).toMatchObject({ name: '', assignee_email: undefined, group_assignee: { id: 2, name: '2' },
      configuration_items: [{ id: 3, name: 'CI' }], url: row.href_account_domain });
    expect(toCalendarItem({ ...row, href_account_domain: undefined, configuration_items: null }, 'release'))
      .toMatchObject({ url: row.href, configuration_items: [] });
  });
  it.each([null, [], {}, { id: 'bad', planned_start_at: '2026-11-10' }, { id: 1 }, { id: 1, planned_start_at: 'bad' }])('rejects unmappable row %j', raw => {
    expect(toCalendarItem(raw, 'change')).toBeNull();
  });
  it('counts missing/invalid starts as unscheduled, independently of other row fields', () => {
    expect(isUnscheduled({}, 'change')).toBe(true);
    expect(isUnscheduled({ planned_start_at: 'bad' }, 'release')).toBe(true);
    expect(isUnscheduled(fixture.change, 'change')).toBe(false);
    expect(isUnscheduled({ planned_start_at: '2026-11-10T09:00:00Z' }, 'change')).toBe(false);
  });
  it.each([undefined, null, 'bad', '2024-12-31T22:00:00Z', '2024-12-31T23:00:00Z'])('normalizes unusable end %s to the one-hour fallback', end => {
    const mapped = toCalendarItem({ ...fixture.change.change, planned_end_at: end }, 'change')!;
    expect(mapped.planned_end_at).toBeUndefined();
    expect(plannedWindow(mapped).end - plannedWindow(mapped).start).toBe(3600000);
  });
  it('defaults to UTC midnight and rolls the 30-day window across years', () => {
    expect(calendarWindow(undefined, undefined, new Date('2026-12-15T23:30:00-05:00'))).toEqual({
      from: '2026-12-16T00:00:00.000Z', to: '2027-01-15T00:00:00.000Z',
    });
    expect(calendarWindow('2026-11-10T09:00:00-05:00', undefined, new Date())).toEqual({
      from: '2026-11-10T14:00:00.000Z', to: '2026-12-10T14:00:00.000Z',
    });
  });
  it.each([['bad', '2026-11-10'], ['2026-11-10', 'bad'], ['2026-11-10', '2026-11-10'], ['2026-11-11', '2026-11-10']])('rejects invalid/reversed window %s..%s', (from, to) => {
    expect(() => calendarWindow(from, to, new Date())).toThrow(/strictly before/);
  });
});

describe('change calendar conflicts', () => {
  it.each([
    ['08:00:00.000', '09:00:00.000', false],
    ['08:00:00.000', '09:00:00.001', true],
    ['11:00:00.000', '12:00:00.000', false],
    ['10:59:59.999', '12:00:00.000', true],
    ['09:00:00.000', '11:00:00.000', true],
    ['09:30:00.000', '10:00:00.000', true],
  ])('checks half-open overlap edges %s–%s', (start, end, overlaps) => {
    expect(findCalendarConflicts([item(), item({ id: 2, planned_start_at: `2026-11-10T${start}Z`, planned_end_at: `2026-11-10T${end}Z` })]))
      .toHaveLength(overlaps ? 1 : 0);
  });
  it('uses a missing end as start plus one hour', () => {
    const a = item({ planned_end_at: undefined });
    const b = item({ id: 2, planned_start_at: '2026-11-10T09:30:00Z' });
    expect(findCalendarConflicts([a, b])[0]).toMatchObject({ overlap_start: '2026-11-10T09:30:00.000Z', overlap_end: '2026-11-10T10:00:00.000Z' });
    expect(findCalendarConflicts([a, { ...b, planned_start_at: '2026-11-10T10:00:00Z' }])).toEqual([]);
  });
  it.each([
    ['CI only', [{ id: 100, name: 'Database' }], undefined, ['shared CI: Database']],
    ['group only', [], { id: 7, name: 'Ops' }, ['same group: Ops']],
    ['both', [{ id: 100, name: 'Database' }, { id: 100, name: 'Database' }], { id: 7, name: 'Ops' }, ['shared CI: Database', 'same group: Ops']],
    ['neither', [{ id: 999, name: 'Database' }], { id: 8, name: 'Ops' }, []],
  ] as const)('detects shared identity: %s', (_label, cis, group, reasons) => {
    const result = findCalendarConflicts([item({ group_assignee: { id: 7, name: 'Ops' } }), item({ kind: 'release', configuration_items: [...cis], group_assignee: group })]);
    expect(result).toHaveLength(reasons.length ? 1 : 0);
    if (reasons.length) expect(result[0]).toEqual({ a: { kind: 'change', id: 1 }, b: { kind: 'release', id: 1 }, reasons,
      overlap_start: '2026-11-10T09:00:00.000Z', overlap_end: '2026-11-10T11:00:00.000Z' });
  });
  it('does not conflict on assignee equality or duplicate identity', () => {
    expect(findCalendarConflicts([item(), item()])).toEqual([]);
    expect(findCalendarConflicts([item({ configuration_items: [] }), item({ id: 2, configuration_items: [] })])).toEqual([]);
  });
  it('sorts, deduplicates, groups by UTC start, counts pairs and preserves input', () => {
    const first = item({ planned_start_at: '2026-11-09T23:30:00-05:00', planned_end_at: '2026-11-10T11:00:00Z' });
    const next = item({ id: 2 });
    const release = item({ kind: 'release', id: 1 });
    const later = item({ id: 3, planned_start_at: '2026-11-12T09:00:00Z', planned_end_at: undefined });
    const result = buildCalendar([later, next, first, release, next]);
    expect(result.items.map(i => [i.kind, i.id, i.conflict_count])).toEqual([['change', 1, 2], ['change', 2, 2], ['release', 1, 2], ['change', 3, 0]]);
    expect(result.conflicts).toHaveLength(3);
    expect(result.days.map(d => [d.date, d.items.length])).toEqual([['2026-11-10', 3], ['2026-11-12', 1]]);
    expect(first.conflict_count).toBe(0);
    expect(buildCalendar([])).toEqual({ items: [], conflicts: [], days: [] });
  });
});
