import { describe, expect, it, vi } from 'vitest';
import { resolveRequesterIds } from '../../../src/utils/requesterResolver.js';
import { queryIncidents } from '../../../src/utils/incidentQuery.js';
import { makeFakeClient } from '../tools/_helpers/mockClient.js';

const page = (body: unknown, n = 1, more = false, total?: number) => ({ body, headers: new Headers(), pagination: { page: n, per_page: 100, has_more: more, total } });
describe('requester lookup and filtering', () => {
  it('pages, exact-matches case-insensitively and deduplicates requester IDs, never user IDs', async () => {
    const client = makeFakeClient();
    const get = vi.spyOn(client, 'get').mockResolvedValueOnce(page([
      { id: 10, user_id: 999, description: ' Alice@Example.com ' },
      { id: 11, description: 'notalice@example.com' },
    ], 1, true)).mockResolvedValueOnce(page([{ id: 10, description: 'alice@example.com' }, { id: 12, email: 'alice@example.com' }], 2));
    expect(await resolveRequesterIds(client, 'Alice@example.com')).toEqual([10, 12]);
    expect(get).toHaveBeenNthCalledWith(2, '/requesters.json', { email: 'alice@example.com', page: 2, per_page: 100 });
  });
  it('returns an exact zero without fetching tenant incidents for an unknown requester', async () => {
    const client = makeFakeClient();
    const result = await queryIncidents(client, { requester_email: 'nobody@example.com', page: 4, per_page: 2 });
    expect(result.pagination).toMatchObject({ page: 4, total: 0, matched_total: 0, total_scope: 'filtered', has_more: false });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.path).toBe('/requesters.json');
  });
  it.each([new Error('lookup unavailable'), { bad: 'shape' }, [{}], [null], [{ id: 1.5, description: 'alice@example.com' }]])('does not fall back on lookup failure or malformed data: %j', async value => {
    const client = makeFakeClient();
    const get = vi.spyOn(client, 'get');
    if (value instanceof Error) get.mockRejectedValue(value); else get.mockResolvedValue(page(value));
    await expect(queryIncidents(client, { requester_email: 'alice@example.com', page: 1, per_page: 2 })).rejects.toThrow();
    expect(get).toHaveBeenCalledTimes(1);
  });
  it('fails instead of accepting a truncated requester directory', async () => {
    const client = makeFakeClient();
    const get = vi.spyOn(client, 'get').mockResolvedValue(page([], 1, true));
    await expect(resolveRequesterIds(client, 'a@example.com')).rejects.toThrow('pagination limit');
    expect(get).toHaveBeenCalledTimes(10);
  });
  it('preserves requested page, combined filters and filtered totals', async () => {
    const client = makeFakeClient();
    const get = vi.spyOn(client, 'get').mockResolvedValueOnce(page([{ id: 88, description: 'a@example.com' }]))
      .mockResolvedValueOnce(page([{ id: 123, name: 'A', requester: { email: 'A@example.com' } }], 2, true, 6));
    const result = await queryIncidents(client, { requester_email: 'a@example.com', page: 2, per_page: 2, states: ['New'], state_is_not: ['Closed'] });
    expect(get).toHaveBeenLastCalledWith('/incidents.json', { page: 2, per_page: 2, requested_by: [88], state: ['New'], state_is_not: ['Closed'] });
    expect(result.pagination).toMatchObject({ page: 2, total: 6, matched_total: 6, total_scope: 'filtered' });
    expect(result.scan.client_filter_applied).toBe(false);
  });
  it('fails closed if upstream ignores requested_by instead of reporting misleading totals', async () => {
    const client = makeFakeClient();
    vi.spyOn(client, 'get').mockResolvedValueOnce(page([{ id: 88, description: 'a@example.com' }]))
      .mockResolvedValueOnce(page([{ id: 123, name: 'Wrong', requester: { email: 'b@example.com' } }]));
    await expect(queryIncidents(client, { requester_email: 'a@example.com', page: 1, per_page: 2 })).rejects.toThrow('did not honor');
  });
});
