import { z } from 'zod';
import { PaginationParams } from './common.js';

export const TimeTrackObjectType = z.enum([
  'incidents',
  'problems',
  'changes',
  'releases',
]);

export const ListTimeTracksInput = PaginationParams.extend({
  object_type: TimeTrackObjectType.describe('Parent SWSD object type.'),
  id: z.number().int().positive().describe('Parent record id.'),
});

export const LogTimeInput = z.object({
  object_type: TimeTrackObjectType.describe('Parent SWSD object type.'),
  id: z.number().int().positive().describe('Parent record id.'),
  name: z.string().min(1).describe('Time entry description.'),
  minutes_parsed: z
    .number()
    .int()
    .min(1)
    .describe('Number of minutes to log. SWSD field name is minutes_parsed.'),
});

export const UpdateTimeTrackInput = z.object({
  object_type: TimeTrackObjectType.describe('Parent SWSD object type.'),
  id: z.number().int().positive().describe('Parent record id.'),
  time_track_id: z.number().int().positive().describe('SWSD time track id.'),
  name: z.string().min(1).optional().describe('Updated time entry description.'),
  minutes_parsed: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Updated number of minutes.'),
});

export type ListTimeTracksInputT = z.infer<typeof ListTimeTracksInput>;
export type LogTimeInputT = z.infer<typeof LogTimeInput>;
export type UpdateTimeTrackInputT = z.infer<typeof UpdateTimeTrackInput>;
