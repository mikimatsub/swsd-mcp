import { z } from 'zod';

export const ListIncidentCommentsInput = z.object({
  incident_id: z
    .number()
    .int()
    .positive()
    .describe(
      'SWSD incident reference. Accepts either the internal id (>=7 digits, e.g. 180457930) or the human-facing number (<=6 digits, e.g. 60310). The handler auto-detects via digit count.',
    ),
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
});

export const AddIncidentCommentInput = z.object({
  incident_id: z
    .number()
    .int()
    .positive()
    .describe(
      'SWSD incident reference. Accepts either the internal id (>=7 digits, e.g. 180457930) or the human-facing number (<=6 digits, e.g. 60310). The handler auto-detects via digit count.',
    ),
  body: z
    .string()
    .min(1)
    .max(50_000)
    .describe('Comment text. Plain text or HTML.'),
  is_private: z
    .boolean()
    .default(false)
    .describe('If true, the comment is internal-only (not visible to the requester). Default false.'),
  notify: z
    .boolean()
    .default(false)
    .describe(
      'Request SWSD notification callbacks (add_callbacks=true). Default false. Set true only when the user explicitly asks to notify; delivery depends on SWSD settings.',
    ),
});

export const UpdateCommentInput = z.object({
  incident_id: z
    .number()
    .int()
    .positive()
    .describe(
      'SWSD incident reference. Accepts either the internal id (>=7 digits, e.g. 180457930) or the human-facing number (<=6 digits, e.g. 60310). The handler auto-detects via digit count.',
    ),
  comment_id: z
    .number()
    .int()
    .positive()
    .describe('SWSD comment ID to update.'),
  body: z
    .string()
    .min(1)
    .max(50_000)
    .describe('New comment text (replaces existing). Plain text or HTML.'),
});

export type ListIncidentCommentsInput = z.infer<typeof ListIncidentCommentsInput>;
export type AddIncidentCommentInput = z.infer<typeof AddIncidentCommentInput>;
export type UpdateCommentInput = z.infer<typeof UpdateCommentInput>;
