import { z } from 'zod';

/** SWSD limits each uploaded file to 25 MB. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENT_BASE64_CHARS = Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4;
export const MAX_ATTACHMENT_FILE_NAME_CHARS = 255;
export const MAX_ATTACHMENT_PATH_CHARS = 4_096;

function decodedBase64Length(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function base64Sextet(code: number): number {
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 71;
  if (code >= 48 && code <= 57) return code + 4;
  return code === 43 ? 62 : 63;
}

function isStrictBase64(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > MAX_ATTACHMENT_BASE64_CHARS ||
    value.length % 4 !== 0
  ) {
    return false;
  }

  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const dataLength = value.length - padding;
  for (let i = 0; i < dataLength; i++) {
    const code = value.charCodeAt(i);
    const valid =
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      code === 43 ||
      code === 47;
    if (!valid) return false;
  }
  for (let i = dataLength; i < value.length; i++) {
    if (value.charCodeAt(i) !== 61) return false;
  }

  if (padding === 1 && (base64Sextet(value.charCodeAt(value.length - 2)) & 0b11) !== 0) {
    return false;
  }
  if (padding === 2 && (base64Sextet(value.charCodeAt(value.length - 3)) & 0b1111) !== 0) {
    return false;
  }
  return true;
}

function isSafeDisplayFileName(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (char === '/' || char === '\\' || code <= 31 || code === 127) return false;
  }
  return true;
}

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
  file_name: z
    .string()
    .trim()
    .min(1)
    .max(MAX_ATTACHMENT_FILE_NAME_CHARS)
    .refine(isSafeDisplayFileName, {
      message: 'File name must not contain path separators or control characters.',
    })
    .describe('File name to show in SWSD (maximum 255 characters).'),
  content_base64: z
    .string()
    .min(1)
    .max(MAX_ATTACHMENT_BASE64_CHARS)
    .refine(isStrictBase64, { message: 'Attachment content must be canonical base64.' })
    .refine((value) => decodedBase64Length(value) <= MAX_ATTACHMENT_BYTES, {
      message: 'Attachment exceeds the SWSD 25 MB file limit.',
    })
    .optional()
    .describe('Base64-encoded file contents. Use this for HTTP transport.'),
  file_path: z
    .string()
    .trim()
    .min(1)
    .max(MAX_ATTACHMENT_PATH_CHARS)
    .optional()
    .describe('Local filesystem path. Allowed only when SWSD_TRANSPORT=stdio.'),
}).superRefine(({ content_base64, file_path }, ctx) => {
  if ((content_base64 ? 1 : 0) + (file_path ? 1 : 0) !== 1) {
    ctx.addIssue({
      code: 'custom',
      message: 'Provide exactly one of content_base64 or file_path.',
      path: ['content_base64'],
    });
  }
});

export type UploadAttachmentInputT = z.infer<typeof UploadAttachmentInput>;
