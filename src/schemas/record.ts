import { z } from 'zod';
import { PaginationParams } from './common.js';
import { CustomFieldsArray } from './customFieldWrite.js';
import {
  EmailInput,
  IsoDateOrDateTimeInput,
  MAX_FILTER_ITEMS,
  MAX_LABEL_CHARS,
  MAX_LONG_TEXT_CHARS,
  MAX_RELATION_IDS,
} from './limits.js';

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

const PersonEmailInput = EmailInput
  .optional()
  .describe('Email address SWSD should resolve to a user.');

const CommonLifecycleWriteFields = {
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(MAX_LONG_TEXT_CHARS).optional(),
  state: z.string().max(MAX_LABEL_CHARS).optional(),
  priority: z.string().max(MAX_LABEL_CHARS).optional(),
  requester_email: PersonEmailInput,
  assignee_email: PersonEmailInput,
  group_assignee_id: z.number().int().positive().optional(),
  site_id: z.number().int().positive().optional(),
  department_id: z.number().int().positive().optional(),
  planned_start_at: IsoDateOrDateTimeInput.optional(),
  planned_end_at: IsoDateOrDateTimeInput.optional(),
  configuration_item_ids: z.array(z.number().int().positive()).max(MAX_RELATION_IDS).optional(),
  tag_list: z.array(z.string().min(1).max(MAX_LABEL_CHARS)).max(MAX_FILTER_ITEMS).optional(),
  custom_fields: CustomFieldsArray,
} as const;

export const CreateChangeInput = z.object({
  ...CommonLifecycleWriteFields,
  name: z.string().min(1).max(200).describe('Change title (required).'),
  change_type: z.string().max(MAX_LABEL_CHARS).optional(),
  change_plan: z.string().max(MAX_LONG_TEXT_CHARS).optional(),
  rollback_plan: z.string().max(MAX_LONG_TEXT_CHARS).optional(),
  test_plan: z.string().max(MAX_LONG_TEXT_CHARS).optional(),
  incident_ids: z.array(z.number().int().positive()).max(MAX_RELATION_IDS).optional(),
  problem_ids: z.array(z.number().int().positive()).max(MAX_RELATION_IDS).optional(),
  release_ids: z.array(z.number().int().positive()).max(MAX_RELATION_IDS).optional(),
});

export const UpdateChangeInput = CreateChangeInput.partial().extend({
  id: z.number().int().positive().describe('SWSD change id.'),
});

export const CreateReleaseInput = z.object({
  ...CommonLifecycleWriteFields,
  name: z.string().min(1).max(200).describe('Release title (required).'),
  plan: z.string().max(MAX_LONG_TEXT_CHARS).optional(),
  build: z.string().max(MAX_LONG_TEXT_CHARS).optional(),
  deploy: z.string().max(MAX_LONG_TEXT_CHARS).optional(),
  itsm_change_ids: z.array(z.number().int().positive()).max(MAX_RELATION_IDS).optional(),
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
