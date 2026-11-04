import type { CalendarConflict, CalendarItem } from '../../schemas/changeCalendar.js';

const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const date = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
const day = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });

export function formatDay(value: string): string {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? day.format(parsed) : value;
}

export function formatTimeRange(item: Pick<CalendarItem, 'planned_start_at' | 'planned_end_at'>): string {
  const start = new Date(item.planned_start_at);
  if (!Number.isFinite(start.getTime())) return 'Unscheduled';
  const rawEnd = item.planned_end_at ? new Date(item.planned_end_at) : undefined;
  const end = rawEnd && rawEnd > start ? rawEnd : new Date(start.getTime() + 3600000);
  return start.toISOString().slice(0, 10) === end.toISOString().slice(0, 10)
    ? `${time.format(start)}–${time.format(end)}`
    : `${date.format(start)} ${time.format(start)} → ${date.format(end)}`;
}

export function formatWindow(window?: { from: string; to: string }): string {
  if (!window) return 'All times UTC';
  const from = new Date(window.from);
  const to = new Date(window.to);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) return 'All times UTC';
  return `${from.toISOString().slice(0, 10)} ${time.format(from)} → ${to.toISOString().slice(0, 10)} ${time.format(to)} · UTC · end exclusive`;
}

export function conflictReasons(item: Pick<CalendarItem, 'kind' | 'id'>, conflicts: readonly CalendarConflict[]): string[] {
  return [...new Set(conflicts.filter(c =>
    (c.a.kind === item.kind && c.a.id === item.id) || (c.b.kind === item.kind && c.b.id === item.id))
    .flatMap(c => c.reasons))];
}

export function groupDays(items: readonly CalendarItem[]): { date: string; items: CalendarItem[] }[] {
  const days = new Map<string, CalendarItem[]>();
  const sorted = [...items].sort((a, b) => Date.parse(a.planned_start_at) - Date.parse(b.planned_start_at));
  for (const item of sorted) {
    const start = new Date(item.planned_start_at);
    if (!Number.isFinite(start.getTime())) continue;
    const key = start.toISOString().slice(0, 10);
    const entries = days.get(key) ?? [];
    entries.push(item);
    days.set(key, entries);
  }
  return [...days].map(([key, entries]) => ({ date: key, items: entries }));
}
