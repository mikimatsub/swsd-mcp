export interface IncidentSummary {
  id: number;
  number?: number;
  name: string;
  state?: string;
  priority?: string;
  assignee_email?: string;
  requester_email?: string;
  category?: string;
  updated_at?: string;
  /** SWSD UI URL for this incident (from `href_account_domain`). */
  url?: string;
  /** ISO 8601 timestamp the incident is due. May be null/absent on list responses. */
  due_at?: string;
}

/**
 * One row in the `sla_violations[]` array on a long-layout incident.
 * Wire-shape source-of-truth: `.research/v2/swsd-probes/incident_181277860_long.json`.
 */
export interface IncidentSlaViolation {
  /** Human-readable name of the SLA policy that was breached, e.g. "Time to first response". */
  name?: string;
  /** SWSD's classification — typically "response" or "resolution". */
  violation_type?: string;
}

/**
 * Long-layout incident detail. Extends the compact summary with the high-value
 * fields surfaced by `?layout=long` — description (HTML body), due_at,
 * sla_violations, resolution, etc. The rest of the raw passthrough is still
 * available via the index signature for forward-compatibility (SWSD adds
 * fields without bumping API versions).
 */
export type IncidentDetail = Record<string, unknown> & {
  id: number;
  number?: number;
  name?: string;
  state?: string;
  priority?: string;
  /** Raw HTML body of the ticket as authored — sanitize before rendering. */
  description?: string;
  /** Plain-text projection of `description` SWSD returns alongside the HTML. */
  description_no_html?: string;
  /** ISO 8601 timestamp the incident is due. Compare against `Date.now()` for "Overdue". */
  due_at?: string;
  /** ISO 8601 timestamp the incident was created — useful for triage. */
  created_at?: string;
  updated_at?: string;
  /** SLA-policy violations attached to this incident; empty array when none. */
  sla_violations?: IncidentSlaViolation[];
  /** Raw HTML body of the resolution note (closure write-up) — sanitize before rendering. */
  resolution?: string;
  /** Resolution category, e.g. "Resolved by IT", "User error". */
  resolution_type?: string;
  /** SWSD UI URL for this incident (from `href_account_domain`). */
  url?: string;
};

