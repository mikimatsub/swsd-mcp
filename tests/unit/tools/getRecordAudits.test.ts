import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerGetRecordAudits } from '../../../src/tools/audits/getRecordAudits.js';
import {
  makeFakeClient,
  makeCtx,
  getRegisteredTool,
  type FakeClient,
  type RegisteredToolInternals,
} from './_helpers/mockClient.js';

describe('swsd_get_record_audits — object-type-aware id_or_number resolution', () => {
  let server: McpServer;
  let client: FakeClient;
  let tool: RegisteredToolInternals;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    client = makeFakeClient();
    registerGetRecordAudits(server, makeCtx(client));
    tool = getRegisteredTool(server, 'swsd_get_record_audits');
  });

  it('object_type=incidents + 6-digit number → resolves via /incidents.json then fetches audits', async () => {
    client.setBodyForPath(
      (p) => p === '/incidents.json',
      [{ id: 180457930, number: 60310 }],
    );
    client.setBodyForPath(
      (p) => p === '/incidents/180457930/audits.json',
      [],
    );

    await tool.handler(
      { object_type: 'incidents', id: 60310, page: 1, per_page: 25 },
      {},
    );

    const lookup = client.calls.find((c) => c.path === '/incidents.json');
    expect(lookup).toBeDefined();
    expect(lookup?.type === 'get' ? lookup.params : {}).toMatchObject({ query: 60310 });

    const audits = client.calls.find(
      (c) => c.path === '/incidents/180457930/audits.json',
    );
    expect(audits).toBeDefined();
  });

  it('object_type=solutions + 4-digit number → resolves via /solutions.json then fetches audits', async () => {
    client.setBodyForPath(
      (p) => p === '/solutions.json',
      [{ id: 1849839, number: 397 }],
    );
    client.setBodyForPath(
      (p) => p === '/solutions/1849839/audits.json',
      [],
    );

    await tool.handler(
      { object_type: 'solutions', id: 397, page: 1, per_page: 25 },
      {},
    );

    const lookup = client.calls.find((c) => c.path === '/solutions.json');
    expect(lookup).toBeDefined();
    expect(lookup?.type === 'get' ? lookup.params : {}).toMatchObject({ query: 397 });

    const audits = client.calls.find(
      (c) => c.path === '/solutions/1849839/audits.json',
    );
    expect(audits).toBeDefined();
  });

  it('object_type=incidents + 9-digit id → no lookup, direct audits fetch', async () => {
    client.setBodyForPath(
      (p) => p === '/incidents/180457930/audits.json',
      [],
    );

    await tool.handler(
      { object_type: 'incidents', id: 180457930, page: 1, per_page: 25 },
      {},
    );

    // No /incidents.json lookup should happen for an id-sized input.
    const lookup = client.calls.find((c) => c.path === '/incidents.json');
    expect(lookup).toBeUndefined();

    // Single direct fetch.
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.path).toBe('/incidents/180457930/audits.json');
  });

  it('object_type=hardwares + 6-digit number → no resolver attempt (id-only path)', async () => {
    // Hardwares (and other non-incident/solution object_types) have no list
    // API exposed in v2.x with `?query=N` lookup, so the handler must NOT
    // attempt a number→id resolve. The input is passed through to the audits
    // path verbatim — even if the value happens to look like a number, the
    // server will 404 if it's not actually a hardware id.
    client.setBodyForPath(
      (p) => p === '/hardwares/123456/audits.json',
      [],
    );

    await tool.handler(
      { object_type: 'hardwares', id: 123456, page: 1, per_page: 25 },
      {},
    );

    // No /hardwares.json lookup should happen — the handler doesn't even try.
    const lookup = client.calls.find((c) => c.path === '/hardwares.json');
    expect(lookup).toBeUndefined();

    // Single direct fetch using the input id verbatim.
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.path).toBe('/hardwares/123456/audits.json');
  });
});
