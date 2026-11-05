import type { SwsdClient } from './client.js';
import type { PaginationMeta } from './pagination.js';
import { SwsdDecodeError } from './errors.js';

export function requireListArray(body: unknown): unknown[] {
  if (!Array.isArray(body)) throw new SwsdDecodeError();
  return body;
}

/**
 * Fetch a list endpoint, defensively project each item via the mapper, drop
 * unprojectable rows. Used by all swsd_list_* lookup tools.
 */
export async function fetchAndMap<T>(
  client: SwsdClient,
  path: string,
  mapper: (raw: unknown) => T | null,
  params: Record<string, unknown>,
): Promise<{ items: T[]; pagination: PaginationMeta }> {
  const { body, pagination } = await client.get<unknown>(path, params);
  const arr = requireListArray(body);
  const items = arr
    .map(mapper)
    .filter((x): x is NonNullable<typeof x> => x !== null);
  return { items, pagination };
}
