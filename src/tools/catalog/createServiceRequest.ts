import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CreateServiceRequestInput } from '../../schemas/serviceRequest.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { decodeJwtPayload, getUserIdFromJwtClaims } from '../../swsd/jwt.js';
import { toUserMeRecord } from '../../swsd/mappers/me.js';
import { checkWriteMode } from '../shared/writeMode.js';
import type { ToolContext } from '../../config/toolRegistry.js';

const IncidentResponseOutput = z.object({
  id: z.number().int(),
  number: z.number().int().optional(),
  name: z.string().optional(),
  is_service_request: z.boolean().optional(),
  state: z.string().optional(),
  url: z
    .string()
    .optional()
    .describe(
      'SWSD UI URL for the created service-request incident (from href_account_domain).',
    ),
});

export function registerCreateServiceRequest(
  server: McpServer,
  ctx: ToolContext,
): void {
  server.registerTool(
    'swsd_create_service_request',
    {
      description:
        'Submit a SWSD catalog request, creating an incident with ' +
        '`is_service_request: true` (auto-set by SWSD on this endpoint) and ' +
        'the supplied form variable values. Use `swsd_list_catalog_items` to ' +
        'find the right `catalog_item_id` and `swsd_get_catalog_item` to inspect ' +
        'its variables before filling. Each `request_variables` entry needs ' +
        '`custom_field_id` (= the catalog item variable\'s `id`) and `value` ' +
        '(stringified to match the variable\'s `kind` — for dropdowns, one of ' +
        'the `options` choices). The created incident\'s id is returned for ' +
        'follow-up calls (swsd_get_incident, swsd_assign_incident, etc.). ' +
        'WRITE — does not retry on transient failure; the agent should verify ' +
        'with swsd_get_incident before retrying.' +
        ' To set tenant-specific custom field values, pass `custom_fields: ' +
        '[{name, value}]` — call swsd_describe_custom_fields first to discover ' +
        'field names and (for Dropdowns) allowed values. Validated for Text, ' +
        'Dropdown, Number, Checkbox, and Date types.',
      inputSchema: CreateServiceRequestInput.shape,
      outputSchema: z.object({ incident: IncidentResponseOutput }).shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
        idempotentHint: false,
      },
    },
    async (input) => {
      try {
        // Step 1: Resolve requester email — explicit input wins, otherwise
        // self-resolve from the JWT (mirrors swsd_list_my_incidents). SWSD
        // rejects numeric requester ids on the service-requests endpoint
        // ("Please provide a registered requester to get updates" → 422),
        // so we MUST pass requester: {email: ...}.
        let requesterEmail = input.requester_email;
        if (requesterEmail === undefined) {
          const claims = decodeJwtPayload(ctx.token);
          if (claims === null) {
            return toolError(
              'Could not decode SWSD JWT to identify the authenticated user.',
              'Provide an explicit requester_email or supply a valid SWSD token.',
            );
          }
          const userId = getUserIdFromJwtClaims(claims);
          if (userId === null) {
            return toolError(
              'JWT payload missing user_id (or legacy user_ic). Cannot determine requester.',
              'Provide an explicit requester_email or supply a token with a user_id/user_ic claim.',
            );
          }
          const usersResult = await ctx.client.get<unknown>(
            `/users/${String(userId)}.json`,
          );
          const me = toUserMeRecord(usersResult.body);
          if (me === null || me.email === undefined) {
            return toolError(
              `Could not resolve email for user id ${String(userId)}.`,
              'Provide an explicit requester_email.',
            );
          }
          requesterEmail = me.email;
        }

        // Step 2: Build the wire-shape body. SWSD's create-service-request
        // endpoint requires:
        //   * URL: /catalog_items/{id}/service_requests.json
        //   * Body wrapper: { incident: { ... } }
        //   * Variables field name: request_variables_attributes (Rails-style
        //     nested attributes assignment) — sending it as request_variables
        //     causes SWSD to silently drop the values.
        //   * is_service_request and category are auto-populated server-side.
        const incident: Record<string, unknown> = {
          requester: { email: requesterEmail },
          request_variables_attributes: input.request_variables,
        };
        if (input.description !== undefined) {
          incident.description = input.description;
        }
        if (input.custom_fields !== undefined && input.custom_fields.length > 0) {
          incident.custom_fields_values = {
            custom_fields_value: input.custom_fields.map((cf) => ({
              name: cf.name,
              value: cf.value,
            })),
          };
        }

        const path = `/catalog_items/${String(input.catalog_item_id)}/service_requests.json`;
        const payload = { incident };
        const gated = checkWriteMode(ctx, {
          method: 'POST',
          path,
          body: payload,
          action: `create service request from catalog item ${String(input.catalog_item_id)}`,
        });
        if (gated) return gated;
        const { body: response } = await ctx.client.post<unknown>(path, payload);

        // Step 3: Validate + map the response.
        if (typeof response !== 'object' || response === null) {
          return toolError(
            'SWSD returned an unexpected response shape on POST /catalog_items/{id}/service_requests.json',
            'The response body was not a JSON object.',
          );
        }
        const r = response as Record<string, unknown>;
        const id = typeof r.id === 'number' && Number.isFinite(r.id) ? r.id : null;
        if (id === null) {
          return toolError(
            'SWSD response missing numeric id on the created service request.',
            'The endpoint accepted the request but did not return a usable incident id.',
          );
        }

        const number =
          typeof r.number === 'number' && Number.isFinite(r.number)
            ? r.number
            : undefined;
        const numberPart = number !== undefined ? String(number) : String(id);
        const varCount = input.request_variables.length;
        const varWord = varCount === 1 ? 'request_variable' : 'request_variables';
        const summary =
          `Created service request #${numberPart} (id=${String(id)}, ` +
          `catalog_item_id=${String(input.catalog_item_id)}, ${String(varCount)} ${varWord}).`;

        return structuredResult(
          {
            incident: {
              id,
              number,
              name: typeof r.name === 'string' ? r.name : undefined,
              is_service_request:
                typeof r.is_service_request === 'boolean'
                  ? r.is_service_request
                  : undefined,
              state: typeof r.state === 'string' ? r.state : undefined,
              url:
                typeof r.href_account_domain === 'string'
                  ? r.href_account_domain
                  : undefined,
            },
          },
          summary,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
