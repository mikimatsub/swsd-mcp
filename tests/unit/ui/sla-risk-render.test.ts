// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import type {
  renderPayload as RenderPayloadFn,
  renderRows as RenderRowsFn,
  renderChips as RenderChipsFn,
  Payload,
  RenderTargets,
  RiskIncident,
} from '../../../src/ui/sla-risk/index.js';

/**
 * Unit tests for the sla-risk widget's render functions.
 *
 * `renderPayload` / `renderRows` / `renderChips` are exported from
 * `src/ui/sla-risk/index.ts` so these tests can drive them without going
 * through the MCP Apps handshake. The module is imported dynamically AFTER a
 * full widget-shaped DOM exists, because its top-level
 * `document.getElementById(...)` guard throws otherwise.
 *
 * Coverage:
 *   - rows: one <tr> per incident, with the responsive column classes
 *   - pills: risk level -> pill class + label
 *   - due: relative due text from minutes_to_breach
 *   - title tooltip: full (untruncated) name on the cell and the link
 *   - links: only safe http(s) URLs become anchors (javascript: stays text)
 *   - empty state: shown for an empty payload, hidden once rows exist
 *   - chips: one chip per non-zero risk count
 */

let renderPayload: typeof RenderPayloadFn;
let renderRows: typeof RenderRowsFn;
let renderChips: typeof RenderChipsFn;

function ensureDom(): RenderTargets {
  // Reset the document between tests without assigning an HTML string, so
  // each test gets a pristine widget shell.
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);

  const root = document.createElement('main');
  root.id = 'root';

  const header = document.createElement('header');
  const title = document.createElement('h1');
  title.id = 'title';
  const chips = document.createElement('div');
  chips.id = 'chips';
  header.appendChild(title);
  header.appendChild(chips);

  const table = document.createElement('table');
  const tbody = document.createElement('tbody');
  tbody.id = 'rows';
  table.appendChild(tbody);

  const empty = document.createElement('p');
  empty.id = 'empty';
  empty.hidden = true;
  // Mirrors the copy in src/ui/sla-risk/index.html.
  empty.textContent = 'No incidents match the current filters.';

  root.appendChild(header);
  root.appendChild(table);
  root.appendChild(empty);
  document.body.appendChild(root);

  return { title, chips, rows: tbody, empty };
}

let targets: RenderTargets;

beforeEach(async () => {
  targets = ensureDom();
  if (!renderPayload) {
    ({ renderPayload, renderRows, renderChips } = await import(
      '../../../src/ui/sla-risk/index.js'
    ));
  }
});

function inc(overrides: Partial<RiskIncident> = {}): RiskIncident {
  return {
    id: 1,
    number: 1001,
    name: 'Printer offline',
    risk: 'ok',
    sla_violations: [],
    ...overrides,
  };
}

function payload(incidents: RiskIncident[], counts: Record<string, number> = {}): Payload {
  return { incidents, counts, now: '2026-01-01T00:00:00.000Z' };
}

function rows(): HTMLTableRowElement[] {
  return Array.from(targets.rows.querySelectorAll('tr'));
}

function cells(row: HTMLTableRowElement): HTMLTableCellElement[] {
  return Array.from(row.querySelectorAll('td'));
}

describe('sla-risk renderPayload -- rows', () => {
  it('renders one row per incident with the responsive column classes', () => {
    renderPayload(
      targets,
      payload([
        inc({ id: 1, number: 1001, name: 'Printer offline' }),
        inc({ id: 2, number: 1002, name: 'VPN down', risk: 'breached' }),
      ]),
    );

    const rendered = rows();
    expect(rendered).toHaveLength(2);

    const classes = cells(rendered[0]!).map((td) => td.className);
    expect(classes).toEqual([
      'col-number',
      'col-name',
      'col-risk',
      'col-due',
      'col-priority',
      'col-assignee',
    ]);
  });

  it('renders the number as "#<n>" in the number cell', () => {
    renderPayload(targets, payload([inc({ number: 4711 })]));
    const [numberCell] = cells(rows()[0]!);
    expect(numberCell?.textContent).toBe('#4711');
  });

  it('leaves the number cell blank when the payload omits number', () => {
    renderPayload(targets, payload([inc({ number: undefined })]));
    const [numberCell] = cells(rows()[0]!);
    expect(numberCell?.textContent).toBe('');
  });
});

describe('sla-risk renderPayload -- risk pills', () => {
  it.each([
    ['breached', 'pill pill-breached', 'Breached'],
    ['critical', 'pill pill-critical', 'Critical'],
    ['warning', 'pill pill-warning', 'Warning'],
    ['ok', 'pill pill-ok', 'OK'],
    ['no_due_date', 'pill pill-nodate', 'No Due Date'],
  ] as const)('renders the %s pill with class "%s"', (risk, className, label) => {
    renderPayload(targets, payload([inc({ risk })]));

    const pill = rows()[0]?.querySelector('.pill');
    expect(pill).not.toBeNull();
    expect(pill?.className).toBe(className);
    expect(pill?.textContent).toBe(label);
  });

  it('falls back to the no-due-date pill for an unknown risk value', () => {
    renderPayload(targets, payload([inc({ risk: 'bogus' as RiskIncident['risk'] })]));
    expect(rows()[0]?.querySelector('.pill')?.className).toBe('pill pill-nodate');
  });
});

