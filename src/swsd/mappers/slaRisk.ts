import type { IncidentSlaViolation } from '../types.js';

export type SlaRiskLevel = 'breached' | 'critical' | 'warning' | 'ok' | 'no_due_date';

export interface SlaRiskResult {
  due_at: string | undefined;
  minutes_to_breach: number | undefined;
  risk: SlaRiskLevel;
  sla_violations: IncidentSlaViolation[];
}

/**
 * Compute SLA breach risk for a single incident.
 *
 * Pure function — takes `now` as a parameter so tests can inject a fixed
 * clock without vi.useFakeTimers().
 *
 * Risk buckets:
 *   - "breached"    — due_at is in the past OR sla_violations is non-empty
 *   - "critical"    — due within 4 hours (<= 240 minutes)
 *   - "warning"     — due within at_risk_within_hours
 *   - "ok"          — due later than the warning window
 *   - "no_due_date" — no due_at set and no sla_violations
 *
 * minutes_to_breach is negative when overdue, positive when time remains.
 * Undefined only when due_at is absent (risk will be "no_due_date" or
 * "breached" if sla_violations exist).
 */
export function computeSlaRisk(
  dueAt: string | undefined,
  slaViolations: IncidentSlaViolation[],
  atRiskWithinHours: number,
  now: Date,
): SlaRiskResult {
  const violations = Array.isArray(slaViolations) ? slaViolations : [];

  if (dueAt === undefined || dueAt === '') {
    if (violations.length > 0) {
      return {
        due_at: undefined,
        minutes_to_breach: undefined,
        risk: 'breached',
        sla_violations: violations,
      };
    }
    return {
      due_at: undefined,
      minutes_to_breach: undefined,
      risk: 'no_due_date',
      sla_violations: [],
    };
  }

  const dueDate = new Date(dueAt);
  if (Number.isNaN(dueDate.getTime())) {
    if (violations.length > 0) {
      return {
        due_at: dueAt,
        minutes_to_breach: undefined,
        risk: 'breached',
        sla_violations: violations,
      };
    }
    return {
      due_at: dueAt,
      minutes_to_breach: undefined,
      risk: 'no_due_date',
      sla_violations: [],
    };
  }

  const diffMs = dueDate.getTime() - now.getTime();
  const minutesToBreach = Math.round(diffMs / 60_000);

  if (minutesToBreach < 0 || violations.length > 0) {
    return {
      due_at: dueAt,
      minutes_to_breach: minutesToBreach,
      risk: 'breached',
      sla_violations: violations,
    };
  }

  const criticalMinutes = 4 * 60;
  const warningMinutes = atRiskWithinHours * 60;

  if (minutesToBreach <= criticalMinutes) {
    return {
      due_at: dueAt,
      minutes_to_breach: minutesToBreach,
      risk: 'critical',
      sla_violations: violations,
    };
  }

  if (minutesToBreach <= warningMinutes) {
    return {
      due_at: dueAt,
      minutes_to_breach: minutesToBreach,
      risk: 'warning',
      sla_violations: violations,
    };
  }

  return {
    due_at: dueAt,
    minutes_to_breach: minutesToBreach,
    risk: 'ok',
    sla_violations: violations,
  };
}

/**
 * Sort incidents by SLA risk priority.
 *
 * Order: breached first (most overdue first), then critical/warning/ok by
 * minutes_to_breach ascending, no_due_date last.
 */
export function sortByRisk<T extends { minutes_to_breach?: number; risk: SlaRiskLevel }>(
  items: T[],
): T[] {
  const riskOrder: Record<SlaRiskLevel, number> = {
    breached: 0,
    critical: 1,
    warning: 2,
    ok: 3,
    no_due_date: 4,
  };

  return [...items].sort((a, b) => {
    const ra = riskOrder[a.risk];
    const rb = riskOrder[b.risk];
    if (ra !== rb) return ra - rb;

    if (a.risk === 'breached') {
      const ma = a.minutes_to_breach ?? 0;
      const mb = b.minutes_to_breach ?? 0;
      return ma - mb;
    }

    if (a.risk === 'no_due_date') return 0;

    const ma = a.minutes_to_breach ?? Number.MAX_SAFE_INTEGER;
    const mb = b.minutes_to_breach ?? Number.MAX_SAFE_INTEGER;
    return ma - mb;
  });
}
