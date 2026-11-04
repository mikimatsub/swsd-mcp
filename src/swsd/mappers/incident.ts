import type {
  IncidentSummary,
  IncidentDetail,
  IncidentSlaViolation,
} from '../types.js';
import type { CustomFieldWrite } from '../../schemas/customFieldWrite.js';

/**
 * Project a raw SWSD incident into a compact summary.
 * Keep this list short — list responses can return 25+ items, and every
 * extra field multiplies the token cost in the agent's context window.
 */
export function toIncidentSummary(raw: unknown): IncidentSummary | null {
  if (!isPlainObject(raw)) return null;
  const id = numberOrNull(raw.id);
  if (id === null) return null;

  return {
    id,
    number: numberOrUndefined(raw.number),
    name: stringOrEmpty(raw.name),
    state: stringOrUndefined(raw.state),
    priority: stringOrUndefined(raw.priority),
    assignee_email: nestedString(raw.assignee, 'email'),
    requester_email: nestedString(raw.requester, 'email'),
    category: nestedString(raw.category, 'name'),
    updated_at: stringOrUndefined(raw.updated_at),
    url: stringOrUndefined(raw.href_account_domain),
    due_at: stringOrUndefined(raw.due_at),
  };
}

/**
 * Project a raw long-layout SWSD incident into the typed `IncidentDetail`
 * shape. Spread-passthrough keeps every field (forward-compatibility — SWSD
 * adds fields without bumping API versions), then we explicitly normalize a
 * few high-value fields the UI relies on so consumers don't need to repeat
 * the type-checks.
 *
 * Wire-shape reference: `.research/v2/swsd-probes/incident_181277860_long.json`.
 * - `description` / `resolution` arrive as either a string (HTML body) or
 *   `null` when empty — we collapse `null` to `undefined` so callers can use
 *   `if (description)` checks without an explicit null guard.
 * - `sla_violations` arrives as an array of `{name, violation_type}` rows;
 *   non-array shapes (defensive) collapse to undefined.
 * - All other fields are untouched.
 */
export function toIncidentDetail(raw: unknown): IncidentDetail | null {
  if (!isPlainObject(raw)) return null;
  const id = numberOrNull(raw.id);
  if (id === null) return null;

  const detail: IncidentDetail = { ...raw, id };

  // Normalize string fields that SWSD returns as `null` rather than missing.
  // Read defensively — `undefined` lets `if (detail.description)` work as a
  // simple truthiness test in the widget.
  detail.description = stringOrUndefined(raw.description);
  detail.description_no_html = stringOrUndefined(raw.description_no_html);
  detail.due_at = stringOrUndefined(raw.due_at);
  detail.created_at = stringOrUndefined(raw.created_at);
  detail.resolution = stringOrUndefined(raw.resolution);
  detail.resolution_type = stringOrUndefined(raw.resolution_type);

  // sla_violations[] is an array on the wire; map to the typed row shape.
  // Reads are defensive — non-array values collapse to undefined.
  if (Array.isArray(raw.sla_violations)) {
    detail.sla_violations = raw.sla_violations
      .filter((row): row is Record<string, unknown> => isPlainObject(row))
      .map(
        (row): IncidentSlaViolation => ({
          name: stringOrUndefined(row.name),
          violation_type: stringOrUndefined(row.violation_type),
        }),
      );
  }

  return detail;
}

export interface IncidentWriteFields {
  name?: string;
  description?: string;
  priority?: string;
  state?: string;
  assignee_email?: string;
  requester_email?: string;
  category_name?: string;
  site_name?: string;
  department_name?: string;
  /**
   * Linked solution IDs for the link tool. SWSD's WRITE shape is
   * `solution_ids: [123, 456]` (array of numbers); the READ shape returns
   * `solutions: [{id, href}]`. The builder translates this field to the
   * correct write key.
   */
  solution_ids?: number[];
  /**
   * Tenant-specific custom field values. Each row is `{name, value}`.
   * The mapper wraps these into SAManage's nested-wrapper shape:
   *   custom_fields_values: { custom_fields_value: [{name, value}, ...] }
   * which is the Rails-XML-fossilized-into-JSON pattern Samanage requires.
   *
   * Standardize on name keying (works for both incidents and solutions; the
   * custom_field_id alternative is incidents-only).
   */
  custom_fields?: CustomFieldWrite[];
}

/**
 * Build the SWSD POST/PUT request body shape for incident create/update.
 * Only includes fields the caller explicitly provided.
 */
export function buildIncidentWritePayload(
  fields: IncidentWriteFields,
): { incident: Record<string, unknown> } {
  const incident: Record<string, unknown> = {};
  if (fields.name !== undefined) incident.name = fields.name;
  if (fields.description !== undefined) incident.description = fields.description;
  if (fields.priority !== undefined) incident.priority = fields.priority;
  if (fields.state !== undefined) incident.state = fields.state;
  if (fields.assignee_email !== undefined) incident.assignee = { email: fields.assignee_email };
  if (fields.requester_email !== undefined) incident.requester = { email: fields.requester_email };
  if (fields.category_name !== undefined) incident.category = { name: fields.category_name };
  if (fields.site_name !== undefined) incident.site = { name: fields.site_name };
  if (fields.department_name !== undefined) incident.department = { name: fields.department_name };
  if (fields.solution_ids !== undefined) incident.solution_ids = fields.solution_ids;
  if (fields.custom_fields !== undefined && fields.custom_fields.length > 0) {
    incident.custom_fields_values = {
      custom_fields_value: fields.custom_fields.map((cf) => ({
        name: cf.name,
        value: cf.value,
      })),
    };
  }
  return { incident };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function numberOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function numberOrUndefined(v: unknown): number | undefined {
  const n = numberOrNull(v);
  return n === null ? undefined : n;
}

function stringOrEmpty(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function stringOrUndefined(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function nestedString(parent: unknown, key: string): string | undefined {
  if (!isPlainObject(parent)) return undefined;
  const v = parent[key];
  return typeof v === 'string' ? v : undefined;
}
