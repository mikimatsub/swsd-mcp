import { describe, expect, it } from 'vitest';
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import { registerDescribeCustomFields } from '../../../src/tools/customFields/describeCustomFields.js';
import { registerGetRecordAudits } from '../../../src/tools/audits/getRecordAudits.js';
import { registerListCatalogItems } from '../../../src/tools/catalog/listCatalogItems.js';
import { registerListProblems } from '../../../src/tools/problems/listProblems.js';
import { registerListTimeTracks } from '../../../src/tools/timeTracks/timeTrackTools.js';
import { registerListIncidentTasks } from '../../../src/tools/tasks/listIncidentTasks.js';
import { registerListRecordTasks } from '../../../src/tools/tasks/listRecordTasks.js';
import { registerListUsers } from '../../../src/tools/lookups/listUsers.js';
import { getRegisteredTool, makeCtx, makeFakeClient } from './_helpers/mockClient.js';

const CASES = [
  { name: 'swsd_describe_custom_fields', register: registerDescribeCustomFields, input: {} },
  { name: 'swsd_get_record_audits', register: registerGetRecordAudits, input: { object_type: 'incidents', id: 1234567 } },
  { name: 'swsd_list_catalog_items', register: registerListCatalogItems, input: {} },
  { name: 'swsd_list_problems', register: registerListProblems, input: {} },
  { name: 'swsd_list_time_tracks', register: registerListTimeTracks, input: { object_type: 'incidents', id: 1234567 } },
  { name: 'swsd_list_incident_tasks', register: registerListIncidentTasks, input: { incident_id: 1234567 } },
  { name: 'swsd_list_record_tasks', register: registerListRecordTasks, input: { record_type: 'changes', record_id: 1234567 } },
  { name: 'swsd_list_users', register: registerListUsers, input: {} },
];

describe('list response validation', () => {
  it.each(CASES)('$name rejects an unexpected response instead of reporting an empty list', async ({ name, register, input }) => {
    const client = makeFakeClient();
    client.setLookupBody({ unexpected: 'SYNTHETIC_TOKEN' });
    const server = new McpServer({ name: 'synthetic-list-validation', version: '0.0.0' });
    register(server, makeCtx(client));
    const tool = getRegisteredTool(server, name);
    const result = await tool.handler((tool.inputSchema as z.ZodType).parse(input), {}) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(JSON.stringify(result.content)).toMatch(/decode/i);
    expect(JSON.stringify(result.content)).not.toContain('SYNTHETIC_TOKEN');
    expect(client.calls).toHaveLength(1);
  });
});
