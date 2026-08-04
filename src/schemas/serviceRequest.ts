import { z } from 'zod';
import { CustomFieldsArray } from './customFieldWrite.js';
import { EmailInput, MAX_LONG_TEXT_CHARS, MAX_REQUEST_VARIABLES } from './limits.js';

/**
 * Input shape for `swsd_create_service_request`.
 *
 * The wire shape SWSD accepts is `POST /catalog_items/{id}/service_requests.json`
 * with body `{ incident: { name, requester: {email}, request_variables_attributes: [...] } }`.
 * The tool handler translates this user-friendly input into that wire shape:
 *
 *   - `request_variables` (read-shape name from swsd_get_catalog_item.variables)
 *     gets renamed to `request_variables_attributes` on the wire (Rails-style
 *     nested-attributes assignment — sending it as `request_variables` causes
 *     SWSD to silently drop the values).
 *   - Each variable's `custom_field_id` is the catalog item variable's `id`
 *     from `swsd_get_catalog_item.variables[*].id`.
 *   - `requester_email` defaults to the JWT user's email (looked up via
 *     `GET /users/{user_id}.json` — SWSD requires email-keyed requesters
 *     on this endpoint and rejects numeric `requester_id`).
 *
 * `is_service_request: true` is set automatically by SWSD on this endpoint;
 * we don't send it in the body. Categories are auto-populated from the
 * catalog item.
 *
 * Live wire-shape verification recorded at:
 *   .research/v2/swsd-probes/created_service_request.json
 *   docs/superpowers/plans/2026-05-07-v2-service-catalog.md (Task 3 Step 1)
 */

export const RequestVariableInput = z.object({
  custom_field_id: z
    .number()
    .int()
    .positive()
    .describe(
      'The catalog item variable id. Get it from `swsd_get_catalog_item` -> `item.variables[*].id`.',
    ),
  value: z
    .string()
    .max(MAX_LONG_TEXT_CHARS)
    .describe(
      'Stringified value to set on this variable. For dropdowns, use one of the variable\'s `options` choices verbatim. For dates, use the catalog item\'s expected format (often "YYYY-MM-DD" or "M/D/YYYY @ HHam/pm").',
    ),
});

export const CreateServiceRequestInput = z.object({
  catalog_item_id: z
    .number()
    .int()
    .positive()
    .describe(
      'Catalog item id from `swsd_list_catalog_items` or `swsd_get_catalog_item`. The endpoint URL embeds this; SWSD auto-populates the resulting incident\'s name, category, and subcategory from the catalog item.',
    ),
  request_variables: z
    .array(RequestVariableInput)
    .max(MAX_REQUEST_VARIABLES)
    .default([])
    .describe(
      'Form variable values, one entry per catalog variable being filled. Use `swsd_get_catalog_item` first to discover the available variables and required ones (`required: "1"`).',
    ),
  requester_email: EmailInput
    .optional()
    .describe(
      'Email of the user the request is for. Defaults to the authenticated user (resolved from the JWT). SWSD rejects numeric requester ids on this endpoint, so pass an email if you need to file the request on behalf of someone else.',
    ),
  description: z
    .string()
    .max(MAX_LONG_TEXT_CHARS)
    .optional()
    .describe(
      'Optional free-text description added to the resulting incident. The catalog item\'s default description from the SWSD UI is replaced if you pass this.',
    ),
  custom_fields: CustomFieldsArray,
});

export type CreateServiceRequestInput = z.infer<typeof CreateServiceRequestInput>;
