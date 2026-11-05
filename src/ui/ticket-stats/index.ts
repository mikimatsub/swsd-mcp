import { mountApp } from '../shared/host.js';
import { el, clear } from '../shared/dom.js';
import { renderError } from '../shared/error.js';
import { barPercent, breakdownRows, countValue, formatHours, formatWindowDate } from './logic.js';
import type { TicketStatsOutput } from '../../schemas/ticketStats.js';

export type Payload = TicketStatsOutput;
const root = document.getElementById('root');
if (!root) throw new Error('ticket-stats UI: missing root');
const rootEl = root;

mountApp<Payload>({
  name: 'swsd-mcp/ticket-stats',
  version: '1.0.0',
  onResult: (data) => renderPayload(rootEl, data),
  onError: ({ message }) => renderError(rootEl, message),
}).catch((err: unknown) => {
  console.error('ticket-stats: failed to connect MCP App', err);
  renderError(rootEl, 'Unable to connect to the app host.');
});

export function renderPayload(target: HTMLElement, data: Payload | null | undefined): void {
  clear(target);
  const total = countValue(data?.totals?.total);
  const from = formatWindowDate(data?.window?.from);
  const to = formatWindowDate(data?.window?.to);
  target.appendChild(el('header', undefined, [
    el('h1', undefined, ['Ticket Stats']),
    el('p', { id: 'window', title: from + ' – ' + to }, [from + ' – ' + to]),
  ]));
  const tiles = el('div', { class: 'kpis', 'aria-label': 'Ticket totals' });
  const metrics = [
    ['Total scanned', total, ''],
    ['Open', countValue(data?.totals?.open), ''],
    ['Created', countValue(data?.totals?.created_in_window), ''],
    ['Resolved', countValue(data?.totals?.resolved_in_window), ''],
    ['Breached', countValue(data?.totals?.breached), 'breached'],
    ['Unassigned', countValue(data?.totals?.unassigned), ''],
  ] as const;
  const numberFormat = new Intl.NumberFormat();
  for (const [label, count, tone] of metrics) {
    tiles.appendChild(el('div', { class: 'kpi ' + tone }, [
      el('span', { class: 'kpi-label', title: label }, [label]),
      el('strong', { class: 'kpi-value' }, [numberFormat.format(count)]),
    ]));
  }
  target.appendChild(tiles);
  target.appendChild(el('p', { class: 'resolution' }, [
    'Median resolution: ', el('strong', undefined, [formatHours(data?.median_resolution_hours)]),
  ]));
  if (data?.scan?.truncated) {
    target.appendChild(el('p', { class: 'notice', role: 'status' }, [
      'Partial scan — more tickets may exist. Increase max_pages to scan more.',
    ]));
  }
  if (total === 0) {
    target.appendChild(el('p', { class: 'empty' }, ['No incidents match this window and group.']));
  } else {
    const breakdowns = el('div', { class: 'breakdowns' });
    const groups = [
      ['By state', data?.by_state, 'state', undefined],
      ['By priority', data?.by_priority, 'priority', undefined],
      ['By assignee · Top 10', data?.by_assignee, 'email', 10],
      ['By category · Top 10', data?.by_category, 'category', 10],
    ] as const;
    for (const [heading, values, key, limit] of groups) {
      const section = el('section', { class: 'breakdown' }, [el('h2', undefined, [heading])]);
      const rows = breakdownRows(values, key, limit);
      if (rows.length === 0) {
        section.appendChild(el('p', { class: 'empty' }, ['No data available.']));
      } else {
        const body = el('tbody');
        for (const row of rows) {
          const bar = el('span', { class: 'bar', 'aria-hidden': 'true' });
          bar.style.width = String(barPercent(row.count, total)) + '%';
          body.appendChild(el('tr', undefined, [
            el('td', { class: 'label', title: row.label }, [row.label]),
            el('td', { class: 'numeric' }, [numberFormat.format(row.count)]),
            el('td', { class: 'share', 'aria-label': String(Math.round(barPercent(row.count, total))) + '% of scanned tickets' }, [
              el('span', { class: 'track' }, [bar]),
            ]),
          ]));
        }
        section.appendChild(el('table', { 'aria-label': heading }, [
          el('thead', undefined, [el('tr', undefined, [
            el('th', { scope: 'col' }, ['Name']),
            el('th', { scope: 'col', class: 'numeric' }, ['Count']),
            el('th', { scope: 'col', class: 'share' }, ['Share']),
          ])]), body,
        ]));
      }
      breakdowns.appendChild(section);
    }
    target.appendChild(breakdowns);
  }
  target.appendChild(el('p', { class: 'footnote' }, [
    String(countValue(data?.scan?.pages_scanned)) + ' pages scanned. Counts cover scanned tickets created or updated in this window; states are current. Resolution metrics exclude missing timestamps.',
  ]));
}
