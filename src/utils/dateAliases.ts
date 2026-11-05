/**
 * Relative-date alias parsing for filter inputs.
 *
 * Agents call list tools with phrasings like "incidents updated this week".
 * Without an alias, the agent must compute an ISO date - extra reasoning
 * steps and a frequent source of off-by-one errors. The alias lets agents
 * pass relative tokens like `"7d"`, `"24h"`, or `"1w"`, and the handler
 * translates them to a concrete `updated_from` date before sending.
 *
 * Per audit Section A finding #11.
 */

const ALIAS_RE = /^(\d+)(d|h|w)$/;

/**
 * Parse hours into a full ISO timestamp. Days/weeks retain date-only UTC
 * boundaries: subtract N days/weeks, then use that UTC calendar date.
 *
 * Accepted forms (case-sensitive, optional surrounding whitespace):
 *   - `Nh` - N hours ago (N must be 1..365)
 *   - `Nd` - UTC calendar date N days ago (N must be 1..365)
 *   - `Nw` - UTC calendar date N*7 days ago (N must be 1..365)
 *
 * Returns `null` for any input that doesn't match (caller should treat the
 * original value as a literal date or pass it through unchanged).
 */
export function parseDateAlias(input: string): string | null {
  const m = ALIAS_RE.exec(input.trim());
  if (!m) return null;
  const value = parseInt(m[1] ?? '', 10);
  const unit = m[2];
  if (!Number.isFinite(value) || value <= 0 || value > 365) return null;

  const now = new Date();
  const msPerHour = 3600 * 1000;
  const msPerDay = 24 * msPerHour;
  const ms = unit === 'h' ? msPerHour : unit === 'd' ? msPerDay : 7 * msPerDay;
  const target = new Date(now.getTime() - value * ms);
  return unit === 'h' ? target.toISOString() : target.toISOString().slice(0, 10);
}

/**
 * Translate `updated_within` into `updated_from` on the given input object.
 *
 * Behaviour:
 *   - No `updated_within` set: returns input untouched (same reference).
 *   - `updated_within` is unparseable: returns input untouched.
 *   - `updated_within` parses, AND `updated_from` is already set: explicit
 *     value wins - input is returned untouched (the alias is ignored).
 *   - `updated_within` parses, no explicit `updated_from`: returns a NEW
 *     object with `updated_within` removed and `updated_from` set to the
 *     parsed ISO date.
 *
 * The generic constraint enforces that `T` carries the optional fields we
 * read/write - schemas that include `updated_within: z.string().optional()`
 * and `updated_from: z.string().optional()` satisfy this constraint.
 */
export function applyDateAlias<
  T extends { updated_within?: string; updated_from?: string },
>(input: T): T {
  if (!input.updated_within) return input;
  const parsed = parseDateAlias(input.updated_within);
  if (!parsed) return input;
  if (input.updated_from) return input; // explicit value wins
  const { updated_within: _omit, ...rest } = input;
  void _omit;
  return { ...rest, updated_from: parsed } as T;
}
