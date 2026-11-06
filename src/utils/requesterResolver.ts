import type { SwsdClient } from '../swsd/client.js';
import { requireListArray } from '../swsd/list-helper.js';
import { InputError } from './idResolver.js';

/** Requester IDs differ from user IDs. Never silently degrade to a page-local filter. */
export async function resolveRequesterIds(client: SwsdClient, email: string): Promise<number[]> {
  const wanted = email.trim().toLowerCase();
  const ids = new Set<number>();
  for (let page = 1; page <= 10; page++) {
    const { body, pagination } = await client.get<unknown>('/requesters.json', {
      email: wanted, page, per_page: 100,
    });
    for (const value of requireListArray(body)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new InputError('Invalid requester lookup response. Retry after checking SWSD availability.');
      }
      const row = value as Record<string, unknown>;
      const address = typeof row.email === 'string' ? row.email : row.description;
      if (typeof address !== 'string') {
        throw new InputError('SWSD returned a requester without an email. Check the requester directory before retrying.');
      }
      if (address.trim().toLowerCase() !== wanted) continue;
      if (typeof row.id !== 'number' || !Number.isSafeInteger(row.id) || row.id <= 0) {
        throw new InputError('SWSD returned an invalid requester ID. Check the requester record before retrying.');
      }
      ids.add(row.id);
    }
    if (!pagination.has_more) return [...ids];
    if (pagination.next_page !== undefined && pagination.next_page !== page + 1) break;
  }
  throw new InputError('Requester lookup exceeded its pagination limit. Narrow the requester email or check SWSD before retrying.');
}
