import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  ListTimeTracksInput,
  LogTimeInput,
  UpdateTimeTrackInput,
} from '../../schemas/timeTrack.js';
import { PaginationOutput } from '../../schemas/output.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { buildTimeTrackPayload, toTimeTrack } from '../../swsd/mappers/timeTrack.js';
import { checkWriteMode } from '../shared/writeMode.js';
import type { ToolContext } from '../../config/toolRegistry.js';

const TimeTrackOutput = z.object({
  id: z.number().int(),
  name: z.string(),
  minutes_parsed: z.number().int().optional(),
  creator: z
    .object({
      id: z.number().int().optional(),
      name: z.string().optional(),
      email: z.string().optional(),
    })
    .optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

function collectionPath(objectType: string, id: number): string {
  return `/${objectType}/${String(id)}/time_tracks.json`;
}

function itemPath(objectType: string, id: number, timeTrackId: number): string {
  return `/${objectType}/${String(id)}/time_tracks/${String(timeTrackId)}.json`;
}

export function registerListTimeTracks(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_list_time_tracks',
    {
      description:
        'List SWSD time entries for an incident, problem, change, or release. ' +
        'Use this before adding/updating time when you need existing work-log context.',
      inputSchema: ListTimeTracksInput.shape,
      outputSchema: z
        .object({
          time_tracks: z.array(TimeTrackOutput),
          pagination: PaginationOutput,
        })
        .shape,
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    },
    async ({ object_type, id, page, per_page }) => {
      try {
        const { body, pagination } = await ctx.client.get<unknown>(
          collectionPath(object_type, id),
          { page, per_page },
        );
        const rows = Array.isArray(body) ? body : [];
        const timeTracks = rows.map(toTimeTrack).filter((x): x is NonNullable<typeof x> => x !== null);
        return structuredResult(
          { time_tracks: timeTracks, pagination },
          `Returned ${String(timeTracks.length)} time entries for ${object_type} ${String(id)}.`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}

export function registerLogTime(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_log_time',
    {
      description:
        'Log time against a SWSD incident, problem, change, or release. Required: object_type, id, name, minutes_parsed. ' +
        'WRITE — honors SWSD_WRITE_MODE and does not retry on transient failure.',
      inputSchema: LogTimeInput.shape,
      annotations: { readOnlyHint: false, openWorldHint: true, idempotentHint: false },
    },
    async ({ object_type, id, name, minutes_parsed }) => {
      try {
        const path = collectionPath(object_type, id);
        const payload = buildTimeTrackPayload({ name, minutes_parsed });
        const gated = checkWriteMode(ctx, {
          method: 'POST',
          path,
          body: payload,
          action: `log time on ${object_type} ${String(id)}`,
        });
        if (gated) return gated;

        const { body } = await ctx.client.post<unknown>(path, payload);
        const timeTrack = toTimeTrack(unwrapTimeTrack(body));
        if (!timeTrack) return toolError('Could not parse created time-track response from SWSD.');
        return structuredResult(
          { time_track: timeTrack },
          `Logged ${String(timeTrack.minutes_parsed ?? minutes_parsed)} minutes on ${object_type} ${String(id)}.`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}

export function registerUpdateTimeTrack(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_update_time_track',
    {
      description:
        'Update an existing SWSD time entry on an incident, problem, change, or release. ' +
        'Pass name and/or minutes_parsed. WRITE — honors SWSD_WRITE_MODE and does not retry on transient failure.',
      inputSchema: UpdateTimeTrackInput.shape,
      annotations: { readOnlyHint: false, openWorldHint: true, idempotentHint: false },
    },
    async ({ object_type, id, time_track_id, name, minutes_parsed }) => {
      try {
        if (name === undefined && minutes_parsed === undefined) {
          return toolError('No update fields were provided.', 'Pass name and/or minutes_parsed.');
        }

        const path = itemPath(object_type, id, time_track_id);
        const payload = buildTimeTrackPayload({ name, minutes_parsed });
        const gated = checkWriteMode(ctx, {
          method: 'PUT',
          path,
          body: payload,
          action: `update time entry ${String(time_track_id)} on ${object_type} ${String(id)}`,
        });
        if (gated) return gated;

        const { body } = await ctx.client.put<unknown>(path, payload);
        const timeTrack = toTimeTrack(unwrapTimeTrack(body));
        if (!timeTrack) return toolError('Could not parse updated time-track response from SWSD.');
        return structuredResult(
          { time_track: timeTrack },
          `Updated time entry ${String(timeTrack.id)} on ${object_type} ${String(id)}.`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}

function unwrapTimeTrack(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  return 'time_track' in raw ? (raw as { time_track?: unknown }).time_track : raw;
}
