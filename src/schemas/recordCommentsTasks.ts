import { z } from 'zod';
import { AddIncidentCommentInput, ListIncidentCommentsInput } from './comment.js';
import { CreateIncidentTaskInput, ListIncidentTasksInput } from './task.js';

const RecordRef = {
  record_type: z.enum(['problems', 'changes', 'releases'])
    .describe('SWSD record type containing the comments or tasks.'),
  record_id: z.number().int().positive().describe('Internal SWSD record ID.'),
};

export const ListRecordCommentsInput = ListIncidentCommentsInput
  .omit({ incident_id: true })
  .extend(RecordRef);

export const AddRecordCommentInput = AddIncidentCommentInput
  .omit({ incident_id: true })
  .extend(RecordRef);

export const ListRecordTasksInput = ListIncidentTasksInput
  .omit({ incident_id: true })
  .extend(RecordRef);

export const CreateRecordTaskInput = CreateIncidentTaskInput
  .pick({ name: true, assignee_email: true, due_at: true })
  .extend(RecordRef);
