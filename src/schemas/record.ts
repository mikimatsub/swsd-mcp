import { z } from 'zod';
import { PaginationParams } from './common.js';
import { CustomFieldsArray } from './customFieldWrite.js';

export const DetailLevelInput = z
  .enum(['short', 'long'])
  .default('short')
  .describe('Use "long" when SWSD documents layout=long for this endpoint.');

export const ListRecordsInput = PaginationParams.extend({
  detail_level: DetailLevelInput.optional(),
});

export const GetRecordInput = z.object({
  id: z.number().int().positive().describe('SWSD internal id for the record.'),
  detail_level: DetailLevelInput,
});

const PersonEmailInput = z
  .string()
  .email()
  .optional()
  .describe('Email address SWSD should resolve to a user.');

const CommonLifecycleWriteFields = {
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  state: z.string().optional(),
  priority: z.string().optional(),
  requester_email: PersonEmailInput,
  assignee_email: PersonEmailInput,
  group_assignee_id: z.number().int().positive().optional(),
  site_id: z.number().int().positive().optional(),
  department_id: z.number().int().positive().optional(),
  planned_start_at: z.string().optional(),
  planned_end_at: z.string().optional(),
  configuration_item_ids: z.array(z.number().int().positive()).optional(),
  tag_list: z.array(z.string().min(1)).optional(),
  custom_fields: CustomFieldsArray,
} as const;

export const CreateChangeInput = z.object({
  ...CommonLifecycleWriteFields,
  name: z.string().min(1).max(200).describe('Change title (required).'),
  change_type: z.string().optional(),
  change_plan: z.string().optional(),
  rollback_plan: z.string().optional(),
  test_plan: z.string().optional(),
  incident_ids: z.array(z.number().int().positive()).optional(),
  problem_ids: z.array(z.number().int().positive()).optional(),
  release_ids: z.array(z.number().int().positive()).optional(),
});

export const UpdateChangeInput = CreateChangeInput.partial().extend({
  id: z.number().int().positive().describe('SWSD change id.'),
});

export const CreateReleaseInput = z.object({
  ...CommonLifecycleWriteFields,
  name: z.string().min(1).max(200).describe('Release title (required).'),
  plan: z.string().optional(),
  build: z.string().optional(),
  deploy: z.string().optional(),
  itsm_change_ids: z.array(z.number().int().positive()).optional(),
});

export const UpdateReleaseInput = CreateReleaseInput.partial().extend({
  id: z.number().int().positive().describe('SWSD release id.'),
});

export type ListRecordsInputT = z.infer<typeof ListRecordsInput>;
export type GetRecordInputT = z.infer<typeof GetRecordInput>;
export type CreateChangeInputT = z.infer<typeof CreateChangeInput>;
export type UpdateChangeInputT = z.infer<typeof UpdateChangeInput>;
export type CreateReleaseInputT = z.infer<typeof CreateReleaseInput>;
export type UpdateReleaseInputT = z.infer<typeof UpdateReleaseInput>;
