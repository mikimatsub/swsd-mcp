import type { z } from 'zod';
import type { ListIncidentsInput } from '../schemas/incident.js';
import type { SwsdClient } from '../swsd/client.js';
import { requireListArray } from '../swsd/list-helper.js';
import { withTotalScope } from '../swsd/pagination.js';
import { toIncidentSummary } from '../swsd/mappers/incident.js';
import { applyDateAlias, passesUpdatedCutoff, planUpdatedFrom } from './dateAliases.js';
import { resolveRequesterIds } from './requesterResolver.js';
import { InputError } from './idResolver.js';

export async function queryIncidents(client: SwsdClient, raw: z.infer<typeof ListIncidentsInput>) {
  const input = applyDateAlias(raw);
  const requesterIds = input.requester_email === undefined ? undefined
    : await resolveRequesterIds(client, input.requester_email);
  const params: Record<string, unknown> = { page: input.page, per_page: input.per_page };
  const applied_filters: Record<string, unknown> = {};
  for (const [key, upstream] of [
    ['states', 'state'], ['priorities', 'priority'], ['categories', 'category'],
    ['sites', 'site'], ['departments', 'department'], ['assigned_to_group', 'assigned_to'],
    ['state_is_not', 'state_is_not'], ['updated_to', 'updated_to'],
    ['created_from', 'created_from'], ['created_to', 'created_to'], ['query', 'query'],
  ] as const) {
    const value = input[key];
    if (value !== undefined && (!Array.isArray(value) || value.length > 0)) {
      params[upstream] = value;
      applied_filters[key] = value;
    }
  }
  const updated = planUpdatedFrom(input.updated_from);
  if (updated.upstream) params.updated_at = ['greater_than', updated.upstream];
  if (input.updated_from) applied_filters.updated_from = input.updated_from;
  if (input.sort_by) params.sort_by = input.sort_by;
  if (input.sort_order) params.sort_order = input.sort_order;
  if (input.assignee_email) applied_filters.assignee_email = input.assignee_email;
  if (input.requester_email) applied_filters.requester_email = input.requester_email;
  if (requesterIds) {
    params.requested_by = requesterIds;
    applied_filters.requester_ids = requesterIds;
  }
  // An exact lookup with no matches is an empty result, never an unfiltered tenant scan.
  const response = requesterIds?.length === 0
    ? { body: [], pagination: { page: input.page, per_page: input.per_page, total: 0, has_more: false } }
    : await client.get<unknown>('/incidents.json', params);
  const rows = requireListArray(response.body);
  const candidates = rows.map(toIncidentSummary)
    .filter((row): row is NonNullable<typeof row> => row !== null);
  if (requesterIds && (candidates.length !== rows.length || candidates.some(row => row.requester_email?.trim().toLowerCase() !== input.requester_email?.trim().toLowerCase()))) {
    throw new InputError('SWSD did not honor the requester filter. No results were returned; check the requester record or retry later.');
  }
  const clientFilterApplied = input.assignee_email !== undefined || updated.cutoffMs !== undefined;
  const incidents = candidates.filter(row => passesUpdatedCutoff(row.updated_at, updated.cutoffMs)
    && (input.assignee_email === undefined || row.assignee_email?.toLowerCase() === input.assignee_email.toLowerCase()));
  return {
    incidents,
    pagination: withTotalScope(response.pagination, clientFilterApplied && requesterIds?.length !== 0,
      Object.keys(applied_filters).length > 0, incidents.length),
    applied_filters,
    scan: {
      candidates_scanned: candidates.length, matches_in_page: incidents.length,
      unscanned_candidates_remain: response.pagination.has_more,
      client_filter_applied: clientFilterApplied && requesterIds?.length !== 0,
    },
  };
}
