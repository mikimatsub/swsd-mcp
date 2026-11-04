// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Payload, RenderTargets, renderPayload as RenderPayload, renderRow as RenderRow } from '../../../src/ui/change-calendar/index.js';
import type { MountAppOptions } from '../../../src/ui/shared/host.js';
import { el } from '../../../src/ui/shared/dom.js';
import { toCalendarItem } from '../../../src/swsd/mappers/changeCalendar.js';
import fixture from '../mappers/fixtures/change-calendar-api.json';

const host = vi.hoisted(() => ({ openLink: vi.fn().mockResolvedValue({}), options: undefined as MountAppOptions<Payload> | undefined }));
vi.mock('../../../src/ui/shared/host.js', () => ({ mountApp: vi.fn(async (options: MountAppOptions<Payload>) => {
  host.options = options;
  return { openLink: host.openLink };
}) }));
let renderPayload: typeof RenderPayload;
let renderRow: typeof RenderRow;
let targets: RenderTargets;
const item = { ...toCalendarItem(fixture.change, 'change')!, id: 1, name: 'Database patch',
  planned_start_at: '2026-11-10T09:00:00Z', planned_end_at: '2026-11-10T11:00:00Z' };
const conflict = { a: { kind: 'change' as const, id: 1 }, b: { kind: 'release' as const, id: 1 },
  reasons: ['shared CI: Database', 'same group: Ops'], overlap_start: item.planned_start_at, overlap_end: item.planned_end_at };

beforeEach(async () => {
  vi.resetModules();
  host.openLink.mockClear();
  targets = { title: el('h1', { id: 'title' }), window: el('p', { id: 'window' }), chips: el('div', { id: 'chips' }),
    days: el('div', { id: 'days' }), empty: el('p', { id: 'empty' }), notice: el('p', { id: 'notice' }) };
  document.body.replaceChildren(el('main', { id: 'root' }, Object.values(targets)));
  ({ renderPayload, renderRow } = await import('../../../src/ui/change-calendar/index.js'));
});

