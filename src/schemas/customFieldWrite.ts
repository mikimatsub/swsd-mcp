import { z } from 'zod';
import { MAX_CUSTOM_FIELDS, MAX_LABEL_CHARS, MAX_LONG_TEXT_CHARS } from './limits.js';

/**
 * Reusable Zod schema for the `custom_fields` write parameter.
 *
 * Standardizes on `name` keying (case-sensitive). Live testing on May 6,
 * 2026 confirmed:
 *   - Incidents accept name-only, custom_field_id-only, or both.
 *   - Solutions accept ONLY name (custom_field_id alone returns 400).
 *   - Therefore `name` is the cross-entity portable key.
 *
 * The mapper layer (buildIncidentWritePayload / buildSolutionWritePayload)
 * wraps these into the SAManage-required nested shape:
 *   { custom_fields_values: { custom_fields_value: [{name, value}, ...] } }
 *
 * Field-type coverage validated: Text, Dropdown, Number, Checkbox, Date.
 * NOT yet validated: Multi_picklist, User-type, Date_and_Time (no Global-scope
 * examples in test tenant). Field-type coverage to be expanded if/when those
 * are tested live.
 */
export const CustomFieldWrite = z.object({
  name: z
    .string()
    .min(1)
    .max(MAX_LABEL_CHARS)
    .describe(
      'Custom field name (case-sensitive, matches the field as displayed in the SWSD UI). ' +
        'Use swsd_describe_custom_fields first to discover the available field names ' +
        'and their types/allowed values.',
    ),
  value: z
    .union([z.string().max(MAX_LONG_TEXT_CHARS), z.number().finite(), z.boolean()])
    .describe(
      'Value to set. For Date use ISO 8601 ("YYYY-MM-DD"); SWSD echoes back as ' +
        '"Mon DD, YYYY" on read. For Dropdown use one of the values from the ' +
        'field schema. For Checkbox use "Yes" or "No". For Number pass a number.',
    ),
});

export const CustomFieldsArray = z
  .array(CustomFieldWrite)
  .max(MAX_CUSTOM_FIELDS)
  .optional()
  .describe(
    'Set tenant-specific custom field values on the record. ' +
      'Multi_picklist and User-type fields are not yet supported by this tool ' +
      '(set those via the SWSD UI). Validated for Text, Dropdown, Number, ' +
      'Checkbox, and Date types.',
  );

export type CustomFieldWrite = z.infer<typeof CustomFieldWrite>;