export interface TaskSummary {
  id: number;
  name: string;
  /** Raw HTML description as stored by SWSD. May be empty. */
  description?: string;
  /** Plain-text projection when SWSD returns one alongside `description`. */
  description_no_html?: string;
  /** State name normalized to agree with boolean is_complete when supplied. */
  state: string;
  /** Boolean is_complete when supplied; otherwise state === "Completed". */
  completed: boolean;
  /** Position / ordering within the incident's task list. */
  position?: number;
  assignee?: { id?: number; name?: string; email?: string };
  due_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface CommentSummary {
  id: number;
  body: string;
  is_private: boolean;
  author_email?: string;
  author_name?: string;
  created_at?: string;
}

export interface CategorySummary {
  id: number;
  name: string;
  parent_id?: number;
  children?: { id: number; name: string }[];
  default_assignee_id?: number;
}

export interface UserSummary {
  id: number;
  name: string;
  email?: string;
  disabled: boolean;
  available_for_assignment?: boolean;
  role?: string;
  site?: string;
  department?: string;
  title?: string;
}

export interface GroupSummary {
  id: number;
  name: string;
  description?: string;
  disabled: boolean;
  member_count?: number;
}

export interface SiteSummary {
  id: number;
  name: string;
  location?: string;
  description?: string;
  time_zone?: string;
}

export interface DepartmentSummary {
  id: number;
  name: string;
  description?: string;
}

export interface RoleSummary {
  id: number;
  name: string;
  description?: string;
}

export interface SolutionSummary {
  id: number;
  number?: number;
  name: string;
  state?: string;
  category?: string;
  excerpt?: string;
  requester_email?: string;
  updated_at?: string;
  /** Relative API path to the solution (e.g. `/solutions/1234.json`). */
  href?: string;
}

export type SolutionDetail = Record<string, unknown> & {
  id: number;
  name?: string;
};

export interface ProblemSummary {
  id: number;
  number?: number;
  name: string;
  state?: string;
  priority?: string;
  category?: string;
  subcategory?: string;
  description?: string;
  description_no_html?: string;
  requester?: { id?: number; name?: string; email?: string };
  assignee?: { id?: number; name?: string; email?: string };
  created_at?: string;
  updated_at?: string;
  /** SWSD UI URL for this problem (from `href_account_domain`). */
  url?: string;
}

export type ProblemDetail = Record<string, unknown> & {
  id: number;
  name?: string;
};

export interface CustomFieldSummary {
  id: number;
  name: string;
  /** Human-readable field type (e.g. "Text", "Date", "Dropdown", "Multi-picklist"). */
  type: string;
  required: boolean;
  active: boolean;
  /** Scope name (e.g. "Global", "Service_Catalog", "Incident"). */
  scope?: string;
  /** Module the field is scoped to, when applicable. */
  module?: string;
  /** Allowed values for Dropdown / Multi-picklist field types. */
  values?: string[];
  help_text?: string;
  searchable: boolean;
}

export interface AuditSummary {
  /**
   * Stable identifier for the audit entry. SWSD assigns a UUID string per
   * audit row (no numeric id is exposed by /{object}/{id}/audits.json).
   */
  uuid: string;
  /** Human-readable change description, e.g. "State changed from New to On Hold". */
  message: string;
  /** Action taken — typically "Update", "Create", or "Delete". */
  action?: string;
  created_at?: string;
  /** The user who performed the action (display name; user_id is separate). */
  user?: string;
  user_id?: number;
  /** Free-text note attached to the audit, often empty. */
  note?: string;
  /** Optional: source-record reference fields (helpful for global /audits queries). */
  source_type?: string;
  source_id?: number;
}

export interface UserMeRecord {
  id: number;
  email?: string;
  name?: string;
  title?: string;
  /** Role name (e.g. "Administrator", "Requester"). */
  role?: string;
  /** Department name. */
  department?: string;
  /** Site name. */
  site?: string;
  /** Group IDs the user belongs to. Empty array if none. */
  group_ids: number[];
  /** Whether the user account is disabled. */
  disabled?: boolean;
  /** Whether the user is currently configured to receive incident assignments. */
  available_for_assignment?: boolean;
  /** ISO timestamp of the user's last login (only present from /profile.json). */
  last_login?: string;
}

export interface CatalogItemVariable {
  /** Per-variable row id from SWSD. Pass through to swsd_create_service_request as `custom_field_id`. */
  id: number;
  /** Display name for the variable (e.g. "New Employee First Name"). */
  name: string;
  /** Catalog-item label for the field type (free_text / drop_down_menu / multi_select / date / user / null for section headers). */
  kind?: string;
  /** Numeric SAManage field type code (1, 2, 4, 5, 7, 8). Pass through alongside `kind`. */
  field_type?: number;
  /** Comma-/newline-separated allowed values for dropdown / multi_select kinds. */
  options?: string;
  /** "1" if required, "0" otherwise — preserved as string per SWSD's wire shape. */
  required?: string;
  /** Helper text shown to requesters in the SWSD portal — may contain HTML. */
  helptext?: string;
}

export interface CatalogItemSummary {
  id: number;
  name: string;
  state?: string;
  category?: string;
  subcategory?: string;
  department?: string;
  site?: string;
  /** Number of times this item has been requested across the tenant (read from `request_count`). */
  request_count?: number;
  /** ISO timestamp of last update. */
  updated_at?: string;
  /** Number of variables on this item (compact summary; full details via swsd_get_catalog_item). */
  variable_count?: number;
}

export type CatalogItemDetail = Record<string, unknown> & {
  id: number;
  name?: string;
  variables?: CatalogItemVariable[];
};
