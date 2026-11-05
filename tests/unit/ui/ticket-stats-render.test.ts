// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { renderPayload as RenderPayloadFn } from '../../../src/ui/ticket-stats/index.js';
import type { TicketStatsOutput } from '../../../src/schemas/ticketStats.js';
import fixture from '../../../screenshots/fixtures/ticket-stats.json';

const { host } = vi.hoisted(() => ({ host: vi.fn().mockResolvedValue({}) }));
vi.mock('../../../src/ui/shared/host.js', () => ({ mountApp: host }));
let renderPayload: typeof RenderPayloadFn;
let root: HTMLElement;
beforeEach(async () => {
  document.body.replaceChildren();
  root = document.createElement('main');
  root.id = 'root';
  document.body.appendChild(root);
  vi.resetModules();
  ({ renderPayload } = await import('../../../src/ui/ticket-stats/index.js'));
});

describe('ticket stats widget rendering', () => {
  it('renders all six KPI tiles, median, four tables and partial scan notice', () => {
    renderPayload(root, fixture);
    expect(Array.from(root.querySelectorAll('.kpi-value'), el => el.textContent)).toEqual(['120', '72', '85', '40', '9', '14']);
    expect(root.querySelector('.resolution')?.textContent).toBe('Median resolution: 18.5 h');
    expect(root.querySelectorAll('table')).toHaveLength(4);
    expect(root.querySelector('[role="status"]')?.textContent).toContain('Partial scan');
    expect(root.querySelector('#window')?.textContent).not.toContain('2026-10-28T');
  });
  it('gives every table aligned numeric and share column classes and proportional bars', () => {
    renderPayload(root, fixture);
    for (const table of root.querySelectorAll('table')) {
      expect(Array.from(table.querySelectorAll('thead th'), el => el.className)).toEqual(['', 'numeric', 'share']);
      for (const row of table.querySelectorAll('tbody tr')) {
        expect(Array.from(row.children, el => el.className)).toEqual(['label', 'numeric', 'share']);
      }
    }
    expect(root.querySelector<HTMLElement>('table .bar')?.style.width).toBe(String(38 / 120 * 100) + '%');
  });
  it('renders untrusted strings as text with full tooltips, without markup or event handlers', () => {
    const attack = '<img src=x onerror=alert(1)>';
    renderPayload(root, { ...fixture, by_category: [{ category: attack, count: 120 }], by_assignee: [{ email: attack, count: 1 }] });
    expect(root.querySelector('img, script')).toBeNull();
    expect(root.querySelector('[onerror]')).toBeNull();
    const labels = Array.from(root.querySelectorAll('.label')).filter(el => el.textContent === attack);
    expect(labels).toHaveLength(2);
    expect(labels.every(el => el.getAttribute('title') === attack)).toBe(true);
  });
  it('shows an empty state and null median; clears previous output on subsequent results', () => {
    renderPayload(root, fixture);
    renderPayload(root, { ...fixture, totals: { total: 0, open: 0, resolved_in_window: 0, created_in_window: 0, breached: 0, unassigned: 0 }, median_resolution_hours: null, scan: { pages_scanned: 2, truncated: false } });
    expect(root.querySelectorAll('table')).toHaveLength(0);
    expect(root.querySelector('.empty')?.textContent).toBe('No incidents match this window and group.');
    expect(root.querySelector('.resolution')?.textContent).toBe('Median resolution: —');
    expect(root.querySelector('.notice')).toBeNull();
    renderPayload(root, fixture);
    expect(root.querySelectorAll('.kpi')).toHaveLength(6);
    expect(root.querySelectorAll('table')).toHaveLength(4);
  });
  it('tolerates malformed payloads and missing breakdowns', () => {
    expect(() => renderPayload(root, undefined)).not.toThrow();
    expect(root.querySelector('.empty')).not.toBeNull();
    renderPayload(root, { totals: { total: 1 } } as TicketStatsOutput);
    expect(root.querySelectorAll('.breakdown .empty')).toHaveLength(4);
  });
  it('routes host errors to the shared error state and recovers on the next result', () => {
    const options = host.mock.calls.at(-1)?.[0] as { onResult: (data: TicketStatsOutput) => void; onError: (error: { message: string }) => void };
    options.onResult(fixture);
    options.onError({ message: '<img src=x onerror=alert(1)> Forbidden.' });
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('Forbidden.');
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('.kpis')).toBeNull();
    options.onResult(fixture);
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(root.querySelectorAll('.kpi')).toHaveLength(6);
  });
});
