import { z } from 'zod';
import { ListIncidentsInput } from './incident.js';

/**
 * Input for swsd_list_my_incidents — same as ListIncidentsInput but without
 * `assignee_email` (the wrapper sets it from swsd_get_me automatically).
 *
 * Z's omit({ key: true }) is the canonical shape-removal in Zod v4.
 */
export const ListMyIncidentsInput = ListIncidentsInput.omit({
  assignee_email: true,
}).extend({
  role: z.enum(['assignee', 'requester']).default('assignee')
    .describe('assignee: tickets assigned to you (page-local filter). requester: tickets requested by you (server-side filter).'),
});

export type ListMyIncidentsInput = z.infer<typeof ListMyIncidentsInput>;
