import { describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { GetSolutionInput, UpdateSolutionInput } from '../../../src/schemas/solution.js';
import { registerGetSolution } from '../../../src/tools/solutions/getSolution.js';
import { registerUpdateSolution } from '../../../src/tools/solutions/updateSolution.js';
import { registerDeleteSolution } from '../../../src/tools/solutions/deleteSolution.js';
import { getRegisteredTool, makeCtx, makeFakeClient } from './_helpers/mockClient.js';

describe('solution reference descriptions', () => {
  it.each([['get', GetSolutionInput], ['update', UpdateSolutionInput]] as const)(
    '%s schema documents six-digit numbers and seven-digit internal ids', (_name, schema) => {
      expect(schema.shape.id.description).toContain('human-facing number (<=6 digits)');
      expect(schema.shape.id.description).toContain('internal id (>=7 digits)');
    },
  );

  it('get and update describe the same reference boundary as delete', () => {
    const server = new McpServer({ name: 'synthetic', version: '0.0.0' });
    const ctx = makeCtx(makeFakeClient());
    registerGetSolution(server, ctx);
    registerUpdateSolution(server, ctx);
    registerDeleteSolution(server, ctx);
    for (const verb of ['get', 'update', 'delete']) {
      const description = getRegisteredTool(server, `swsd_${verb}_solution`).description;
      expect(description).toContain('internal id (>=7 digits) or human-facing number (<=6 digits)');
    }
  });
});
