/**
 * id-vs-number disambiguation for SWSD entities.
 *
 * SWSD has two identifiers per entity:
 *   - `id`     — internal DB primary key, 9-digit (e.g., 180457930)
 *   - `number` — human-facing ticket/article number, 5-6-digit (e.g., 60310)
 *
 * Users almost always say "incident 60310" — meaning the `number`. But every
 * SWSD endpoint that takes an identifier in the URL segment (`/incidents/{id}`)
 * requires the 9-digit `id`. Without a resolver, the agent must do 2-4 list+
 * filter round-trips to find the id.
 *
 * This module provides resolvers that branch on digit count:
 *   - input has >= 7 digits  → treated as id; returned as-is, no I/O
 *   - input has <= 6 digits  → treated as number; resolved via /incidents.json
 *                              (or /solutions.json) lookup
 *
 * # SWSD lookup mechanism (verified 2026-05-07)
 *
 * Probed `?numbers[]=N`, `?number=N`, `?numbers=N`, `?display_id=N`,
 * `?ticket_number=N`, `?friendly_id=N`, `?id=N`, `?ids[]=N` — all silently
 * IGNORED on `/incidents.json` and `/solutions.json` (the API returns the
 * unfiltered default page). `GET /incidents/{number}.json` returns 404.
 *
 * The ONE shape that works is `?query=N` (free-text search). It returns rows
 * whose number matches AND rows whose name/description happens to contain N
 * as a substring. We absorb this with `per_page=25` and filter the response
 * client-side for `row.number === input`. Across 20 test cases (10 incidents
 * + 10 solutions), every probe returned exactly 1 row with number === input —
 * but in 8/20 cases extra substring-collision rows came back too, sometimes
 * ahead of the exact match. The client-side filter is therefore load-bearing,
 * not defensive.
 *
 * See `.research/v2.1-probes/numbers-filter-v2.json` and -v3.json for the
 * verifying probe data.
 */
import type { SwsdClient } from '../swsd/client.js';

/**
 * Digit-count threshold separating numbers from ids. Values with this many
 * digits or more are treated as ids (returned without I/O); values with fewer
 * digits are looked up via the SWSD `query` filter.
 *
 * SWSD numbers are 5-6 digits in modern tenants; ids are 9 digits. 7 is the
 * safe boundary — well above any plausible number, well below any id.
 */
export const ID_DIGIT_THRESHOLD = 7;

export const RECORD_REFERENCE_DESCRIPTION =
  `Accepts an internal id (>=${String(ID_DIGIT_THRESHOLD)} digits) or human-facing number (<=${String(ID_DIGIT_THRESHOLD - 1)} digits). `;

/**
 * Page size for the lookup request. The SWSD `query` filter is free-text and
 * may return rows whose description contains the number as a substring in
 * addition to the row whose `number` equals it. 25 (matches DEFAULT_PER_PAGE
 * in `src/swsd/client.ts`) absorbs ~24 substring collisions before we'd risk
 * paging past the exact match — comfortable headroom over the 8/20 collision
 * rate observed in the v3 probe.
 */
const RESOLVE_PAGE_SIZE = 25;

/**
 * Thrown when the resolver receives invalid input or cannot find a matching
 * row for a number lookup. Distinct from `SwsdHttpError`/`SwsdNetworkError`
 * (in `src/swsd/errors.ts`) so callers can differentiate user-input failures
 * from API failures. `mapSwsdError` recognizes this class and surfaces the
 * message verbatim (no "Unexpected error:" prefix), since the message is
 * already user-friendly.
 */
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

interface RowWithIdAndNumber {
  id: number;
  number: number;
}

function isRowWithIdAndNumber(row: unknown): row is RowWithIdAndNumber {
  if (!row || typeof row !== 'object') return false;
  const r = row as { id?: unknown; number?: unknown };
  return (
    typeof r.id === 'number' &&
    Number.isFinite(r.id) &&
    typeof r.number === 'number' &&
    Number.isFinite(r.number)
  );
}

/**
 * Validate that `input` is a positive integer suitable for either id-passthrough
 * or number-lookup. Throws `InputError` otherwise.
 */
function assertPositiveInteger(input: number, kind: 'incident' | 'solution' | 'problem'): void {
  if (typeof input !== 'number' || !Number.isFinite(input)) {
    throw new InputError(
      `${kind} id_or_number must be a finite positive integer; got ${String(input)}.`,
    );
  }
  if (!Number.isInteger(input)) {
    throw new InputError(
      `${kind} id_or_number must be an integer; got ${String(input)}.`,
    );
  }
  if (input <= 0) {
    throw new InputError(
      `${kind} id_or_number must be positive (>0); got ${String(input)}.`,
    );
  }
}

