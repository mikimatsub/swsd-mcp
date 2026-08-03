import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { DescribeCustomFieldsInput } from '../../schemas/customField.js';
import { PaginationOutput } from '../../schemas/output.js';
import { structuredResult } from '../../mcp/output.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { toCustomFieldSummary } from '../../swsd/mappers/customField.js';
import { loadUiResource } from '../../mcp/uiResources.js';
import type { ToolContext } from '../../config/toolRegistry.js';

const UI_RESOURCE_URI = 'ui://swsd/custom-fields.html';

const CustomFieldSummaryOutput = z.object({
  id: z.number().int(),
  name: z.string(),
  type: z
    .string()
    .describe('Human-readable field type (e.g. "Text", "Date", "Dropdown", "Multi-picklist").'),
  required: z.boolean(),
  active: z.boolean(),
  scope: z
    .string()
    .optional()
    .describe('Scope name (e.g. "Global", "Service_Catalog", "Incident").'),
  module: z.string().optional().describe('Module the field is scoped to, when applicable.'),
  values: z
    .array(z.string())
    .optional()
    .describe('Allowed values for Dropdown / Multi-picklist field types.'),
  help_text: z.string().optional(),
  searchable: z.boolean(),
});

export function registerDescribeCustomFields(
  server: McpServer,
  ctx: ToolContext,
): void {
  registerAppTool(
    server,
    'swsd_describe_custom_fields',
    {
      description:
        "List the SWSD tenant's custom-field schema. Returns id, name, type " +
        '(e.g. "Text", "Dropdown", "Date"), required, scope, module, allowed ' +
        '`values` for dropdown fields, and help_text. Useful for understanding ' +
        'tenant configuration and documenting integrations. Default returns ' +
        'active fields only — pass `active_only: false` to see retired ones too. ' +
        'Filter by `scope` or `module` to narrow the surface (the tenant may ' +
        'have 100+ fields). v2 NOTE: custom field WRITES are now supported via the `custom_fields` ' +
        'parameter on swsd_create_incident, swsd_update_incident, ' +
        'swsd_create_solution, and swsd_update_solution. Pass ' +
        '`custom_fields: [{name, value}]` (name-keyed for portability). ' +
        'Validated field types: Text, Dropdown, Number, Checkbox, Date. ' +
        'Multi_picklist and User-type writes are not yet supported — set ' +
        'those via the SWSD UI.',
      inputSchema: DescribeCustomFieldsInput.shape,
      outputSchema: z.object({
        custom_fields: z.array(CustomFieldSummaryOutput),
        pagination: PaginationOutput,
      }).shape,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
      _meta: { ui: { resourceUri: UI_RESOURCE_URI } },
    },
    async (input) => {
      try {
        // Note: SWSD's /custom_fields.json silently ignores per_page and
        // returns the entire collection. We fetch once and apply filtering +
        // pagination client-side so the agent's per_page is honored.
        const { body } = await ctx.client.get<unknown>('/custom_fields.json', {
          per_page: 1,
        });
        const arr = Array.isArray(body) ? body : [];
        const allFields = arr
          .map(toCustomFieldSummary)
          .filter((f): f is NonNullable<typeof f> => f !== null);

        let filtered = allFields;
        if (input.active_only) filtered = filtered.filter((f) => f.active);
        if (input.scope) filtered = filtered.filter((f) => f.scope === input.scope);
        if (input.module) filtered = filtered.filter((f) => f.module === input.module);

        const total = filtered.length;
        const startIdx = (input.page - 1) * input.per_page;
        const pageItems = filtered.slice(startIdx, startIdx + input.per_page);
        const has_more = startIdx + input.per_page < total;

        const filterNotes: string[] = [];
        if (input.active_only) filterNotes.push('active');
        if (input.scope) filterNotes.push(`scope=${input.scope}`);
        if (input.module) filterNotes.push(`module=${input.module}`);
        const note = filterNotes.length > 0 ? ` filtered to ${filterNotes.join(', ')}` : '';

        return structuredResult(
          {
            custom_fields: pageItems,
            pagination: {
              page: input.page,
              per_page: input.per_page,
              total,
              has_more,
              next_page: has_more ? input.page + 1 : undefined,
            },
          },
          `Returned ${String(pageItems.length)} of ${String(total)} custom fields ` +
            `(page ${String(input.page)}${has_more ? ', more available' : ''}${note}).`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );

  registerAppResource(
    server,
    'swsd-custom-fields-ui',
    UI_RESOURCE_URI,
    { description: 'Custom fields explorer rendered by Apps-capable hosts.' },
    () => ({
      contents: [
        {
          uri: UI_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: loadUiResource('custom-fields'),
        },
      ],
    }),
  );
}