describe('change calendar rendering', () => {
  it('renders day sections, four row cells, kind pills, local-time window and accurate chips', () => {
    const items = [item, { ...item, kind: 'release' as const, conflict_count: 1, planned_start_at: '2026-11-12T09:00:00Z', planned_end_at: undefined }];
    host.options!.onResult({ items, conflicts: [conflict], window: { from: '2026-11-10', to: '2026-11-13' } });
    expect(targets.title.textContent).toBe('Change calendar');
    expect(targets.window.textContent).toMatch(/· times in \S+/);
    expect([...targets.chips.children].map(c => c.textContent)).toEqual(['Changes 1', 'Releases 1', 'Conflicts 1']);
    expect(targets.chips.lastElementChild?.className).toBe('chip conflict');
    expect([...targets.days.querySelectorAll('h2')].map(e => e.textContent)).toEqual(['Tue, Nov 10', 'Thu, Nov 12']);
    const rows = targets.days.querySelectorAll('.calendar-row');
    expect(rows).toHaveLength(2);
    expect([...rows[0]!.children].map(e => e.className)).toEqual(['time', 'pill change', 'name-cell', 'badge-cell']);
    expect(rows[0]?.querySelector('.range')?.textContent).toMatch(/^\d\d:\d\d–\d\d:\d\d$/);
    expect(rows[0]?.querySelector('.meta')?.textContent).toBe(`${item.state!} · Helpdesk Team · John Doe`);
    expect(rows[1]?.querySelector('.pill')?.textContent).toBe('Release');
    expect(targets.empty.hidden).toBe(true);
  });
  it('accents conflicting rows and explains both reasons in the badge title', () => {
    const row = renderRow({ ...item, conflict_count: 1 }, [conflict]);
    expect(row.classList.contains('has-conflict')).toBe(true);
    expect(row.querySelector('.badge')?.textContent).toBe('Conflict');
    expect(row.querySelector('.badge')?.getAttribute('title')).toBe('shared CI: Database\nsame group: Ops');
    expect(renderRow(item, [conflict]).querySelector('.badge')).toBeNull();
  });
  it('renders untrusted names as text with full tooltips and safe links', () => {
    const name = '<img src=x onerror=alert(1)> A very long change name';
    const row = renderRow({ ...item, name, url: 'https://tenant.example/changes/1' }, []);
    expect(row.querySelector('img')).toBeNull();
    expect(row.querySelector('.name-cell')?.getAttribute('title')).toBe(name);
    const anchor = row.querySelector('a')!;
    expect(anchor.textContent).toBe(name);
    expect(anchor.title).toBe(name);
    expect(anchor.rel).toBe('noopener noreferrer');
    expect(anchor.target).toBe('_blank');
  });
  it.each(['javascript:alert(1)', '//evil.example/path', 'data:text/html,bad', undefined])('leaves unsafe/missing URL %s as text', url => {
    const row = renderRow({ ...item, url }, []);
    expect(row.querySelector('a')).toBeNull();
    expect(row.querySelector('.name')?.textContent).toBe('Database patch');
  });
  it('uses host-mediated navigation for safe links', async () => {
    renderPayload(targets, { items: [{ ...item, url: 'https://tenant.example/changes/1' }], conflicts: [] });
    targets.days.querySelector('a')!.click();
    await Promise.resolve();
    expect(host.openLink).toHaveBeenCalledWith({ url: 'https://tenant.example/changes/1' });
    targets.title.click();
    expect(host.openLink).toHaveBeenCalledTimes(1);
  });
  it('shows empty and partial-scan states and clears previous render content', () => {
    renderPayload(targets, { items: [item], conflicts: [conflict] });
    renderPayload(targets, { items: [], conflicts: [], scan: { pages_fetched: { change: 3, release: 3 }, rows_scanned: 600, unscheduled: 4, truncated: true } });
    expect(targets.days.children).toHaveLength(0);
    expect(targets.empty.hidden).toBe(false);
    expect(targets.empty.textContent).toBe('No scheduled changes or releases match this window and filters.');
    expect(targets.notice.hidden).toBe(false);
    expect(targets.notice.textContent).toContain('More scheduled work and conflicts may exist');
    expect([...targets.chips.children].map(e => e.textContent)).toEqual(['Changes 0', 'Releases 0', 'Conflicts 0']);
    renderPayload(targets, null);
    expect(targets.notice.hidden).toBe(true);
    expect(targets.notice.textContent).toBe('');
    expect(targets.window.textContent).toMatch(/^Upcoming changes and releases · times in /);
  });
  it('renders tool errors through the shared error component', () => {
    host.options!.onError!({ message: 'Forbidden calendar' });
    expect(document.getElementById('root')?.textContent).toContain('Forbidden calendar');
  });
  it('keeps responsive, theme and content-sizing CSS contracts', () => {
    const css = readFileSync('src/ui/change-calendar/styles.css', 'utf8');
    expect(css).toContain('grid-template-columns: 6.25rem 4.25rem minmax(0,1fr) 4.75rem');
    expect(css).toContain('-webkit-line-clamp: 2');
    expect(css).toMatch(/@media \(max-width: 600px\)[\s\S]*?\.calendar-row \{ gap: 10px; grid-template-columns: 5\.75rem/);
    expect(css).toMatch(/@media \(max-width: 440px\)[\s\S]*?\.time \{ grid-column: 1 \/ -1/);
    expect(css).toContain(':root[data-theme="dark"] { color-scheme: dark; }');
    expect(css).toContain(':root[data-theme="light"] { color-scheme: light; }');
    expect(css).toContain('light-dark(');
    expect(css).not.toMatch(/overflow-x|(?:^|[;{]\s*)(?:min-|max-)?height\s*:/);
    expect(css).not.toMatch(/line-height:\s*[\d.]+(?:rem|em|%)/);
  });
});