describe('sla-risk renderPayload -- due column', () => {
  it('renders overdue text for negative minutes_to_breach', () => {
    renderPayload(
      targets,
      payload([inc({ risk: 'breached', minutes_to_breach: -192 })]),
    );
    const due = rows()[0]?.querySelector('td.col-due');
    expect(due?.textContent).toBe('Overdue by 3h 12m');
  });

  it('renders upcoming text for positive minutes_to_breach', () => {
    renderPayload(targets, payload([inc({ risk: 'warning', minutes_to_breach: 194 })]));
    expect(rows()[0]?.querySelector('td.col-due')?.textContent).toBe('Due in 3h 14m');
  });

  it('renders "No due date" for the no_due_date bucket', () => {
    renderPayload(targets, payload([inc({ risk: 'no_due_date' })]));
    expect(rows()[0]?.querySelector('td.col-due')?.textContent).toBe('No due date');
  });
});

describe('sla-risk renderPayload -- name cell', () => {
  const longName =
    'Microsoft Teams client cannot authenticate for remote users in the EMEA region';

  it('carries the full name in a title attribute on the cell and the label', () => {
    renderPayload(targets, payload([inc({ name: longName, url: 'https://swsd.example.com/incidents/1' })]));

    const nameCell = rows()[0]?.querySelector<HTMLTableCellElement>('td.col-name');
    expect(nameCell?.getAttribute('title')).toBe(longName);

    const label = nameCell?.querySelector('.name');
    expect(label?.getAttribute('title')).toBe(longName);
    expect(label?.textContent).toBe(longName);
  });

  it('also sets the title when the row has no link', () => {
    renderPayload(targets, payload([inc({ name: longName })]));
    const nameCell = rows()[0]?.querySelector<HTMLTableCellElement>('td.col-name');
    expect(nameCell?.getAttribute('title')).toBe(longName);
    expect(nameCell?.querySelector('a')).toBeNull();
    expect(nameCell?.querySelector('.name')?.textContent).toBe(longName);
  });

  it('repeats the number as a muted prefix inside the Name cell for narrow hosts', () => {
    renderPayload(targets, payload([inc({ number: 4711 })]));
    expect(rows()[0]?.querySelector('td.col-name .row-number')?.textContent).toBe('#4711');
  });
});

describe('sla-risk renderPayload -- link safety', () => {
  it('links the name when url is an absolute http(s) URL', () => {
    renderPayload(
      targets,
      payload([inc({ name: 'Printer offline', url: 'https://swsd.example.com/incidents/1' })]),
    );

    const anchor = rows()[0]?.querySelector<HTMLAnchorElement>('td.col-name a');
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute('href')).toBe('https://swsd.example.com/incidents/1');
    expect(anchor?.getAttribute('target')).toBe('_blank');
    expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('does not link a javascript: URL, but still shows the name', () => {
    renderPayload(
      targets,
      payload([inc({ name: 'Printer offline', url: 'javascript:alert(1)' })]),
    );

    const nameCell = rows()[0]?.querySelector('td.col-name');
    expect(nameCell?.querySelector('a')).toBeNull();
    expect(nameCell?.textContent).toContain('Printer offline');
  });

  it('does not link a protocol-relative URL', () => {
    renderPayload(targets, payload([inc({ url: '//evil.example.com/incidents/1' })]));
    expect(rows()[0]?.querySelector('td.col-name a')).toBeNull();
  });
});

describe('sla-risk renderPayload -- empty state', () => {
  it('shows the empty message when there are no incidents', () => {
    renderPayload(targets, payload([], { breached: 0 }));

    expect(rows()).toHaveLength(0);
    expect(targets.empty?.hidden).toBe(false);
    expect(targets.empty?.textContent).toBe('No incidents match the current filters.');
  });

  it('hides the empty message once rows are rendered', () => {
    renderPayload(targets, payload([inc()]));
    expect(targets.empty?.hidden).toBe(true);
  });

  it('treats a malformed payload as empty instead of throwing', () => {
    renderPayload(targets, { incidents: undefined } as unknown as Payload);
    expect(rows()).toHaveLength(0);
    expect(targets.empty?.hidden).toBe(false);
  });
});

describe('sla-risk renderPayload -- title and chips', () => {
  it('shows the incident count in the title', () => {
    renderPayload(targets, payload([inc({ id: 1 }), inc({ id: 2 })]));
    expect(targets.title?.textContent).toBe('SLA Risk (2)');
  });

  it('renders one chip per non-zero risk count', () => {
    renderPayload(targets, payload([inc()], { breached: 2, ok: 1, warning: 0 }));

    const chips = Array.from(targets.chips.querySelectorAll('.chip'));
    expect(chips).toHaveLength(2);
    expect(chips.map((c) => c.textContent)).toEqual(['Breached: 2', 'OK: 1']);
    expect(chips[0]?.className).toBe('chip chip-breached');
    expect(chips[1]?.className).toBe('chip chip-ok');
  });

  it('renders no chips when every count is zero', () => {
    renderPayload(targets, payload([], { breached: 0, critical: 0 }));
    expect(targets.chips.querySelectorAll('.chip')).toHaveLength(0);
  });
});

describe('sla-risk exported renderers', () => {
  it('renderRows can be driven directly', () => {
    renderRows(targets.rows, [inc({ name: 'VPN down', risk: 'critical' })]);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.querySelector('.pill')?.textContent).toBe('Critical');
  });

  it('renderChips can be driven directly and clears previous chips', () => {
    renderChips(targets.chips, { breached: 3 });
    renderChips(targets.chips, { critical: 1 });

    const chips = Array.from(targets.chips.querySelectorAll('.chip'));
    expect(chips).toHaveLength(1);
    expect(chips[0]?.textContent).toBe('Critical: 1');
  });
});