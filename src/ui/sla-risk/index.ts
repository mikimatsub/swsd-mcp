import { mountApp } from '../shared/host.js';
import { el, clear } from '../shared/dom.js';
import { clearError, renderError } from '../shared/error.js';
import { pickString, pickNumber, isSafeHttpUrl } from '../shared/format.js';
import {
  RISK_LABELS,
  RISK_CHIP_CLASSES,
  RISK_PILL_CLASSES,
  RISK_LEVELS,
  formatDueText,
  normalizeRisk,
} from './logic.js';

/**
 * Payload shape: mounted by `swsd_sla_risk`, which returns
 * `structuredContent: { incidents: [...], counts, now, pagination, ... }`.
 *
 * Field mapping (payload -> table column):
 *   number            -> "#"      (hidden below 440px; shown as a muted prefix
 *                                  inside the Name cell instead)
 *   name              -> "Name"   (linked via `url` when safe http(s))
 *   risk              -> "Risk"   (pill, colored per risk level)
 *   minutes_to_breach -> "Due"    (relative text, tabular numerals)
 *   priority          -> "Priority"
 *   assignee_email    -> "Assignee"
 *
 * `name` is truncated with a CSS ellipsis in narrow hosts, so both the cell
 * and the link carry a `title` attribute with the full value.
 */

export interface SlaViolation {
  name?: string;
  violation_type?: string;
}

export interface RiskIncident {
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

export interface Payload {
  incidents: RiskIncident[];
  counts?: Record<string, number>;
  now?: string;
}

/**
 * Column class names, shared between the `<th>` elements in index.html and
 * the `<td>` elements rendered below. The responsive rules in styles.css hide
 * `col-priority`/`col-assignee` below 640px and `col-number` below 440px, so
 * both the header cell and the body cell must carry the same class.
 */
export const COLUMN_CLASSES = {
  number: 'col-number',
  name: 'col-name',
  risk: 'col-risk',
  due: 'col-due',
  priority: 'col-priority',
  assignee: 'col-assignee',
} as const;

/** DOM references a render pass writes into. */
export interface RenderTargets {
  title: HTMLElement | null;
  chips: HTMLElement;
  rows: HTMLElement;
  empty: HTMLElement | null;
}

const rootEl = document.getElementById('root');
const titleEl = document.getElementById('title');
const chipsEl = document.getElementById('chips');
const rowsEl = document.getElementById('rows');
const emptyEl = document.getElementById('empty');

if (!rootEl || !titleEl || !chipsEl || !rowsEl || !emptyEl) {
  throw new Error('sla-risk UI: missing required DOM elements');
}

// After the guard above, all elements are non-null. Capture narrowed refs
// so TypeScript doesn't re-widen them inside closures/callbacks.
const targets: RenderTargets = {
  title: titleEl,
  chips: chipsEl,
  rows: rowsEl,
  empty: emptyEl,
};

mountApp<Payload>({
  name: 'swsd-mcp/sla-risk',
  version: '1.1.0',
  onResult: (data) => {
    clearError(rootEl);
    renderPayload(targets, data);
  },
  onError: ({ message }) => {
    renderError(rootEl, message);
  },
}).catch((err) => {
  console.error('sla-risk: failed to connect MCP App', err);
});

/**
 * Render a full tool payload into `targets`. Exported (like
 * incident-detail's `renderIncident`) so unit tests can drive it without the
 * MCP Apps handshake.
 */
export function renderPayload(
  target: RenderTargets,
  data: Payload | undefined | null,
): void {
  const incidents = Array.isArray(data?.incidents) ? data.incidents : [];
  const counts = data?.counts ?? {};
  renderTitle(target.title, incidents.length);
  renderChips(target.chips, counts);
  renderRows(target.rows, incidents);
  if (target.empty) target.empty.hidden = incidents.length > 0;
}

export function renderTitle(titleEl: HTMLElement | null, shown: number): void {
  if (!titleEl) return;
  titleEl.textContent = `SLA Risk (${String(shown)})`;
}

export function renderChips(
  chipsEl: HTMLElement,
  counts: Record<string, number>,
): void {
  clear(chipsEl);
  for (const level of RISK_LEVELS) {
    const count = counts[level] ?? 0;
    if (count === 0) continue;
    chipsEl.appendChild(
      el('span', { class: RISK_CHIP_CLASSES[level] }, [
        `${RISK_LABELS[level]}: ${String(count)}`,
      ]),
    );
  }
}

export function renderRows(rowsEl: HTMLElement, incidents: RiskIncident[]): void {
  clear(rowsEl);
  for (const inc of incidents) {
    rowsEl.appendChild(renderRow(inc));
  }
}

export function renderRow(inc: RiskIncident): HTMLTableRowElement {
  const record = inc as unknown as Record<string, unknown>;
  const number = pickNumber(record, 'number');
  const name = pickString(record, 'name') ?? '';
  const priority = pickString(record, 'priority') ?? '';
  const assignee = pickString(record, 'assignee_email') ?? '';
  const url = pickString(record, 'url');
  const risk = normalizeRisk(inc.risk);
  const numberText = number !== undefined ? `#${String(number)}` : '';

  return el('tr', undefined, [
    el('td', { class: COLUMN_CLASSES.number }, [numberText]),
    renderNameCell(name, url, numberText),
    el('td', { class: COLUMN_CLASSES.risk }, [
      el('span', { class: RISK_PILL_CLASSES[risk] }, [RISK_LABELS[risk]]),
    ]),
    el('td', { class: COLUMN_CLASSES.due }, [
      formatDueText(inc.minutes_to_breach, risk),
    ]),
    el('td', { class: COLUMN_CLASSES.priority }, [priority]),
    el('td', { class: COLUMN_CLASSES.assignee, title: assignee || undefined }, [
      assignee,
    ]),
  ]);
}

/**
 * Name cell: a muted `#<n>` prefix (only visible below 440px, where the
 * dedicated number column is hidden) plus the name, which truncates with an
 * ellipsis. Both the cell and the link carry `title="<full name>"` so the
 * host can surface the untruncated value on hover.
 */
function renderNameCell(
  name: string,
  url: string | undefined,
  numberText: string,
): HTMLTableCellElement {
  const label =
    name && url && isSafeHttpUrl(url)
      ? el(
          'a',
          {
            class: 'name',
            href: url,
            target: '_blank',
            rel: 'noopener noreferrer',
            title: name,
          },
          [name],
        )
      : el('span', { class: 'name', title: name || undefined }, [name]);

  return el('td', { class: COLUMN_CLASSES.name, title: name || undefined }, [
    el('div', { class: 'name-cell' }, [
      el('span', { class: 'row-number' }, [numberText]),
      label,
    ]),
  ]);
}
