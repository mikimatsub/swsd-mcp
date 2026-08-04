import { z } from 'zod';
import { EmailInput, IsoDateOrDateTimeInput, MAX_LONG_TEXT_CHARS } from './limits.js';

export const ListIncidentTasksInput = z.object({
  incident_id: z
    .number()
    .int()
    .positive()
    .describe(
      'SWSD incident reference. Accepts either the internal id (>=7 digits, e.g. 180457930) or the human-facing number (<=6 digits, e.g. 60310). The handler auto-detects via digit count.',
    ),
});

export const CreateIncidentTaskInput = z.object({
  incident_id: z
    .number()
    .int()
    .positive()
    .describe(
      'SWSD incident reference. Accepts either the internal id (>=7 digits, e.g. 180457930) or the human-facing number (<=6 digits, e.g. 60310). The handler auto-detects via digit count.',
    ),
  name: z
    .string()
    .min(1)
    .max(500)
    .describe('Task name (required).'),
  description: z
    .string()
    .max(MAX_LONG_TEXT_CHARS)
    .optional()
    .describe('Long-form task description. Plain text or HTML.'),
  due_at: IsoDateOrDateTimeInput
    .optional()
    .describe('Due date / datetime in ISO 8601 (e.g., "2026-06-01" or RFC 3339).'),
  assignee_email: EmailInput
    .optional()
    .describe('Email of the SWSD user to assign the task to.'),
});

export const UpdateTaskStateInput = z.object({
  incident_id: z
    .number()
    .int()
    .positive()
    .describe(
      'SWSD incident reference. Accepts either the internal id (>=7 digits, e.g. 180457930) or the human-facing number (<=6 digits, e.g. 60310). The handler auto-detects via digit count.',
    ),
  task_id: z
    .number()
    .int()
    .positive()
    .describe('SWSD task id (from swsd_list_incident_tasks).'),
  completed: z
    .boolean()
    .describe('True to mark the task complete ("Completed"); false to mark it incomplete ("New").'),
});

export type ListIncidentTasksInput = z.infer<typeof ListIncidentTasksInput>;
export type CreateIncidentTaskInput = z.infer<typeof CreateIncidentTaskInput>;
export type UpdateTaskStateInput = z.infer<typeof UpdateTaskStateInput>;
