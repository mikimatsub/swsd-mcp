import { describe, it, expect } from 'vitest';
import {
  formatDueText,
  RISK_LABELS,
  RISK_CHIP_CLASSES,
  RISK_PILL_CLASSES,
  type RiskLevel,
} from '../../../src/ui/sla-risk/logic.js';

describe('sla-risk formatDueText', () => {
  it('returns "No due date" for the no_due_date bucket', () => {
    expect(formatDueText(undefined, 'no_due_date')).toBe('No due date');
  });

  it('returns empty text when minutes are unknown', () => {
    expect(formatDueText(undefined, 'breached')).toBe('');
  });

  it.each([
    [-192, 'Overdue by 3h 12m'],
    [-120, 'Overdue by 2h'],
    [-45, 'Overdue by 45m'],
    [45, 'Due in 45m'],
    [180, 'Due in 3h'],
    [194, 'Due in 3h 14m'],
    [0, 'Due in 0m'],
  ])('formats %i minutes as %s', (minutes, expected) => {
    expect(formatDueText(minutes, 'warning')).toBe(expected);
  });
});

describe('sla-risk label/class maps', () => {
  const levels: RiskLevel[] = ['breached', 'critical', 'warning', 'ok', 'no_due_date'];
  it('covers every risk level', () => {
    for (const level of levels) {
      expect(RISK_LABELS[level]).toBeTruthy();
      expect(RISK_CHIP_CLASSES[level]).toMatch(/^chip /);
      expect(RISK_PILL_CLASSES[level]).toMatch(/^pill /);
    }
  });
});
