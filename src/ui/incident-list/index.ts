import { mountApp } from '../shared/host.js';
import { el, clear } from '../shared/dom.js';
import { clearError, renderError } from '../shared/error.js';
import {
  pickString,
  pickNumber,
  pickNestedString,
  formatDate,
  isSafeHttpUrl,
} from '../shared/format.js';
import {
  SORT_KEYS,
  filterAndSort,
  sortIndicator,
  ariaSortValue,
  type Incident,
  type SortKey,
} from './logic.js';

/**
 * Payload shape: this UI is mounted by `swsd_list_incidents`, which returns
 * `structuredContent: { incidents: IncidentSummary[], pagination: {...},
 * applied_filters: {...} }`. The IncidentSummary contract lives at
 * `src/swsd/types.ts:1-13` — flat fields, no nested objects. The pickers below
 * are still defensive against missing/malformed values arriving over the wire.
 *
 * Field mapping (IncidentSummary → table column):
 *   number          → "#"        (formatted as "#<n>")
 *   name            → "Name"     (linked via `url` when safe http(s))
 *   state           → "State"
 *   priority        → "Priority"
 *   assignee_email  → "Assignee"
 *   updated_at      → "Updated"  (formatted as locale string)
 *
 * The "url" field comes from SWSD's `href_account_domain` (mapped server-side)
 * and is not always populated. When present, it's validated by `isSafeHttpUrl`
 * (defense in depth on top of the safe-DOM helper's URL-scheme check) before
 * rendering as an anchor.
 *
 * Interactivity is purely client-side filtering of the already-passed dataset
 * — no re-invocation of the tool. A v2.5 capability could add re-invocation
 * for cross-page navigation, gated on host support.
 *
 * The pure filter/sort/comparator functions live in `./logic.ts` so they can
 * be unit-tested without a DOM. This file is the DOM wiring; `logic.ts` is
 * the canonical entry point for tests.
 */

interface Pagination {
  page?: number;
  per_page?: number;
  total?: number;
  total_scope?: string;
  has_more?: boolean;
  next_page?: number;
}

interface Payload {
  incidents: Incident[];
  pagination?: Pagination;
  applied_filters?: Record<string, unknown>;
}

let all: Incident[] = [];
let sortKey: SortKey = 'updated_at';
let sortDesc = true;

const rootEl = document.getElementById('root');
const titleEl = document.getElementById('title');
const searchEl = document.getElementById('search') as HTMLInputElement | null;
const rowsEl = document.getElementById('rows');
const emptyEl = document.getElementById('empty') as HTMLParagraphElement | null;

if (!rootEl || !titleEl || !searchEl || !rowsEl || !emptyEl) {
  throw new Error('incident-list UI: missing one of #root, #title, #search, #rows, #empty');
}

/**
 * Snapshot each sortable header's original label text BEFORE the first render
 * mutates it. The indicator is re-rendered on every sort toggle, so we keep
 * the labels in this map rather than parsing them back out of the DOM (which
 * would re-include the previous indicator glyph).
 */
const headerLabels = new Map<HTMLTableCellElement, string>();
document.querySelectorAll<HTMLTableCellElement>('th[data-sort]').forEach((th) => {
  headerLabels.set(th, (th.textContent ?? '').trim());
});

mountApp<Payload>({
  name: 'swsd-mcp/incident-list',
  version: '2.0.1',
  onResult: (data) => {
    clearError(rootEl);
    if (Array.isArray(data?.incidents)) {
      all = data.incidents;
    }
    updateTitle(all.length, data?.pagination);
    render();
  },
  onError: ({ message }) => {
    renderError(rootEl, message);
  },
}).catch((err) => {
  console.error('incident-list: failed to connect MCP App', err);
});

searchEl.addEventListener('input', render);
document.querySelectorAll<HTMLTableCellElement>('th[data-sort]').forEach((th) => {
  th.addEventListener('click', () => {
    const raw = th.getAttribute('data-sort');
    if (!raw || !SORT_KEYS.has(raw as SortKey)) return;
    const key = raw as SortKey;
    if (sortKey === key) {
      sortDesc = !sortDesc;
    } else {
      sortKey = key;
      sortDesc = false;
    }
    render();
  });
});

function updateTitle(shown: number, pagination: Pagination | undefined): void {
  if (!titleEl) return;
  const total = pagination?.total;
  const scope = typeof pagination?.total_scope === 'string' ? pagination.total_scope : undefined;
  if (typeof total === 'number') {
    titleEl.textContent = `Incidents (${String(shown)} of ${String(total)}${
      scope ? `, ${scope}` : ''
    })`;
  } else {
    titleEl.textContent = `Incidents (${String(shown)})`;
  }
}

function render(): void {
  if (!searchEl || !rowsEl || !emptyEl) return;
  renderHeaders();
  const filtered = filterAndSort(all, searchEl.value, sortKey, sortDesc);

  clear(rowsEl);
  for (const i of filtered) {
    rowsEl.appendChild(renderRow(i));
  }
  emptyEl.hidden = filtered.length > 0;
}

/**
 * Updates each sortable column header to reflect the current sort state.
 *
 * Sets `aria-sort` to `'ascending' | 'descending' | 'none'` for assistive
 * tech, and renders a visible ▲/▼ glyph (in a fixed-width `.sort-indicator`
 * span) on the active column. Inactive columns get an empty indicator span
 * so the layout doesn't shift when toggling sort.
 *
 * Header labels are read from `headerLabels` (snapshotted at module init);
 * we never re-parse them from the DOM, otherwise an existing indicator glyph
 * would be folded into the label on the next render.
 */
function renderHeaders(): void {
  for (const [th, label] of headerLabels) {
    const raw = th.getAttribute('data-sort');
    if (!raw || !SORT_KEYS.has(raw as SortKey)) continue;
    const active = (raw as SortKey) === sortKey;
    th.setAttribute('aria-sort', ariaSortValue(active, sortDesc));
    clear(th);
    th.appendChild(document.createTextNode(label));
    th.appendChild(
      el('span', { class: 'sort-indicator', 'aria-hidden': 'true' }, [
        sortIndicator(active, sortDesc),
      ]),
    );
  }
}

function renderRow(inc: Incident): HTMLTableRowElement {
  const number = pickNumber(inc, 'number');
  const name = pickString(inc, 'name') ?? '';
  const state = pickString(inc, 'state') ?? '';
  const priority = pickString(inc, 'priority') ?? '';
  const assignee = pickString(inc, 'assignee_email') ?? pickNestedString(inc, 'assignee', 'email') ?? '';
  const updatedAt = pickString(inc, 'updated_at');
  const url = pickString(inc, 'url') ?? pickString(inc, 'href_account_domain');

  const numberCell = el('td', undefined, [number !== undefined ? `#${String(number)}` : '']);
  const nameCell =
    name && url && isSafeHttpUrl(url)
      ? el('td', undefined, [
          el('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, [name]),
        ])
      : el('td', undefined, [name]);

  return el('tr', undefined, [
    numberCell,
    nameCell,
    el('td', undefined, [state]),
    el('td', undefined, [priority]),
    el('td', undefined, [assignee]),
    el('td', undefined, [updatedAt ? formatDate(updatedAt) : '']),
  ]);
}
