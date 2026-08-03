import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { GetCatalogItemInput } from '../../schemas/catalogItem.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { toCatalogItemDetail } from '../../swsd/mappers/catalogItem.js';
import { loadUiResource } from '../../mcp/uiResources.js';
import type { ToolContext } from '../../config/toolRegistry.js';

const UI_RESOURCE_URI = 'ui://swsd/catalog-item-form.html';

const CatalogItemVariableOutput = z.object({
  id: z.number().int(),
  name: z.string(),
  kind: z.string().optional(),
  field_type: z.number().int().optional(),
  options: z.string().optional(),
  required: z.string().optional(),
  helptext: z.string().optional(),
});

export function registerGetCatalogItem(
  server: McpServer,
  ctx: ToolContext,
): void {
  registerAppTool(
    server,
    'swsd_get_catalog_item',
    {
      description:
        'Get a single SWSD catalog item by id, including its `variables` ' +
        '(the form schema for service requests). Use the variables to know ' +
        "which fields to populate when submitting a service request. Each " +
        "variable has an `id` (pass through to the create-service-request " +
        "tool as `custom_field_id`), a `name`, a `kind` (free_text / " +
        "drop_down_menu / multi_select / date / user / null), and `options` " +
        '(newline-separated allowed values for dropdowns). The full top-level ' +
        'item is passed through for power users (description, category, etc.).',
      inputSchema: GetCatalogItemInput.shape,
      outputSchema: z.object({
        item: z
          .record(z.string(), z.unknown())
          .and(
            z.object({
              id: z.number().int(),
              variables: z.array(CatalogItemVariableOutput).optional(),
            }),
          ),
      }).shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
        idempotentHint: true,
      },
      _meta: { ui: { resourceUri: UI_RESOURCE_URI } },
    },
    async (input) => {
      try {
        const path = `/catalog_items/${String(input.id)}.json`;
        const { body } = await ctx.client.get<unknown>(path, {});
        const item = toCatalogItemDetail(body);
        if (item === null) {
          return toolError(
            `Catalog item ${String(input.id)} returned an unexpected shape.`,
            'The response was not a JSON object with a numeric id field. Verify the catalog item exists with swsd_list_catalog_items.',
          );
        }
        const name =
          typeof item.name === 'string' && item.name.trim().length > 0
            ? `"${item.name.trim()}"`
            : `id=${String(item.id)}`;
        const varCount = Array.isArray(item.variables) ? item.variables.length : 0;
        const summary = `Catalog item ${name}: ${String(varCount)} variables.`;
        return structuredResult({ item }, summary);
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );

  registerAppResource(
    server,
    'swsd-catalog-item-form-ui',
    UI_RESOURCE_URI,
    { description: 'Catalog item form rendered by Apps-capable hosts.' },
    () => ({
      contents: [
        {
          uri: UI_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: loadUiResource('catalog-item-form'),
        },
      ],
    }),
  );
}
