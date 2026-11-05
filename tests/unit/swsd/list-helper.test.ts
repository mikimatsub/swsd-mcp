import { describe, expect, it, vi } from 'vitest';
import { fetchAndMap } from '../../../src/swsd/list-helper.js';
import { makeFakeClient } from '../tools/_helpers/mockClient.js';

describe('fetchAndMap response validation', () => {
  it.each([null, {}, { items: [] }, 'SYNTHETIC_TOKEN', 1234567])('rejects the unexpected list shape %j before mapping', async (body) => {
    const client = makeFakeClient();
    client.setLookupBody(body);
    const mapper = vi.fn((value: unknown) => value);

    await expect(fetchAndMap(client, '/users.json', mapper, {})).rejects.toMatchObject({ name: 'SwsdDecodeError' });
    expect(mapper).not.toHaveBeenCalled();
  });

  it('accepts a genuinely empty array', async () => {
    const client = makeFakeClient();
    client.setLookupBody([]);
    await expect(fetchAndMap(client, '/users.json', (value) => value, {})).resolves.toMatchObject({ items: [] });
  });
});
