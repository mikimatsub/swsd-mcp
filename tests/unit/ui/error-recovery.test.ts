// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MountAppOptions } from '../../../src/ui/shared/host.js';
import slaFixture from '../../../screenshots/fixtures/sla-risk.json';

const host = vi.hoisted(() => ({ options: undefined as MountAppOptions<unknown> | undefined }));
vi.mock('../../../src/ui/shared/host.js', () => ({
  mountApp: vi.fn(async (options: MountAppOptions<unknown>) => {
    host.options = options;
    return { openLink: vi.fn().mockResolvedValue({}) };
  }),
}));

const name = 'Synthetic recovered record';
const record = { id: 1234567, name };
const cases = [
  { widget: 'incident-list', data: { incidents: [record] }, marker: name },
  { widget: 'custom-fields', data: { custom_fields: [{ ...record, type: 'Text', active: true, required: false, searchable: true }] }, marker: name },
  { widget: 'sla-risk', data: slaFixture, marker: slaFixture.incidents[0].name },
  { widget: 'change-calendar', data: { items: [{ ...record, kind: 'change', planned_start_at: '2026-11-04T12:00:00Z', conflict_count: 0 }], conflicts: [] }, marker: name },
  { widget: 'incident-detail', data: { incident: record }, marker: name },
  { widget: 'solution-detail', data: { solution: record }, marker: name },
  { widget: 'catalog-item-form', data: { item: { ...record, variables: [] } }, marker: name },
  { widget: 'comment-thread', data: { comments: [{ id: 1234567, body: name, is_private: false, author_email: 'alex@example.test' }] }, marker: name },
  { widget: 'audit-timeline', data: { audits: [{ uuid: 'synthetic-audit', message: name, action: 'Updated' }] }, marker: name },
  { widget: 'ticket-stats', data: { totals: { total: 0 } }, marker: 'No incidents match this window and group.' },
];

beforeEach(() => {
  vi.resetModules();
  host.options = undefined;
  document.body.replaceChildren();
});

async function loadWidget(widget: string): Promise<HTMLElement> {
  const html = readFileSync(`src/ui/${widget}/index.html`, 'utf8');
  const shell = new DOMParser().parseFromString(html, 'text/html').getElementById('root')!;
  const root = document.importNode(shell, true);
  document.body.appendChild(root);
  await import(`../../../src/ui/${widget}/index.ts`);
  return root;
}

describe('widget error recovery', () => {
  it.each(cases)('$widget renders success after initial and repeated errors', async ({ widget, data, marker }) => {
    const root = await loadWidget(widget);
    const cached = [...root.querySelectorAll('[id]')];
    const options = host.options!;
    for (let attempt = 0; attempt < 2; attempt++) {
      options.onError!({ message: 'Synthetic first error' });
      options.onError!({ message: '<img src=x onerror=alert(1)> Synthetic retry error' });
      expect(root.querySelectorAll('[role="alert"]')).toHaveLength(1);
      expect(root.querySelector('[role="alert"]')?.textContent).toContain('Synthetic retry error');
      expect(root.querySelector('img')).toBeNull();
      options.onResult(data);
      expect(root.querySelector('[role="alert"]')).toBeNull();
      expect(root.querySelector('.error-content')).toBeNull();
      expect(root.textContent).toContain(marker);
      for (const node of cached) expect(document.getElementById(node.id)).toBe(node);
    }
  });

  it.each(['incident-list', 'custom-fields'])('%s retains search input and listeners after error recovery', async widget => {
    const root = await loadWidget(widget);
    const options = host.options!;
    const data = cases.find(entry => entry.widget === widget)!.data;
    options.onResult(data);
    const search = root.querySelector<HTMLInputElement>('#search')!;
    search.value = 'no synthetic match';
    search.dispatchEvent(new Event('input'));
    options.onError!({ message: 'Synthetic error' });
    options.onResult(data);
    expect(root.querySelector('#search')).toBe(search);
    expect(search.value).toBe('no synthetic match');
    expect(root.querySelector('#rows')?.textContent).not.toContain(name);
    search.value = '';
    search.dispatchEvent(new Event('input'));
    expect(root.querySelector('#rows')?.textContent).toContain(name);
  });

  it('renders the SLA screenshot fixture with breached, at-risk and OK rows and counts', async () => {
    const root = await loadWidget('sla-risk');
    host.options!.onResult(slaFixture);
    expect([...root.querySelectorAll('#rows .pill')].map(node => node.textContent))
      .toEqual(['Breached', 'Critical', 'Warning', 'OK']);
    expect([...root.querySelectorAll('#chips .chip')].map(node => node.textContent))
      .toEqual(['Breached: 1', 'Critical: 1', 'Warning: 1', 'OK: 1']);
    for (const incident of slaFixture.incidents) {
      expect(incident.minutes_to_breach).toBe((Date.parse(incident.due_at) - Date.parse(slaFixture.now)) / 60_000);
    }
  });
});
