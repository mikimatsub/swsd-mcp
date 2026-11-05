import { mountApp } from '../shared/host.js';
import { el, clear } from '../shared/dom.js';
import { clearError, renderError } from '../shared/error.js';
import {
  filterFields,
  extractFilterOptions,
  sortFieldsByName,
  type CustomField,
  type Filters,
} from './logic.js';

/**
 * Payload shape: this UI is mounted by `swsd_describe_custom_fields`, which
 * returns `structuredContent: { custom_fields: CustomFieldSummary[],
 * pagination: {...} }`. The CustomFieldSummary contract lives at
 * `src/swsd/types.ts:95-110` and the mapper at
 * `src/swsd/mappers/customField.ts` keeps the shape consistent.
 *
 * The UI offers four interactive filter dimensions:
 *   - Text search (`#search`)         → substring match on `name` and `help_text`
 *   - Scope <select> (`#scope-filter`) → populated from unique `scope` values
 *   - Module <select> (`#module-filter`) → populated from unique `module` values
 *   - "Active only" toggle (`#active-only`) → defaults to checked
 *
 * All dropdown options are constructed via the safe-DOM helper (`el`), never
 * via `innerHTML`. The card layout uses `<details>` for picklist value
 * expanders so users can drill into Dropdown / Multi-picklist values without
 * exploding the card height.
 *
 * Pure filter/sort logic lives in `./logic.ts` and is unit-tested directly.
 * This file is the DOM wiring layer.
 */

interface Pagination {
  page?: number;
  per_page?: number;
  total?: number;
  has_more?: boolean;
  next_page?: number;
}

interface Payload {
  custom_fields: CustomField[];
  pagination?: Pagination;
}

let all: CustomField[] = [];

const rootEl = document.getElementById('root');
const titleEl = document.getElementById('title');
const searchEl = document.getElementById('search') as HTMLInputElement | null;
const scopeFilterEl = document.getElementById('scope-filter') as HTMLSelectElement | null;
const moduleFilterEl = document.getElementById('module-filter') as HTMLSelectElement | null;
const activeOnlyEl = document.getElementById('active-only') as HTMLInputElement | null;
const rowsEl = document.getElementById('rows');
const emptyEl = document.getElementById('empty') as HTMLParagraphElement | null;

if (
  !rootEl ||
  !titleEl ||
  !searchEl ||
  !scopeFilterEl ||
  !moduleFilterEl ||
  !activeOnlyEl ||
  !rowsEl ||
  !emptyEl
) {
  throw new Error(
    'custom-fields UI: missing one of #root, #title, #search, #scope-filter, #module-filter, #active-only, #rows, #empty',
  );
}

mountApp<Payload>({
  name: 'swsd-mcp/custom-fields',
  version: '2.0.1',
  onResult: (data) => {
    clearError(rootEl);
    if (Array.isArray(data?.custom_fields)) {
      all = data.custom_fields;
    }
    updateTitle(all.length, data?.pagination);
    populateFilter(scopeFilterEl, extractFilterOptions(all, 'scope'));
    populateFilter(moduleFilterEl, extractFilterOptions(all, 'module'));
    render();
  },
  onError: ({ message }) => {
    renderError(rootEl, message);
  },
}).catch((err) => {
  console.error('custom-fields: failed to connect MCP App', err);
});

searchEl.addEventListener('input', render);
scopeFilterEl.addEventListener('change', render);
moduleFilterEl.addEventListener('change', render);
activeOnlyEl.addEventListener('change', render);

function updateTitle(shown: number, pagination: Pagination | undefined): void {
  if (!titleEl) return;
  const total = pagination?.total;
  if (typeof total === 'number') {
    titleEl.textContent = `Custom Fields (${String(shown)} of ${String(total)})`;
  } else {
    titleEl.textContent = `Custom Fields (${String(shown)})`;
  }
}

function populateFilter(select: HTMLSelectElement, values: readonly string[]): void {
  // Preserve the leading "All …" sentinel <option> from the static HTML;
  // remove only the dynamically-added ones so a re-init from another `init`
  // message doesn't double the list.
  while (select.options.length > 1) {
    select.remove(1);
  }
  for (const v of values) {
    select.appendChild(el('option', { value: v }, [v]));
  }
}

function render(): void {
  if (!searchEl || !scopeFilterEl || !moduleFilterEl || !activeOnlyEl || !rowsEl || !emptyEl) {
    return;
  }
  const filters: Filters = {
    q: searchEl.value,
    scope: scopeFilterEl.value,
    module: moduleFilterEl.value,
    activeOnly: activeOnlyEl.checked,
  };
  const filtered = sortFieldsByName(filterFields(all, filters));

  clear(rowsEl);
  for (const f of filtered) {
    rowsEl.appendChild(renderCard(f));
  }
  emptyEl.hidden = filtered.length > 0;
}

function renderCard(f: CustomField): HTMLLIElement {
  const badges = el('div', { class: 'badges' });
  if (f.required) {
    badges.appendChild(el('span', { class: 'badge required' }, ['Required']));
  }
  if (!f.active) {
    badges.appendChild(el('span', { class: 'badge inactive' }, ['Inactive']));
  }
  if (f.searchable) {
    badges.appendChild(el('span', { class: 'badge' }, ['Searchable']));
  }
  if (f.scope) {
    badges.appendChild(el('span', { class: 'badge scope' }, [f.scope]));
  }
  if (f.module) {
    badges.appendChild(el('span', { class: 'badge module' }, [f.module]));
  }

  const cardChildren: HTMLElement[] = [
    el('header', { class: 'card-header' }, [
      el('h2', undefined, [f.name]),
      el('span', { class: 'type' }, [f.type]),
    ]),
  ];
  if (badges.childElementCount > 0) {
    cardChildren.push(badges);
  }

  const card = el('li', { class: 'card' }, cardChildren);

  if (f.help_text) {
    card.appendChild(el('p', { class: 'help' }, [f.help_text]));
  }
  if (f.values?.length) {
    const list = el('ul', { class: 'values' });
    for (const v of f.values) {
      list.appendChild(el('li', undefined, [v]));
    }
    card.appendChild(
      el('details', undefined, [
        el('summary', undefined, [
          `${String(f.values.length)} ${f.values.length === 1 ? 'value' : 'values'}`,
        ]),
        list,
      ]),
    );
  }
  return card;
}
