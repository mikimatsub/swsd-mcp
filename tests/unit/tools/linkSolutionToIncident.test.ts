import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerLinkSolutionToIncident } from '../../../src/tools/incidents/linkSolutionToIncident.js';
import {
  makeFakeClient,
  makeCtx,
  getRegisteredTool,
  type FakeClient,
  type RegisteredToolInternals,
} from './_helpers/mockClient.js';

describe('swsd_link_solution_to_incident — id_or_number resolution for BOTH refs', () => {
  let server: McpServer;
  let client: FakeClient;
  let tool: RegisteredToolInternals;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    client = makeFakeClient();
    registerLinkSolutionToIncident(server, makeCtx(client));
    tool = getRegisteredTool(server, 'swsd_link_solution_to_incident');
  });

  it('resolves both incident_id and solution_id from numbers before linking', async () => {
    // The link-solution flow has FOUR client calls when both refs are numbers:
    //   1. GET /incidents.json?query=N    (incident resolver)
    //   2. GET /solutions.json?query=M    (solution resolver)
    //   3. GET /incidents/{id}.json       (read-before-link)
    //   4. PUT /incidents/{id}.json       (the link)
    client.setBodyForPath(
      (p) => p === '/incidents.json',
      [{ id: 180457930, number: 60310 }],
    );
    client.setBodyForPath(
      (p) => p === '/solutions.json',
      [{ id: 1849839, number: 397 }],
    );
    // Read-before-link response — incident exists, no existing linked solutions
    client.setBodyForPath(
      (p) => p === '/incidents/180457930.json',
      { id: 180457930, number: 60310, solutions: [] },
    );
    client.setPutResponse({
      id: 180457930,
      number: 60310,
      solutions: [{ id: 1849839, href: 'x' }],
    });

    await tool.handler({ incident_id: 60310, solution_id: 397 }, {});

    // Both lookups happen
    const incidentLookup = client.calls.find(
      (c) => c.type === 'get' && c.path === '/incidents.json',
    );
    const solutionLookup = client.calls.find(
      (c) => c.type === 'get' && c.path === '/solutions.json',
    );
    expect(incidentLookup).toBeDefined();
    expect(solutionLookup).toBeDefined();
    expect(
      incidentLookup?.type === 'get' ? incidentLookup.params : {},
    ).toMatchObject({ query: 60310 });
    expect(
      solutionLookup?.type === 'get' ? solutionLookup.params : {},
    ).toMatchObject({ query: 397 });

    // Read-before-link uses RESOLVED incident id
    const read = client.calls.find(
      (c) => c.type === 'get' && c.path === '/incidents/180457930.json',
    );
    expect(read).toBeDefined();

    // PUT uses RESOLVED incident id and includes the RESOLVED solution id
    const put = client.calls.find((c) => c.type === 'put');
    expect(put?.path).toBe('/incidents/180457930.json');
    if (!put || put.type !== 'put') throw new Error('put missing');
    const body = put.body as { incident: { solution_ids: number[] } };
    expect(body.incident.solution_ids).toContain(1849839);
  });
});
