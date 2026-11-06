/**
 * Resolve a requester email to SWSD requester ids so incident lists can be
 * filtered by requester SERVER-SIDE.
 *
 * # SWSD filter mechanism (verified live 2026-11-05)
 *
 * `/incidents.json` silently ignores `requester_email`, `requester[]`,
 * `requester_id`, `requester_ids[]`, `requester_user[]`, `user[]` and
 * `q[requester_id_eq]` (each returns the unfiltered tenant total). The one
 * shape that works is `requested_by[]=<requester id>`:
 *   - exact: 69/69 rows for a real requester, 0 for a fake id
 *   - repeated keys are OR-ed (the totals of two requesters add up exactly)
 *   - combines with the other server-side filters (state, state_is_not, ...)
 *
 * The requester id is NOT the user id. An incident's `requester` object
 * carries both (`requester.id` and `requester.user_id`), and
 * `requested_by[]=<user id>` returns 0 rows. `/users.json?email=` therefore
 * can't be used; `/requesters.json?email=<email>` can. It returns
 * `{ id, user_id, name, description: <email>, ... }` rows. The email match
 * is exact and case-insensitive: a partial email returns no rows.
 *
 * (`created_by[]=<id>` also narrows server-side, but means "who logged the
 * ticket", not "who it is for", so it is not a substitute.)
 */
import type { SwsdClient } from '../swsd/client.js';

/**
 * Look up the requester ids for `email`.
 *
 * Returns `undefined` when the lookup fails or finds no requester whose email
 * matches exactly, so the caller can fall back to its client-side filter
 * (the pre-existing behavior). Errors are deliberately swallowed for the same
 * reason: a failed lookup must not make the list call fail.
 */
export async function resolveRequesterIds(
  client: SwsdClient,
  email: string,
): Promise<number[] | undefined> {
  try {
    const { body } = await client.get<unknown>('/requesters.json', { email });
    if (!Array.isArray(body)) return undefined;
    const wanted = email.trim().toLowerCase();
    const ids = new Set<number>();
    for (const row of body) {
      if (typeof row !== 'object' || row === null) continue;
      const { id, description } = row as { id?: unknown; description?: unknown };
      if (
        typeof id === 'number' &&
        Number.isInteger(id) &&
        id > 0 &&
        typeof description === 'string' &&
        description.trim().toLowerCase() === wanted
      ) {
        ids.add(id);
      }
    }
    return ids.size > 0 ? [...ids] : undefined;
  } catch {
    return undefined;
  }
}
