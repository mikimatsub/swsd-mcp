/** DOM-free formatting shared by the widget and its unit tests. */
export interface BreakdownRow { label: string; count: number }

export function countValue(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function breakdownRows(value: unknown, key: string, limit?: number): BreakdownRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    return typeof row[key] === 'string' ? [{ label: row[key], count: countValue(row.count) }] : [];
  }).slice(0, limit);
}

export function barPercent(count: number, total: number): number {
  if (!Number.isFinite(count) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, count / total * 100));
}

export function formatWindowDate(value: unknown, locale?: string, timeZone?: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return '—';
  // Omit timeZone in production: Intl uses the viewer's local zone, not UTC.
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZoneName: 'short', ...(timeZone ? { timeZone } : {}),
  }).format(new Date(value));
}

export function formatHours(value: unknown, locale?: string): string {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value) + ' h'
    : '—';
}
