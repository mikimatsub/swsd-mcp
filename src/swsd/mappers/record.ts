export interface GenericRecordSummary {
  id: number;
  number?: number;
  name: string;
  state?: string;
  status?: string;
  priority?: string;
  category?: string;
  subcategory?: string;
  site?: string;
  department?: string;
  requester?: { id?: number; name?: string; email?: string };
  assignee?: { id?: number; name?: string; email?: string };
  owner?: { id?: number; name?: string; email?: string };
  user?: { id?: number; name?: string; email?: string };
  asset_tag?: string;
  serial_number?: string;
  manufacturer?: string;
  model?: string;
  ip_address?: string;
  created_at?: string;
  updated_at?: string;
  url?: string;
}

export type GenericRecordDetail = Record<string, unknown> & {
  id: number;
  name?: string;
};

export interface LifecycleWriteFields {
  name?: string;
  description?: string;
  state?: string;
  priority?: string;
  requester_email?: string;
  assignee_email?: string;
  group_assignee_id?: number;
  site_id?: number;
  department_id?: number;
  planned_start_at?: string;
  planned_end_at?: string;
  configuration_item_ids?: number[];
  tag_list?: string[];
  custom_fields?: { name: string; value: unknown }[];
  change_type?: string;
  change_plan?: string;
  rollback_plan?: string;
  test_plan?: string;
  incident_ids?: number[];
  problem_ids?: number[];
  release_ids?: number[];
  plan?: string;
  build?: string;
  deploy?: string;
  itsm_change_ids?: number[];
}

export function toGenericRecordSummary(raw: unknown): GenericRecordSummary | null {
  if (!isPlainObject(raw)) return null;
  const id = numberOrNull(raw.id);
  if (id === null) return null;

  return {
    id,
    number: numberOrUndefined(raw.number),
    name: stringOrEmpty(raw.name),
    state: stringOrUndefined(raw.state),
    status: stringOrUndefined(raw.status),
    priority: stringOrUndefined(raw.priority),
    category: nestedString(raw.category, 'name') ?? stringOrUndefined(raw.category),
    subcategory: nestedString(raw.subcategory, 'name') ?? stringOrUndefined(raw.subcategory),
    site: nestedString(raw.site, 'name') ?? stringOrUndefined(raw.site),
    department: nestedString(raw.department, 'name') ?? stringOrUndefined(raw.department),
    requester: nestedPerson(raw.requester),
    assignee: nestedPerson(raw.assignee),
    owner: nestedPerson(raw.owner),
    user: nestedPerson(raw.user),
    asset_tag: stringOrUndefined(raw.asset_tag),
    serial_number: stringOrUndefined(raw.serial_number),
    manufacturer: stringOrUndefined(raw.manufacturer),
    model: stringOrUndefined(raw.model),
    ip_address: stringOrUndefined(raw.ip_address) ?? stringOrUndefined(raw.ip),
    created_at: stringOrUndefined(raw.created_at),
    updated_at: stringOrUndefined(raw.updated_at),
    url: stringOrUndefined(raw.href_account_domain),
  };
}

export function toGenericRecordDetail(raw: unknown): GenericRecordDetail | null {
  if (!isPlainObject(raw)) return null;
  const id = numberOrNull(raw.id);
  if (id === null) return null;
  return { ...raw, id };
}

export function buildLifecycleWritePayload(
  root: string,
  fields: LifecycleWriteFields,
): Record<string, Record<string, unknown>> {
  const record: Record<string, unknown> = {};
  copy(record, fields, 'name');
  copy(record, fields, 'description');
  copy(record, fields, 'state');
  copy(record, fields, 'priority');
  copy(record, fields, 'planned_start_at');
  copy(record, fields, 'planned_end_at');
  copy(record, fields, 'change_type');
  copy(record, fields, 'change_plan');
  copy(record, fields, 'rollback_plan');
  copy(record, fields, 'test_plan');
  copy(record, fields, 'plan');
  copy(record, fields, 'build');
  copy(record, fields, 'deploy');
  copy(record, fields, 'configuration_item_ids');
  copy(record, fields, 'incident_ids');
  copy(record, fields, 'problem_ids');
  copy(record, fields, 'release_ids');
  copy(record, fields, 'itsm_change_ids');
  copy(record, fields, 'tag_list');
  if (fields.requester_email !== undefined) record.requester = { email: fields.requester_email };
  if (fields.assignee_email !== undefined) record.assignee = { email: fields.assignee_email };
  if (fields.group_assignee_id !== undefined) record.group_assignee = { id: fields.group_assignee_id };
  if (fields.site_id !== undefined) record.site_id = fields.site_id;
  if (fields.department_id !== undefined) record.department_id = fields.department_id;
  if (fields.custom_fields !== undefined && fields.custom_fields.length > 0) {
    record.custom_fields_values = {
      custom_fields_value: fields.custom_fields.map((cf) => ({
        name: cf.name,
        value: cf.value,
      })),
    };
  }
  return { [root]: record };
}

function copy(
  target: Record<string, unknown>,
  source: LifecycleWriteFields,
  key: keyof LifecycleWriteFields,
): void {
  if (source[key] !== undefined) target[key] = source[key];
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
  return stringOrUndefined(parent[key]);
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
