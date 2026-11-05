import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { GetLookupByIdInput } from '../../schemas/lookup.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { mapSwsdError } from '../../swsd/errors.js';
import {
  toCategorySummary,
  toDepartmentSummary,
  toGroupMembers,
  toGroupSummary,
  toRoleSummary,
  toSiteSummary,
  toUserGroupIds,
  toUserSummary,
} from '../../swsd/mappers/lookup.js';
import type { ToolContext } from '../../config/toolRegistry.js';

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
  idempotentHint: true,
} as const;

const UserOutput = z.object({
  id: z.number().int(),
  name: z.string(),
  email: z.string().optional(),
  disabled: z.boolean(),
  available_for_assignment: z.boolean().optional(),
  role: z.string().optional(),
  site: z.string().optional(),
  department: z.string().optional(),
  title: z.string().optional(),
  group_ids: z.array(z.number().int()).optional(),
});

const GroupMemberOutput = z.object({
  membership_id: z.number().int().describe('Membership ID, used to remove this group membership.'),
  id: z.number().int().optional().describe('User ID, only when explicitly supplied by SWSD.'),
  name: z.string(),
  email: z.string().optional(),
});

const GroupOutput = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string().optional(),
  disabled: z.boolean(),
  member_count: z.number().int().optional(),
  members: z.array(GroupMemberOutput),
});

const SiteOutput = z.object({
  id: z.number().int(),
  name: z.string(),
  location: z.string().optional(),
  description: z.string().optional(),
  time_zone: z.string().optional(),
});

const DepartmentOutput = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string().optional(),
});

const RoleOutput = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string().optional(),
});

const CategoryOutput = z.object({
  id: z.number().int(),
  name: z.string(),
  parent_id: z.number().int().optional(),
  children: z.array(z.object({ id: z.number().int(), name: z.string() })).optional(),
  default_assignee_id: z.number().int().optional(),
});

interface LookupSpec<T extends Record<string, unknown>> {
  tool: string;
  label: string;
  collection: string;
  key: string;
  description: string;
  output: z.ZodType;
  map: (raw: unknown) => T | null;
}

function registerGetLookup<T extends Record<string, unknown>>(
  server: McpServer,
  ctx: ToolContext,
  spec: LookupSpec<T>,
): void {
  server.registerTool(
    spec.tool,
    {
      description: spec.description,
      inputSchema: GetLookupByIdInput,
      outputSchema: z.object({ [spec.key]: spec.output }),
      annotations: READ_ANNOTATIONS,
    },
    async (input) => {
      try {
        const { body } = await ctx.client.get<unknown>(
          `/${spec.collection}/${String(input.id)}.json`,
        );
        const record = spec.map(body);
        if (!record) {
          return toolError(
            `Could not parse ${spec.label} ${String(input.id)} response from SWSD.`,
            `Verify the id with swsd_list_${spec.collection}.`,
          );
        }
        const name = typeof record.name === 'string' && record.name ? `: ${record.name}` : '';
        return structuredResult(
          { [spec.key]: record },
          `${spec.label[0]?.toUpperCase() ?? ''}${spec.label.slice(1)} ${String(input.id)}${name}`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}

export function registerGetUser(server: McpServer, ctx: ToolContext): void {
  registerGetLookup(server, ctx, {
    tool: 'swsd_get_user',
    label: 'user',
    collection: 'users',
    key: 'user',
    description:
      'Fetch one SWSD user by id. Returns name, email, role, site, department, title, ' +
      'disabled/assignable flags, and group_ids (teams the user belongs to). Use ' +
      'swsd_list_users first to find the id by name or email.',
    output: UserOutput,
    map: (raw) => {
      const user = toUserSummary(raw);
      if (!user) return null;
      const group_ids = toUserGroupIds(raw);
      return group_ids ? { ...user, group_ids } : { ...user };
    },
  });
}

export function registerGetGroup(server: McpServer, ctx: ToolContext): void {
  registerGetLookup(server, ctx, {
    tool: 'swsd_get_group',
    label: 'group',
    collection: 'groups',
    key: 'group',
    description:
      'Fetch one SWSD group (assignment team) by id, including its members ' +
      '(membership_id, name, and user id/email when available). Answers "who is on this team?". Use swsd_list_groups ' +
      'first to find the id.',
    output: GroupOutput,
    map: (raw) => {
      const body = raw && typeof raw === 'object' && 'group' in raw ? raw.group : raw;
      const group = toGroupSummary(body);
      if (!group) return null;
      const members = toGroupMembers(body);
      return { ...group, member_count: members.length, members };
    },
  });
}

export function registerGetSite(server: McpServer, ctx: ToolContext): void {
  registerGetLookup(server, ctx, {
    tool: 'swsd_get_site',
    label: 'site',
    collection: 'sites',
    key: 'site',
    description:
      'Fetch one SWSD site (office/branch location) by id. Returns name, location ' +
      'code, description, time_zone. Use swsd_list_sites first to find the id.',
    output: SiteOutput,
    map: (raw) => {
      const s = toSiteSummary(raw);
      return s ? { ...s } : null;
    },
  });
}

export function registerGetDepartment(server: McpServer, ctx: ToolContext): void {
  registerGetLookup(server, ctx, {
    tool: 'swsd_get_department',
    label: 'department',
    collection: 'departments',
    key: 'department',
    description:
      'Fetch one SWSD department by id. Returns name and description. Use ' +
      'swsd_list_departments first to find the id.',
    output: DepartmentOutput,
    map: (raw) => {
      const d = toDepartmentSummary(raw);
      return d ? { ...d } : null;
    },
  });
}

export function registerGetCategory(server: McpServer, ctx: ToolContext): void {
  registerGetLookup(server, ctx, {
    tool: 'swsd_get_category',
    label: 'category',
    collection: 'categories',
    key: 'category',
    description:
      'Fetch one SWSD category by id, with its subcategories (children), parent_id ' +
      'and default_assignee_id. Use swsd_list_categories first to find the id.',
    output: CategoryOutput,
    map: (raw) => {
      const c = toCategorySummary(raw);
      return c ? { ...c } : null;
    },
  });
}

export function registerGetRole(server: McpServer, ctx: ToolContext): void {
  registerGetLookup(server, ctx, {
    tool: 'swsd_get_role',
    label: 'role',
    collection: 'roles',
    key: 'role',
    description:
      'Fetch one SWSD role by id. Returns name and description. Use swsd_list_roles first to find the id.',
    output: RoleOutput,
    map: (raw) => {
      const body = raw && typeof raw === 'object' && 'role' in raw ? raw.role : raw;
      const role = toRoleSummary(body);
      return role ? { ...role } : null;
    },
  });
}
