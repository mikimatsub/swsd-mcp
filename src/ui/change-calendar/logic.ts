import type { CalendarConflict, CalendarItem } from '../../schemas/changeCalendar.js';

const HOUR = 3600000;

/** Viewer's IANA zone; falls back to UTC when Intl cannot resolve one. */
export function viewerTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

function valid(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : undefined;
}

/** YYYY-MM-DD in the given zone. */
export function localDateKey(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Short zone label such as "EST" or "GMT+9". */
export function zoneLabel(timeZone: string, at: Date = new Date()): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
    .formatToParts(at).find(p => p.type === 'timeZoneName');
  return part?.value ?? timeZone;
}

const TIME: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
function fmtTime(d: Date, timeZone: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { ...TIME, timeZone }).format(d);
}
function fmtDate(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric' }).format(d);
}
function fmtDateTime(d: Date, timeZone: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { ...TIME, month: 'short', day: 'numeric', timeZone }).format(d);
}

/** Day heading for a local YYYY-MM-DD key (rendered at noon UTC so it never shifts). */
export function formatDay(key: string): string {
  const d = valid(/^\d{4}-\d{2}-\d{2}$/.test(key) ? `${key}T12:00:00Z` : key);
  return d ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(d) : key;
}

export interface TimeRange { range: string; until?: string; }

/**
 * Viewer-locale times. Same day: "4:00 – 6:00 AM" (Intl formatRange).
 * Multi-day: "5:00 AM →" then "Nov 12, 5:00 AM" so the end is never ambiguous.
 */
export function formatTimeRange(item: Pick<CalendarItem, 'planned_start_at' | 'planned_end_at'>, timeZone = viewerTimeZone(), locale?: string): TimeRange {
  const start = valid(item.planned_start_at);
  if (!start) return { range: 'Unscheduled' };
  const rawEnd = valid(item.planned_end_at);
  const end = rawEnd && rawEnd > start ? rawEnd : new Date(start.getTime() + HOUR);
  if (localDateKey(start, timeZone) === localDateKey(end, timeZone)) {
    return { range: new Intl.DateTimeFormat(locale, { ...TIME, timeZone }).formatRange(start, end) };
  }
  return { range: `${fmtTime(start, timeZone, locale)} →`, until: fmtDateTime(end, timeZone, locale) };
}

/** Friendly window such as "Nov 10 – Nov 12 · times in EST" (end is exclusive, so shown as the prior instant). */
export function formatWindow(window?: { from: string; to: string }, timeZone = viewerTimeZone()): string {
  const tz = `times in ${zoneLabel(timeZone)}`;
  const from = valid(window?.from);
  const to = valid(window?.to);
  if (!from || !to || to <= from) return `Upcoming changes and releases · ${tz}`;
  const last = new Date(to.getTime() - 1);
  const a = fmtDate(from, timeZone);
  const b = fmtDate(last, timeZone);
  return `${a === b ? a : `${a} – ${b}`} · ${tz}`;
}

export function conflictReasons(item: Pick<CalendarItem, 'kind' | 'id'>, conflicts: readonly CalendarConflict[]): string[] {
  return [...new Set(conflicts.filter(c =>
    (c.a.kind === item.kind && c.a.id === item.id) || (c.b.kind === item.kind && c.b.id === item.id))
    .flatMap(c => c.reasons))];
}

/** Groups by the viewer-local start date. */
export function groupDays(items: readonly CalendarItem[], timeZone = viewerTimeZone()): { date: string; items: CalendarItem[] }[] {
  const days = new Map<string, CalendarItem[]>();
  const sorted = [...items].sort((a, b) => Date.parse(a.planned_start_at) - Date.parse(b.planned_start_at));
  for (const item of sorted) {
    const start = valid(item.planned_start_at);
    if (!start) continue;
    const key = localDateKey(start, timeZone);
    const entries = days.get(key) ?? [];
    entries.push(item);
    days.set(key, entries);
  }
  return [...days].map(([key, entries]) => ({ date: key, items: entries }));
}
