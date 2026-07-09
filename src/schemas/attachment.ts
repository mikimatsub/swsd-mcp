import { z } from 'zod';

export const AttachmentParentType = z.enum([
  'incidents',
  'problems',
  'changes',
  'releases',
  'solutions',
  'hardwares',
  'other_assets',
  'configuration_items',
]);

export const UploadAttachmentInput = z.object({
  parent_type: AttachmentParentType.describe('SWSD parent object type.'),
  parent_id: z.number().int().positive().describe('SWSD parent record id.'),
  file_name: z.string().min(1).describe('File name to show in SWSD.'),
  content_base64: z
    .string()
    .min(1)
    .optional()
    .describe('Base64-encoded file contents. Use this for HTTP transport.'),
  file_path: z
    .string()
    .min(1)
    .optional()
    .describe('Local filesystem path. Allowed only when SWSD_TRANSPORT=stdio.'),
});

export type UploadAttachmentInputT = z.infer<typeof UploadAttachmentInput>;
