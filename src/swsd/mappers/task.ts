import type { TaskSummary } from '../types.js';

/**
 * Wire shape for SWSD incident sub-tasks (from `/incidents/{id}/tasks.json`,
 * also surfaced inline as `tasks[]` in incident `?layout=long` responses):
 *
 *   {
 *     "id":          <number>,
 *     "name":        "<string>",
 *     "description": "<HTML>",            // optional, may be empty
 *     "state":       "New" | "In Progress" | "Completed",
 *     "position":    <number>,            // ordering within the parent incident
 *     "assignee":    { id, name, email } | null,
 *     "due_at":      "<ISO 8601>" | null,
 *     "created_at":  "<ISO>",
 *     "updated_at":  "<ISO>"
 *   }
 *
 * The probe `incident_181277860_long.json` has `tasks: []` (no live sub-tasks
 * on that ticket), so this mapper reads every field defensively. The shape
 * above is documented in `.research/v2.1-audit-findings.md` Section C "Gap:
 * Tasks (sub-tasks of incidents)".
 *
 * `state: "Completed"` (not "Done" or "Closed") is the verified terminal value
 * — see Step 6 in the v2.1 plan and SWSD's task-state list.
 */

export function toTask(raw: unknown): TaskSummary | null {
  if (!isPlainObject(raw)) return null;
  const id = numberOrNull(raw.id);
  if (id === null) return null;
  const state = stringOrEmpty(raw.state);
  return {
    id,
    name: stringOrEmpty(raw.name),
    description: stringOrUndefined(raw.description),
    description_no_html: stringOrUndefined(raw.description_no_html),
    state,
    completed: state === 'Completed',
    position: numberOrUndefined(raw.position),
    assignee: nestedAssignee(raw.assignee),
    due_at: stringOrUndefined(raw.due_at),
    created_at: stringOrUndefined(raw.created_at),
    updated_at: stringOrUndefined(raw.updated_at),
  };
}

export interface TaskWriteFields {
  name?: string;
  description?: string;
  due_at?: string;
  assignee_email?: string;
  state?: string;
  is_complete?: boolean;
}

/**
 * Build the SWSD POST/PUT request body for task create/update.
 * Mirrors `buildIncidentWritePayload` — only includes fields explicitly provided.
 *
 * For assignee, SWSD accepts the same `{ email }` lookup-shape used by
 * incidents (see `buildIncidentWritePayload` for the parallel pattern).
 */
export function buildTaskWritePayload(
  fields: TaskWriteFields,
): { task: Record<string, unknown> } {
  const task: Record<string, unknown> = {};
  if (fields.name !== undefined) task.name = fields.name;
  if (fields.description !== undefined) task.description = fields.description;
  if (fields.due_at !== undefined) task.due_at = fields.due_at;
  if (fields.assignee_email !== undefined) task.assignee = { email: fields.assignee_email };
  if (fields.state !== undefined) task.state = fields.state;
  if (fields.is_complete !== undefined) task.is_complete = fields.is_complete;
  return { task };
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

function nestedAssignee(
  parent: unknown,
): { id?: number; name?: string; email?: string } | undefined {
  if (!isPlainObject(parent)) return undefined;
  const id = numberOrUndefined(parent.id);
  const name = stringOrUndefined(parent.name);
  const email = stringOrUndefined(parent.email);
  if (id === undefined && name === undefined && email === undefined) return undefined;
  return { id, name, email };
}
