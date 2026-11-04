import { z } from 'zod';
import { EmailInput, MAX_LABEL_CHARS, MAX_LONG_TEXT_CHARS, MAX_QUERY_CHARS } from './limits.js';

const PaginationFields = {
  page: z
    .number()
    .int()
    .min(1)
    .max(10_000)
    .default(1)
    .describe('Page number (1-indexed).'),
  per_page: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(25)
    .describe('Results per page (1-100).'),
};

export const ListLookupInput = z.object({
  ...PaginationFields,
  query: z
    .string()
    .max(MAX_QUERY_CHARS)
    .optional()
    .describe('Optional name substring filter.'),
});

export const ListUsersInput = z.object({
  ...PaginationFields,
  query: z
    .string()
    .max(MAX_QUERY_CHARS)
    .optional()
    .describe('Optional name or email substring filter.'),
  email: EmailInput
    .optional()
    .describe('Filter to a specific email exactly.'),
  available_for_assignment_only: z
    .boolean()
    .default(false)
    .describe('If true, only return users who can be assigned tickets.'),
});

export type ListLookupInput = z.infer<typeof ListLookupInput>;
export type ListUsersInput = z.infer<typeof ListUsersInput>;

export const GetLookupByIdInput = z.object({
  id: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .describe('SWSD record id (from the matching swsd_list_* tool).'),
});

export type GetLookupByIdInput = z.infer<typeof GetLookupByIdInput>;

const DirectoryId = GetLookupByIdInput.shape.id;
const DirectoryName = z.string().min(1).max(MAX_LABEL_CHARS);
const DirectoryLabel = z.string().max(MAX_LABEL_CHARS);
const DirectoryDescription = z.string().max(MAX_LONG_TEXT_CHARS);

export const CreateUserInput = z.object({
  name: DirectoryName,
  email: EmailInput,
  title: DirectoryLabel.optional(),
  phone: DirectoryLabel.optional(),
  mobile_phone: DirectoryLabel.optional(),
  role_name: DirectoryName.optional().describe('Role name from swsd_list_roles.'),
  site_name: DirectoryName.optional().describe('Site name from swsd_list_sites.'),
  department_name: DirectoryName.optional().describe('Department name from swsd_list_departments.'),
  reports_to_email: EmailInput.optional().describe('Email of the user this user reports to.'),
});

export const UpdateUserInput = CreateUserInput.partial().extend({
  id: DirectoryId,
  disabled: z.boolean().optional(),
});

export const CreateGroupInput = z.object({
  name: DirectoryName,
  description: DirectoryDescription.optional(),
  email: EmailInput.optional(),
});

export const UpdateGroupInput = CreateGroupInput.partial().extend({ id: DirectoryId });

export const CreateSiteInput = z.object({
  name: DirectoryName,
  location: DirectoryLabel.optional(),
  description: DirectoryDescription.optional(),
  time_zone: DirectoryLabel.optional(),
});

export const UpdateSiteInput = CreateSiteInput.partial().extend({ id: DirectoryId });

export const CreateDepartmentInput = z.object({
  name: DirectoryName,
  description: DirectoryDescription.optional(),
});

export const UpdateDepartmentInput = CreateDepartmentInput.partial().extend({ id: DirectoryId });

export const CreateCategoryInput = z.object({
  name: DirectoryName,
  parent_id: DirectoryId.optional(),
  default_assignee_id: DirectoryId.optional(),
});

export const UpdateCategoryInput = CreateCategoryInput.partial().extend({ id: DirectoryId });

export const CreateRoleInput = z.object({
  name: DirectoryName,
  description: DirectoryDescription.optional(),
});

export const UpdateRoleInput = CreateRoleInput.partial().extend({ id: DirectoryId });

export const AddGroupMemberInput = z.object({
  group_id: DirectoryId.describe('Internal group id from swsd_list_groups.'),
  user_id: DirectoryId.describe('Internal user id from swsd_list_users.'),
});

export const RemoveGroupMemberInput = z.object({
  membership_id: DirectoryId.describe('Membership id returned by swsd_add_group_member, not a user or group id.'),
  confirm: z.boolean().default(false).describe('Set true only after the user confirms the previewed membership removal.'),
  confirm_id: DirectoryId.optional().describe('Membership id from the preview, required to confirm removal.'),
});