/**
 * Returns true when `input` should be treated as an id (>= ID_DIGIT_THRESHOLD
 * digits); false when it should be looked up as a human-facing number.
 *
 * Implemented via numeric comparison rather than `String(input).length` to
 * sidestep locale/formatting concerns (the input is already validated as a
 * positive integer at this point).
 */
function isIdSized(input: number): boolean {
  // 10^(threshold-1) is the smallest value with `threshold` digits.
  // e.g. threshold=7 → 1_000_000 is the smallest 7-digit value.
  const minIdValue = 10 ** (ID_DIGIT_THRESHOLD - 1);
  return input >= minIdValue;
}

async function lookupByNumber(
  client: SwsdClient,
  path: '/incidents.json' | '/solutions.json' | '/problems.json',
  input: number,
  kind: 'incident' | 'solution' | 'problem',
): Promise<{ id: number }> {
  const { body } = await client.get<unknown>(path, {
    query: input,
    per_page: RESOLVE_PAGE_SIZE,
  });
  if (!Array.isArray(body)) {
    throw new InputError(
      `Could not resolve ${kind} number ${String(input)}: SWSD returned an unexpected non-array response shape.`,
    );
  }
  const exact = body.filter(isRowWithIdAndNumber).filter((row) => row.number === input);
  if (exact.length === 0) {
    throw new InputError(
      `No ${kind} found with number ${String(input)} in this tenant. ` +
        `If you meant the internal id, pass the 9-digit value (e.g., 180457930). ` +
        `Otherwise, verify the number exists via swsd_list_${kind}s${
          kind === 'solution' ? ' or swsd_search_solutions' : ''
        }.`,
    );
  }
  // Multiple exact matches would only happen if SWSD ever returned a duplicate
  // row (it doesn't); pick the first deterministically.
  const first = exact[0]!;
  return { id: first.id };
}

/**
 * Resolve an incident reference to its `{ id }`. Accepts either the 9-digit
 * `id` (returned without I/O) or the 5-6-digit `number` (looked up via
 * `/incidents.json?query=N`).
 *
 * @throws InputError when input is not a positive integer or no incident
 *   matches the given number.
 * @throws SwsdHttpError / SwsdNetworkError when the underlying client call
 *   fails (forwarded from `client.get`).
 */
export async function resolveIncidentRef(
  input: number,
  client: SwsdClient,
): Promise<{ id: number }> {
  assertPositiveInteger(input, 'incident');
  if (isIdSized(input)) {
    return { id: input };
  }
  return lookupByNumber(client, '/incidents.json', input, 'incident');
}

/**
 * Resolve a solution reference to its `{ id }`. Accepts either the 7+-digit
 * `id` (returned without I/O) or a smaller `number` (looked up via
 * `/solutions.json?query=N`).
 *
 * @throws InputError when input is not a positive integer or no solution
 *   matches the given number.
 * @throws SwsdHttpError / SwsdNetworkError when the underlying client call
 *   fails (forwarded from `client.get`).
 */
export async function resolveSolutionRef(
  input: number,
  client: SwsdClient,
): Promise<{ id: number }> {
  assertPositiveInteger(input, 'solution');
  if (isIdSized(input)) {
    return { id: input };
  }
  return lookupByNumber(client, '/solutions.json', input, 'solution');
}

/**
 * Resolve a problem reference to its `{ id }`. Accepts either the 7+-digit
 * `id` (returned without I/O) or a smaller `number` (looked up via
 * `/problems.json?query=N`).
 *
 * Mirrors `resolveSolutionRef` exactly — the SWSD `/problems.json` endpoint
 * is assumed to share the same `?query=N` + client-side `row.number === input`
 * filter behavior documented for incidents and solutions (verified
 * 2026-05-07). The wire shape is presumed consistent based on the audit's
 * Section C gap #4 and `verified_swsd_api_quirks.md`; the client-side filter
 * tolerates substring-collision rows the way the other resolvers do.
 *
 * @throws InputError when input is not a positive integer or no problem
 *   matches the given number.
 * @throws SwsdHttpError / SwsdNetworkError when the underlying client call
 *   fails (forwarded from `client.get`).
 */
export async function resolveProblemRef(
  input: number,
  client: SwsdClient,
): Promise<{ id: number }> {
  assertPositiveInteger(input, 'problem');
  if (isIdSized(input)) {
    return { id: input };
  }
  return lookupByNumber(client, '/problems.json', input, 'problem');
}
