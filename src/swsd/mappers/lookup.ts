import type {
  CategorySummary,
  UserSummary,
  GroupSummary,
  SiteSummary,
  DepartmentSummary,
  RoleSummary,
} from '../types.js';

export function toCategorySummary(raw: unknown): CategorySummary | null {
  if (!isPlainObject(raw)) return null;
  const id = numberOrNull(raw.id);
  if (id === null) return null;
  return {
    id,
    name: stringOrEmpty(raw.name),
    parent_id: numberOrUndefined(raw.parent_id),
    children: Array.isArray(raw.children)
      ? raw.children
          .map((c) => (isPlainObject(c) ? { id: numberOrNull(c.id), name: stringOrEmpty(c.name) } : null))
          .filter((c): c is { id: number; name: string } => c !== null && c.id !== null)
          .map((c) => ({ id: c.id, name: c.name }))
      : undefined,
    default_assignee_id: numberOrUndefined(raw.default_assignee_id),
  };
}

export function toUserSummary(raw: unknown): UserSummary | null {
  if (!isPlainObject(raw)) return null;
  const id = numberOrNull(raw.id);
  if (id === null) return null;
  return {
    id,
    name: stringOrEmpty(raw.name),
    email: stringOrUndefined(raw.email),
    disabled: typeof raw.disabled === 'boolean' ? raw.disabled : false,
    available_for_assignment:
      typeof raw.available_for_assignment === 'boolean' ? raw.available_for_assignment : undefined,
    role: nestedString(raw.role, 'name'),
    site: nestedString(raw.site, 'name') ?? stringOrUndefined(raw.site),
    department: nestedString(raw.department, 'name') ?? stringOrUndefined(raw.department),
    title: stringOrUndefined(raw.title),
  };
}

export function toGroupSummary(raw: unknown): GroupSummary | null {
  if (!isPlainObject(raw)) return null;
  const id = numberOrNull(raw.id);
  if (id === null) return null;
  return {
    id,
    name: stringOrEmpty(raw.name),
    description: stringOrUndefined(raw.description),
    disabled: typeof raw.disabled === 'boolean' ? raw.disabled : false,
    member_count: Array.isArray(raw.memberships) ? raw.memberships.length : undefined,
  };
}

export function toSiteSummary(raw: unknown): SiteSummary | null {
  if (!isPlainObject(raw)) return null;
  const id = numberOrNull(raw.id);
  if (id === null) return null;
  return {
    id,
    name: stringOrEmpty(raw.name),
    location: stringOrUndefined(raw.location),
    description: stringOrUndefined(raw.description),
    time_zone: stringOrUndefined(raw.time_zone),
  };
}

export function toDepartmentSummary(raw: unknown): DepartmentSummary | null {
  if (!isPlainObject(raw)) return null;
  const id = numberOrNull(raw.id);
  if (id === null) return null;
  return {
    id,
    name: stringOrEmpty(raw.name),
    description: stringOrUndefined(raw.description),
  };
}

export function toRoleSummary(raw: unknown): RoleSummary | null {
  if (!isPlainObject(raw)) return null;
  const id = numberOrNull(raw.id);
  if (id === null) return null;
  return {
    id,
    name: stringOrEmpty(raw.name),
    description: stringOrUndefined(raw.description),
  };
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

export interface GroupMember {
  id: number;
  name: string;
  email?: string;
}

/**
 * Members of a group from `GET /groups/{id}.json`. Per the SWSD API spec
 * (apidoc.samanage.com, Group → getGroupById) each `memberships[]` entry is
 * a user-like object: `{ id, name, email, is_user, group_id, avatar }`.
 * Non-user entries (`is_user: false`) and entries without an id are skipped.
 */
export function toGroupMembers(raw: unknown): GroupMember[] {
  if (!isPlainObject(raw) || !Array.isArray(raw.memberships)) return [];
  const out: GroupMember[] = [];
  for (const m of raw.memberships) {
    if (!isPlainObject(m) || m.is_user === false) continue;
    const id = numberOrNull(m.id);
    if (id === null) continue;
    out.push({ id, name: stringOrEmpty(m.name), email: stringOrUndefined(m.email) });
  }
  return out;
}

/** Group ids a user belongs to (`group_ids` on `GET /users/{id}.json`). */
export function toUserGroupIds(raw: unknown): number[] | undefined {
  if (!isPlainObject(raw) || !Array.isArray(raw.group_ids)) return undefined;
  return raw.group_ids
    .map((g) => numberOrNull(g))
    .filter((g): g is number => g !== null);
}
