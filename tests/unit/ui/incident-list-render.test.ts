// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({ onResult: (_data: unknown) => {} }));
vi.mock('../../../src/ui/shared/host.js', () => ({
  mountApp: async (options: { onResult: (data: unknown) => void }) => { host.onResult = options.onResult; },
}));

beforeEach(async () => {
  vi.resetModules();
  document.body.replaceChildren();
  const root = document.createElement('main');
  root.id = 'root';
  for (const [tag, id] of [['h1', 'title'], ['input', 'search'], ['tbody', 'rows'], ['p', 'empty']]) {
    const element = document.createElement(tag!);
    element.id = id!;
    root.appendChild(element);
  }
  document.body.appendChild(root);
  await import('../../../src/ui/incident-list/index.js');
});

describe('incident list count rendering', () => {
  it('shows the visible count instead of an upstream candidate total', () => {
    host.onResult({ incidents: [{ id: 1234567, name: 'Synthetic' }],
      pagination: { total: 200, total_scope: 'upstream', matched_total: null } });
    expect(document.getElementById('title')?.textContent).toBe('Incidents (1 shown)');
    expect(document.getElementById('rows')?.children).toHaveLength(1);
  });

  it('uses the known matched total and updates the shown count after search', () => {
    host.onResult({ incidents: [{ id: 1234567, name: 'Alpha' }, { id: 1234568, name: 'Beta' }],
      pagination: { total: 200, total_scope: 'upstream', matched_total: 2 } });
    expect(document.getElementById('title')?.textContent).toBe('Incidents (2 of 2)');
    const search = document.getElementById('search') as HTMLInputElement;
    search.value = 'Alpha';
    search.dispatchEvent(new Event('input'));
    expect(document.getElementById('title')?.textContent).toBe('Incidents (1 of 2)');
  });

  it('preserves totals for legacy responses with a trustworthy scope', () => {
    host.onResult({ incidents: [{ id: 1234567, name: 'Synthetic' }],
      pagination: { total: 20, total_scope: 'filtered' } });
    expect(document.getElementById('title')?.textContent).toBe('Incidents (1 of 20)');
  });
});
