import { mountApp } from '../shared/host.js';
import { el, clear } from '../shared/dom.js';
import { clearError, renderError } from '../shared/error.js';
import { isSafeHttpUrl } from '../shared/format.js';
import type { CalendarConflict, CalendarItem, ChangeCalendarOutput } from '../../schemas/changeCalendar.js';
import { conflictReasons, formatDay, formatTimeRange, formatWindow, groupDays } from './logic.js';

export type Payload = Pick<ChangeCalendarOutput, 'items' | 'conflicts'> & Partial<Pick<ChangeCalendarOutput, 'window' | 'scan'>>;
export interface RenderTargets {
  title: HTMLElement;
  window: HTMLElement;
  chips: HTMLElement;
  days: HTMLElement;
  empty: HTMLElement;
  notice: HTMLElement;
}

export function renderChips(target: HTMLElement, items: readonly CalendarItem[], conflicts: readonly CalendarConflict[]): void {
  clear(target);
  for (const [label, count, kind] of [
    ['Changes', items.filter(i => i.kind === 'change').length, 'change'],
    ['Releases', items.filter(i => i.kind === 'release').length, 'release'],
    ['Conflicts', conflicts.length, 'conflict'],
  ] as const) {
    target.appendChild(el('span', { class: `chip ${kind}` }, [`${label} ${String(count)}`]));
  }
}

export function renderRow(item: CalendarItem, conflicts: readonly CalendarConflict[]): HTMLElement {
  const name = item.name;
  const label = item.url && isSafeHttpUrl(item.url)
    ? el('a', { class: 'name', title: name, href: item.url, target: '_blank', rel: 'noopener noreferrer' }, [name])
    : el('span', { class: 'name', title: name }, [name]);
  const meta = [item.state, item.group_assignee?.name, item.assignee_name ?? item.assignee_email].filter(Boolean).join(' · ');
  const reasons = conflictReasons(item, conflicts).join('\n');
  const t = formatTimeRange(item);
  return el('li', { class: `calendar-row${item.conflict_count > 0 ? ' has-conflict' : ''}` }, [
    el('span', { class: 'time', title: `${item.planned_start_at} → ${item.planned_end_at ?? 'start + 1 hour (assumed)'}` }, [
      el('span', { class: 'range' }, [t.range]),
      t.until ? el('span', { class: 'until' }, [t.until]) : null,
    ]),
    el('span', { class: `pill ${item.kind}` }, [item.kind === 'change' ? 'Change' : 'Release']),
    el('div', { class: 'name-cell', title: name }, [
      label,
      meta ? el('span', { class: 'meta', title: meta }, [meta]) : null,
    ]),
    el('span', { class: 'badge-cell' }, [
      item.conflict_count > 0 ? el('span', { class: 'badge conflict', title: reasons || 'Overlapping scheduled work', 'aria-label': `Conflict: ${reasons}` }, ['Conflict']) : null,
    ]),
  ]);
}

export function renderDays(target: HTMLElement, items: readonly CalendarItem[], conflicts: readonly CalendarConflict[]): void {
  clear(target);
  for (const day of groupDays(items)) {
    target.appendChild(el('section', { class: 'day', 'aria-label': formatDay(day.date) }, [
      el('h2', undefined, [formatDay(day.date)]),
      el('ul', { class: 'day-rows' }, day.items.map(item => renderRow(item, conflicts))),
    ]));
  }
}

export function renderPayload(target: RenderTargets, data: Payload | undefined | null): void {
  const items = Array.isArray(data?.items) ? data.items : [];
  const conflicts = Array.isArray(data?.conflicts) ? data.conflicts : [];
  target.title.textContent = 'Change calendar';
  target.window.textContent = formatWindow(data?.window);
  renderChips(target.chips, items, conflicts);
  renderDays(target.days, items, conflicts);
  target.empty.hidden = items.length > 0;
  target.empty.textContent = 'No scheduled changes or releases match this window and filters.';
  target.notice.hidden = !data?.scan?.truncated;
  target.notice.textContent = data?.scan?.truncated
    ? 'Partial calendar: the scan limit was reached. More scheduled work and conflicts may exist.' : '';
}

const root = document.getElementById('root');
const title = document.getElementById('title');
const windowText = document.getElementById('window');
const chips = document.getElementById('chips');
const days = document.getElementById('days');
const empty = document.getElementById('empty');
const notice = document.getElementById('notice');
if (!root || !title || !windowText || !chips || !days || !empty || !notice) {
  throw new Error('change-calendar UI: missing required DOM elements');
}
const targets: RenderTargets = { title, window: windowText, chips, days, empty, notice };
// Host-mediated links work inside sandboxed MCP Apps frames.
void mountApp<Payload>({
  name: 'swsd-mcp/change-calendar', version: '1.0.0',
  onResult: data => {
    clearError(root);
    renderPayload(targets, data);
  },
  onError: ({ message }) => renderError(root, message),
}).then(app => {
  root.addEventListener('click', event => {
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a.name') : null;
    if (!anchor || !isSafeHttpUrl(anchor.href)) return;
    event.preventDefault();
    void app.openLink({ url: anchor.href }).catch(err => console.error('change-calendar: failed to open link', err));
  });
}).catch(err => {
  console.error('change-calendar: failed to connect MCP App', err);
  renderError(root, 'Could not connect to the calendar host.');
});
