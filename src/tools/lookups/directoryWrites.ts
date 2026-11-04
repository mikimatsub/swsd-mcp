import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { ToolContext } from '../../config/toolRegistry.js';
import {
  AddGroupMemberInput,
  CreateCategoryInput,
  CreateDepartmentInput,
  CreateGroupInput,
  CreateRoleInput,
  CreateSiteInput,
  CreateUserInput,
  RemoveGroupMemberInput,
  UpdateCategoryInput,
  UpdateDepartmentInput,
  UpdateGroupInput,
  UpdateRoleInput,
  UpdateSiteInput,
  UpdateUserInput,
} from '../../schemas/lookup.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { mapSwsdError } from '../../swsd/errors.js';
import {
  toCategorySummary,
  toDepartmentSummary,
  toGroupSummary,
  toRoleSummary,
  toSiteSummary,
  toUserSummary,
} from '../../swsd/mappers/lookup.js';
import { registerSafeDelete } from '../shared/safeDelete.js';
import { checkWriteMode } from '../shared/writeMode.js';

interface DirectoryConfig {
  kind: string;
  collectionPath: string;
  createInput: z.ZodType<Record<string, unknown>>;
  updateInput: z.ZodType<{ id: number } & Record<string, unknown>>;
  map: (raw: unknown) => { id: number; name: string } | null;
}

const DIRECTORY = {
  user: { kind: 'user', collectionPath: '/users', createInput: CreateUserInput, updateInput: UpdateUserInput, map: toUserSummary },
  group: { kind: 'group', collectionPath: '/groups', createInput: CreateGroupInput, updateInput: UpdateGroupInput, map: toGroupSummary },
  site: { kind: 'site', collectionPath: '/sites', createInput: CreateSiteInput, updateInput: UpdateSiteInput, map: toSiteSummary },
  department: { kind: 'department', collectionPath: '/departments', createInput: CreateDepartmentInput, updateInput: UpdateDepartmentInput, map: toDepartmentSummary },
  category: { kind: 'category', collectionPath: '/categories', createInput: CreateCategoryInput, updateInput: UpdateCategoryInput, map: toCategorySummary },
  role: { kind: 'role', collectionPath: '/roles', createInput: CreateRoleInput, updateInput: UpdateRoleInput, map: toRoleSummary },
} satisfies Record<string, DirectoryConfig>;

function unwrap(body: unknown, key: string): unknown {
  return body && typeof body === 'object' && key in body
    ? (body as Record<string, unknown>)[key]
    : body;
}

function writeFields(kind: string, input: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'id' || value === undefined) continue;
    if (kind === 'user' && ['role_name', 'site_name', 'department_name'].includes(key)) {
      fields[key.replace('_name', '')] = { name: value };
    } else if (kind === 'user' && key === 'reports_to_email') {
      fields.reports_to = { email: value };
    } else {
      fields[key] = value;
    }
  }
  return fields;
}

