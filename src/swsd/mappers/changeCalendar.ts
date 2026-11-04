import type { CalendarConflict, CalendarItem, ChangeCalendarInput } from '../../schemas/changeCalendar.js';

const HOUR = 60 * 60 * 1000;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
function integer(value: unknown): number | undefined {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof n === 'number' && Number.isSafeInteger(n) ? n : undefined;
}
function timestamp(value: unknown): string | undefined {
  const s = string(value);
  if (!s || !Number.isFinite(Date.parse(s))) return undefined;
  return new Date(s).toISOString();
}
function namedId(value: unknown): { id: number; name: string } | undefined {
  const obj = record(value);
  const id = integer(obj.id);
  return id === undefined ? undefined : { id, name: string(obj.name) ?? String(id) };
}
function calendarRecord(raw: unknown, kind: CalendarItem['kind']): Record<string, unknown> {
  const row = record(raw);
  // The official response examples wrap rows in change/release; the client also receives bare rows.
  return row.id === undefined && row[kind] !== undefined ? record(row[kind]) : row;
}

/** Reads only documented change/release list fields, plus the generic mapper's number/URL. */
export function toCalendarItem(raw: unknown, kind: CalendarItem['kind']): CalendarItem | null {
  const row = calendarRecord(raw, kind);
  const id = integer(row.id);
  const start = timestamp(row.planned_start_at);
  if (id === undefined || !start) return null;
  const end = timestamp(row.planned_end_at);
  const assignee = record(row.assignee);
  const cis = Array.isArray(row.configuration_items) ? row.configuration_items : [];
  return {
    kind, id, number: integer(row.number), name: string(row.name) ?? '',
    state: string(row.state), priority: string(row.priority),
    planned_start_at: start,
    // Invalid/non-positive windows use the same one-hour fallback as missing ends.
    planned_end_at: end && end > start ? end : undefined,
    assignee_email: string(assignee.email), assignee_name: string(assignee.name),
    group_assignee: namedId(row.group_assignee),
    configuration_items: cis.map(namedId).filter((ci): ci is NonNullable<typeof ci> => ci !== undefined),
    url: string(row.href_account_domain) ?? string(row.href),
    conflict_count: 0,
  };
}

export function isUnscheduled(raw: unknown, kind: CalendarItem['kind']): boolean {
  return timestamp(calendarRecord(raw, kind).planned_start_at) === undefined;
}

export function calendarWindow(from: string | undefined, to: string | undefined, now: Date): { from: string; to: string } {
  const start = new Date(from ?? `${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const end = to === undefined ? new Date(start.getTime() + 30 * 24 * HOUR) : new Date(to);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    throw new Error('Calendar window must have a valid from strictly before to.');
  }
  return { from: start.toISOString(), to: end.toISOString() };
}

export function plannedWindow(item: Pick<CalendarItem, 'planned_start_at' | 'planned_end_at'>): { start: number; end: number } {
  const start = Date.parse(item.planned_start_at);
  const end = item.planned_end_at ? Date.parse(item.planned_end_at) : NaN;
  return { start, end: Number.isFinite(end) && end > start ? end : start + HOUR };
}

/** Half-open windows: touching edges do not overlap. All filters run after fetching. */
export function matchesCalendarFilters(item: CalendarItem, input: ChangeCalendarInput, window: { from: string; to: string }): boolean {
  const { start, end } = plannedWindow(item);
  if (start >= Date.parse(window.to) || end <= Date.parse(window.from)) return false;
  const state = item.state?.toLowerCase();
  if (input.states?.length && !input.states.some(s => s.toLowerCase() === state)) return false;
  if (input.state_is_not?.some(s => s.toLowerCase() === state)) return false;
  if (input.assignee_email !== undefined && item.assignee_email?.toLowerCase() !== input.assignee_email.toLowerCase()) return false;
  if (input.group_assignee_id !== undefined && item.group_assignee?.id !== input.group_assignee_id) return false;
  return input.query === undefined || item.name.toLowerCase().includes(input.query.toLowerCase());
}

export function itemKey(item: Pick<CalendarItem, 'kind' | 'id'>): string {
  return `${item.kind}:${String(item.id)}`;
}

/** One conflict per pair, even when several CIs and the group are shared. */
export function findCalendarConflicts(items: readonly CalendarItem[]): CalendarConflict[] {
  const conflicts: CalendarConflict[] = [];
  for (let i = 0; i < items.length; i++) {
    const a = items[i]!;
    const aw = plannedWindow(a);
    const aCis = new Map(a.configuration_items.map(ci => [ci.id, ci.name]));
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j]!;
      if (itemKey(a) === itemKey(b)) continue;
      const bw = plannedWindow(b);
      const start = Math.max(aw.start, bw.start);
      const end = Math.min(aw.end, bw.end);
      if (!(start < end)) continue;
      const sharedIds = new Set(b.configuration_items.filter(ci => aCis.has(ci.id)).map(ci => ci.id));
      const reasons = [...sharedIds].map(id => `shared CI: ${aCis.get(id)!}`);
      if (a.group_assignee && a.group_assignee.id === b.group_assignee?.id) {
        reasons.push(`same group: ${a.group_assignee.name}`);
      }
      if (reasons.length > 0) {
        conflicts.push({
          a: { kind: a.kind, id: a.id }, b: { kind: b.kind, id: b.id }, reasons,
          overlap_start: new Date(start).toISOString(), overlap_end: new Date(end).toISOString(),
        });
      }
    }
  }
  return conflicts;
}

export function buildCalendar(candidates: readonly CalendarItem[]): {
  items: CalendarItem[]; conflicts: CalendarConflict[]; days: { date: string; items: CalendarItem[] }[];
} {
  // Pagination can repeat records if the upstream collection moves during a scan.
  const items = [...new Map(candidates.map(item => [itemKey(item), item])).values()]
    .map(item => ({ ...item, conflict_count: 0 }))
    .sort((a, b) => Date.parse(a.planned_start_at) - Date.parse(b.planned_start_at)
      || a.kind.localeCompare(b.kind) || a.id - b.id);
  const conflicts = findCalendarConflicts(items);
  const byKey = new Map(items.map(item => [itemKey(item), item]));
  for (const conflict of conflicts) {
    byKey.get(itemKey(conflict.a))!.conflict_count++;
    byKey.get(itemKey(conflict.b))!.conflict_count++;
  }
  const days = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const date = new Date(item.planned_start_at).toISOString().slice(0, 10);
    const day = days.get(date) ?? [];
    day.push(item);
    days.set(date, day);
  }
  return { items, conflicts, days: [...days].map(([date, dayItems]) => ({ date, items: dayItems })) };
}
