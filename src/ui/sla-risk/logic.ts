/**
 * Pure (DOM-free) helpers for the sla-risk widget so they can be unit-tested
 * in the node vitest environment, mirroring incident-list/logic.ts.
 */

export type RiskLevel = 'breached' | 'critical' | 'warning' | 'ok' | 'no_due_date';

export const RISK_LABELS: Record<RiskLevel, string> = {
  breached: 'Breached',
  critical: 'Critical',
  warning: 'Warning',
  ok: 'OK',
  no_due_date: 'No Due Date',
};

export const RISK_CHIP_CLASSES: Record<RiskLevel, string> = {
  breached: 'chip chip-breached',
  critical: 'chip chip-critical',
  warning: 'chip chip-warning',
  ok: 'chip chip-ok',
  no_due_date: 'chip chip-nodate',
};

export const RISK_PILL_CLASSES: Record<RiskLevel, string> = {
  breached: 'pill pill-breached',
  critical: 'pill pill-critical',
  warning: 'pill pill-warning',
  ok: 'pill pill-ok',
  no_due_date: 'pill pill-nodate',
};

export function formatDueText(minutes: number | undefined, risk: RiskLevel): string {
  if (risk === 'no_due_date') return 'No due date';
  if (minutes === undefined) return '';
  if (minutes < 0) {
    const absMin = Math.abs(minutes);
    const h = Math.floor(absMin / 60);
    const m = absMin % 60;
    if (h > 0 && m > 0) return `Overdue by ${String(h)}h ${String(m)}m`;
    if (h > 0) return `Overdue by ${String(h)}h`;
    return `Overdue by ${String(m)}m`;
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `Due in ${String(h)}h ${String(m)}m`;
  if (h > 0) return `Due in ${String(h)}h`;
  return `Due in ${String(m)}m`;
}