function registerDirectoryWrite(
  server: McpServer,
  ctx: ToolContext,
  cfg: DirectoryConfig,
  update: boolean,
): void {
  const action = update ? 'update' : 'create';
  server.registerTool(
    `swsd_${action}_${cfg.kind}`,
    {
      description:
        (update
          ? `Update a SWSD ${cfg.kind} by internal id. Only provided fields are sent. `
          : `Create a SWSD ${cfg.kind}. Required: name${cfg.kind === 'user' ? ' and email' : ''}. `) +
        'WRITE — honors SWSD_WRITE_MODE and does not retry on transient failure.',
      inputSchema: update ? cfg.updateInput : cfg.createInput,
      annotations: { readOnlyHint: false, destructiveHint: update, openWorldHint: true, idempotentHint: false },
    },
    async (input) => {
      try {
        const fields = writeFields(cfg.kind, input);
        const changed = Object.keys(fields);
        if (update && changed.length === 0) {
          return toolError('No fields to update — provide at least one field besides id.');
        }
        // SWSD groups must be real groups, rather than user-backed groups.
        const payload = { [cfg.kind]: cfg.kind === 'group' ? { ...fields, is_user: false } : fields };
        const path = update
          ? `${cfg.collectionPath}/${String(input.id)}.json`
          : `${cfg.collectionPath}.json`;
        const gated = checkWriteMode(ctx, {
          method: update ? 'PUT' : 'POST',
          path,
          body: payload,
          action: `${action} ${cfg.kind}${update ? ` ${String(input.id)}` : ''}`,
        });
        if (gated) return gated;
        const { body } = update
          ? await ctx.client.put<unknown>(path, payload)
          : await ctx.client.post<unknown>(path, payload);
        const record = cfg.map(unwrap(body, cfg.kind));
        if (!record) {
          return toolError(`Could not parse ${update ? 'updated' : 'created'}-${cfg.kind} response from SWSD.`);
        }
        return structuredResult(
          { [cfg.kind]: record, ...(update ? { changed_fields: changed } : {}) },
          update
            ? `Updated ${cfg.kind} ${String(record.id)} (${changed.join(', ')}).`
            : `Created ${cfg.kind} ${String(record.id)}: ${record.name}`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}

function registerDirectoryDelete(server: McpServer, ctx: ToolContext, cfg: DirectoryConfig): void {
  registerSafeDelete(server, ctx, {
    kind: cfg.kind,
    toolName: `swsd_delete_${cfg.kind}`,
    collectionPath: cfg.collectionPath,
    envelopeKey: cfg.kind,
  });
}

export const registerCreateUser = (server: McpServer, ctx: ToolContext): void =>
  registerDirectoryWrite(server, ctx, DIRECTORY.user, false);
export const registerUpdateUser = (server: McpServer, ctx: ToolContext): void =>
  registerDirectoryWrite(server, ctx, DIRECTORY.user, true);
export const registerDeleteUser = (server: McpServer, ctx: ToolContext): void =>
  registerDirectoryDelete(server, ctx, DIRECTORY.user);
export const registerCreateGroup = (server: McpServer, ctx: ToolContext): void =>
  registerDirectoryWrite(server, ctx, DIRECTORY.group, false);
export const registerUpdateGroup = (server: McpServer, ctx: ToolContext): void =>
  registerDirectoryWrite(server, ctx, DIRECTORY.group, true);
export const registerDeleteGroup = (server: McpServer, ctx: ToolContext): void =>
  registerDirectoryDelete(server, ctx, DIRECTORY.group);
export const registerCreateSite = (server: McpServer, ctx: ToolContext): void =>
  registerDirectoryWrite(server, ctx, DIRECTORY.site, false);
export const registerUpdateSite = (server: McpServer, ctx: ToolContext): void =>
  registerDirectoryWrite(server, ctx, DIRECTORY.site, true);
export const registerDeleteSite = (server: McpServer, ctx: ToolContext): void =>
  registerDirectoryDelete(server, ctx, DIRECTORY.site);
export const registerCreateDepartment = (server: McpServer, ctx: ToolContext): void =>
  registerDirectoryWrite(server, ctx, DIRECTORY.department, false);
export const registerUpdateDepartment = (server: McpServer, ctx: ToolContext): void =>
  registerDirectoryWrite(server, ctx, DIRECTORY.department, true);
export const registerDeleteDepartment = (server: McpServer, ctx: ToolContext): void =>
  registerDirectoryDelete(server, ctx, DIRECTORY.department);
export const registerCreateCategory = (server: McpServer, ctx: ToolContext): void =>
  registerDirectoryWrite(server, ctx, DIRECTORY.category, false);
export const registerUpdateCategory = (server: McpServer, ctx: ToolContext): void =>
  registerDirectoryWrite(server, ctx, DIRECTORY.category, true);
export const registerDeleteCategory = (server: McpServer, ctx: ToolContext): void =>
  registerDirectoryDelete(server, ctx, DIRECTORY.category);
export const registerCreateRole = (server: McpServer, ctx: ToolContext): void =>
  registerDirectoryWrite(server, ctx, DIRECTORY.role, false);
export const registerUpdateRole = (server: McpServer, ctx: ToolContext): void =>
  registerDirectoryWrite(server, ctx, DIRECTORY.role, true);
export const registerDeleteRole = (server: McpServer, ctx: ToolContext): void =>
  registerDirectoryDelete(server, ctx, DIRECTORY.role);

const MembershipIdentity = z.object({
  id: z.union([z.number(), z.string().regex(/^[1-9]\d*$/).transform(Number)])
    .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER)),
});

function membershipId(body: unknown): number | null {
  const raw = unwrap(unwrap(body, 'memberships'), 'membership');
  // user_ids is plural in the API even when adding just one member.
  const single = Array.isArray(raw) && raw.length === 1 ? unwrap(raw[0], 'membership') : raw;
  const parsed = MembershipIdentity.safeParse(single);
  return parsed.success ? parsed.data.id : null;
}

export function registerAddGroupMember(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_add_group_member',
    {
      description:
        'Add one user to an SWSD group. Requires internal group_id and user_id. Returns membership_id for removal. ' +
        'WRITE — honors SWSD_WRITE_MODE and does not retry on transient failure.',
      inputSchema: AddGroupMemberInput,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
    },
    async (input) => {
      try {
        const path = '/memberships.json';
        const query = { group_id: input.group_id, user_ids: input.user_id };
        const gated = checkWriteMode(ctx, {
          method: 'POST',
          path: `${path}?group_id=${String(input.group_id)}&user_ids=${String(input.user_id)}`,
          action: `add user ${String(input.user_id)} to group ${String(input.group_id)}`,
        });
        if (gated) return gated;
        // The membership API takes query parameters and no request body.
        const { body } = await ctx.client.rawRequest(path, { method: 'POST', query });
        const id = membershipId(body);
        if (id === null) {
          return toolError('Could not parse created-membership id from SWSD. Verify group membership before retrying.');
        }
        return structuredResult(
          { membership_id: id, group_id: input.group_id, user_id: input.user_id },
          `Added user ${String(input.user_id)} to group ${String(input.group_id)} (membership ${String(id)}).`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}

export function registerRemoveGroupMember(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_remove_group_member',
    {
      description:
        'DESTRUCTIVE — remove an SWSD group membership by membership_id, not user id. ' +
        'First call without confirmation to preview the supplied membership id; the API has no documented membership GET. ' +
        'Ask the user to confirm, then re-call with confirm:true and confirm_id equal to that membership id. ' +
        'Dry-run mode always previews; disabled mode blocks. Does not retry DELETE requests.',
      inputSchema: RemoveGroupMemberInput,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: true },
    },
    async (input) => {
      try {
        const id = input.membership_id;
        const request = { method: 'DELETE' as const, path: `/memberships/${String(id)}.json` };
        const gated = checkWriteMode(ctx, { ...request, action: `remove membership ${String(id)}` });
        if (gated?.isError) return gated;
        const record = { membership_id: id };
        if (gated || input.confirm !== true || input.confirm_id !== id) {
          const hint = `Ask the user to confirm removal of this membership, then re-call with confirm:true and confirm_id:${String(id)}.`;
          return structuredResult(
            {
              ...(gated ? { dry_run: true } : { confirmation_required: true }),
              would_delete: record,
              request,
              hint,
            },
            `${gated ? 'Dry run' : 'Confirmation required'}: would remove membership ${String(id)}. No DELETE request was sent. ${hint}`,
          );
        }
        await ctx.client.delete(request.path);
        return structuredResult({ deleted: true, record, request }, `Removed membership ${String(id)}.`);
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
