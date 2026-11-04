import { mountApp } from '../shared/host.js';
import { el, clear } from '../shared/dom.js';
import { renderError } from '../shared/error.js';
import { pickString, pickNumber, isSafeHttpUrl } from '../shared/format.js';
import {
  RISK_LABELS,
  RISK_CHIP_CLASSES,
  RISK_PILL_CLASSES,
  formatDueText,
  type RiskLevel,
} from './logic.js';

interface SlaViolation {
  name?: string;
  violation_type?: string;
}

interface RiskIncident {
  id: number;
  number?: number;
  name: string;
  state?: string;
  priority?: string;
  assignee_email?: string;
  updated_at?: string;
  url?: string;
  due_at?: string;
  minutes_to_breach?: number;
  risk: 'breached' | 'critical' | 'warning' | 'ok' | 'no_due_date';
  sla_violations: SlaViolation[];
}

interface Payload {
  incidents: RiskIncident[];
  counts?: Record<string, number>;
  now?: string;
}

const rootEl = document.getElementById('root');
const titleEl = document.getElementById('title');
const chipsEl = document.getElementById('chips');
const rowsEl = document.getElementById('rows');
const emptyEl = document.getElementById('empty') as HTMLParagraphElement | null;

if (!rootEl || !titleEl || !chipsEl || !rowsEl || !emptyEl) {
  throw new Error('sla-risk UI: missing required DOM elements');
}

// After the guard above, all elements are non-null. Capture narrowed refs
// so TypeScript doesn't re-widen them inside closures/callbacks.
const title = titleEl;
const chips = chipsEl;
const rows = rowsEl;
const empty = emptyEl;

mountApp<Payload>({
  name: 'swsd-mcp/sla-risk',
  version: '1.0.0',
  onResult: (data) => {
    const incidents = Array.isArray(data?.incidents) ? data.incidents : [];
    const counts = data?.counts ?? {};
    updateTitle(incidents.length);
    renderChips(counts);
    renderRows(incidents);
  },
  onError: ({ message }) => {
    renderError(rootEl, message);
  },
}).catch((err) => {
  console.error('sla-risk: failed to connect MCP App', err);
});

function updateTitle(shown: number): void {
  title.textContent = `SLA Risk (${String(shown)})`;
}

function renderChips(counts: Record<string, number>): void {
  clear(chips);
  const levels: RiskLevel[] = ['breached', 'critical', 'warning', 'ok', 'no_due_date'];
  for (const level of levels) {
    const count = counts[level] ?? 0;
    if (count === 0) continue;
    chips.appendChild(
      el('span', { class: RISK_CHIP_CLASSES[level] }, [
        `${RISK_LABELS[level]}: ${String(count)}`,
      ]),
    );
  }
}

function renderRows(incidents: RiskIncident[]): void {
  clear(rows);
  for (const inc of incidents) {
    rows.appendChild(renderRow(inc));
  }
  empty.hidden = incidents.length > 0;
}

function renderRow(inc: RiskIncident): HTMLTableRowElement {
  const number = pickNumber(inc as unknown as Record<string, unknown>, 'number');
  const name = pickString(inc as unknown as Record<string, unknown>, 'name') ?? '';
  const priority = pickString(inc as unknown as Record<string, unknown>, 'priority') ?? '';
  const assignee = pickString(inc as unknown as Record<string, unknown>, 'assignee_email') ?? '';
  const url = pickString(inc as unknown as Record<string, unknown>, 'url');
  const risk = inc.risk;

  const numberCell = el('td', undefined, [number !== undefined ? `#${String(number)}` : '']);

  const nameCell =
    name && url && isSafeHttpUrl(url)
      ? el('td', undefined, [
          el('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, [name]),
        ])
      : el('td', undefined, [name]);

  const riskCell = el('td', undefined, [
    el('span', { class: RISK_PILL_CLASSES[risk] }, [RISK_LABELS[risk]]),
  ]);

  const dueText = formatDueText(inc.minutes_to_breach, risk);
  const dueCell = el('td', undefined, [dueText]);

  return el('tr', undefined, [
    numberCell,
    nameCell,
    riskCell,
    dueCell,
    el('td', undefined, [priority]),
    el('td', undefined, [assignee]),
  ]);
}
