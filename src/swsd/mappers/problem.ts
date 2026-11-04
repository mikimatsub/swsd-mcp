import type { ProblemSummary, ProblemDetail } from '../types.js';

/**
 * Wire shape for SWSD problems (from `/problems.json` and
 * `/problems/{id}.json`):
 *
 * ASSUMED to mirror the incident shape based on the v2.1-audit-findings.md
 * Section C gap #4 ("Problems are entirely unexposed") and the SWSD API
 * convention documented in `verified_swsd_api_quirks.md` that ITIL records
 * (incidents, problems, changes) share a common envelope:
 *
 *   {
 *     "id":           <number>,
 *     "number":       <number>,
 *     "name":         "<string>",
 *     "state":        "<string>",                 // "New" / "In Progress" / "Resolved" / etc.
 *     "priority":     "<string>",                 // optional, tenant-specific
 *     "description":  "<HTML>",                   // optional
 *     "description_no_html": "<plain text>",      // optional projection
 *     "category":     { "id", "name" } | null,
 *     "subcategory":  { "id", "name" } | null,    // nested under category
 *     "requester":    { "id", "name", "email" } | null,
 *     "assignee":     { "id", "name", "email" } | null,
 *     "created_at":   "<ISO 8601>",
 *     "updated_at":   "<ISO 8601>",
 *     "href_account_domain": "<UI URL>"
 *   }
 *
 * No live probe artifact exists at `.research/v2/swsd-probes/problem*.json`
 * yet (no live API calls were made for this implementation, per the
 * task's discipline rule). Each field is therefore read DEFENSIVELY:
 * `typeof` checks, missing fields → `undefined`, non-object nested values
 * tolerated. If the live shape differs (e.g. `category` is a string instead
 * of `{ name }`, or the `description_no_html` projection is absent), the
 * mapper still produces a valid `ProblemSummary` — only `id` is required.
 *
 * If a future probe reveals the actual shape diverges, narrow the
 * defensive reads here without changing the contract.
 */
export function toProblemSummary(raw: unknown): ProblemSummary | null {
  if (!isPlainObject(raw)) return null;
  const id = numberOrNull(raw.id);
  if (id === null) return null;

  return {
    id,
    number: numberOrUndefined(raw.number),
    name: stringOrEmpty(raw.name),
    state: stringOrUndefined(raw.state),
    priority: stringOrUndefined(raw.priority),
    category: nestedString(raw.category, 'name'),
    subcategory: nestedString(raw.subcategory, 'name'),
    description: stringOrUndefined(raw.description),
    description_no_html: stringOrUndefined(raw.description_no_html),
    requester: nestedPerson(raw.requester),
    assignee: nestedPerson(raw.assignee),
    created_at: stringOrUndefined(raw.created_at),
    updated_at: stringOrUndefined(raw.updated_at),
    url: stringOrUndefined(raw.href_account_domain),
  };
}

export function toProblemDetail(raw: unknown): ProblemDetail | null {
  if (!isPlainObject(raw)) return null;
  const id = numberOrNull(raw.id);
  if (id === null) return null;
  return { ...raw, id };
}

export interface ProblemWriteFields {
  name?: string;
  description?: string;
  priority?: string;
  category?: string;
  subcategory?: string;
  assignee_email?: string;
  requester_email?: string;
  state?: string;
  root_cause?: string;
  symptoms?: string;
  workaround?: string;
}

/**
 * Build the SWSD POST/PUT request body shape for problem create/update.
 * Mirrors `buildIncidentWritePayload` — only includes fields the caller
 * explicitly provided. Nested-lookup shapes (`category: { name }`,
 * `assignee: { email }`) follow the same convention SWSD uses for incidents.
 */
export function buildProblemWritePayload(
  fields: ProblemWriteFields,
): { problem: Record<string, unknown> } {
  const problem: Record<string, unknown> = {};
  if (fields.name !== undefined) problem.name = fields.name;
  if (fields.description !== undefined) problem.description = fields.description;
  if (fields.priority !== undefined) problem.priority = fields.priority;
  if (fields.category !== undefined) problem.category = { name: fields.category };
  if (fields.subcategory !== undefined) problem.subcategory = { name: fields.subcategory };
  if (fields.assignee_email !== undefined) problem.assignee = { email: fields.assignee_email };
  if (fields.requester_email !== undefined) problem.requester = { email: fields.requester_email };
  if (fields.state !== undefined) problem.state = fields.state;
  if (fields.root_cause !== undefined) problem.root_cause = fields.root_cause;
  if (fields.symptoms !== undefined) problem.symptoms = fields.symptoms;
  if (fields.workaround !== undefined) problem.workaround = fields.workaround;
  return { problem };
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

function nestedPerson(
  parent: unknown,
): { id?: number; name?: string; email?: string } | undefined {
  if (!isPlainObject(parent)) return undefined;
  const id = numberOrUndefined(parent.id);
  const name = stringOrUndefined(parent.name);
  const email = stringOrUndefined(parent.email);
  if (id === undefined && name === undefined && email === undefined) return undefined;
  return { id, name, email };
}
