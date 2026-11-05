import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { ToolContext } from '../../config/toolRegistry.js';
import type { SwsdClient } from '../../swsd/client.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { toGenericRecordSummary } from '../../swsd/mappers/record.js';
import { ListIncidentTasksInput } from '../../schemas/task.js';
import { RECORD_REFERENCE_DESCRIPTION, resolveIncidentRef } from '../../utils/idResolver.js';
import { checkWriteMode } from './writeMode.js';

export const SafeDeleteInput = z.object({
  id: z.number().int().positive().describe('Record reference. See the tool description for supported IDs or numbers.'),
  confirm: z.boolean().default(false).describe('Set true only after the user confirms deletion of the previewed record.'),
  confirm_id: z.number().int().positive().optional().describe('Internal record ID from the preview, required to confirm deletion.'),
});

interface SafeDeleteConfig {
  kind: string;
  toolName: string;
  collectionPath: string;
  envelopeKey: string;
  resolveRef?: (input: number, client: SwsdClient) => Promise<{ id: number }>;
}

export function registerSafeDelete(
  server: McpServer,
  ctx: ToolContext,
  { kind, toolName, collectionPath, envelopeKey, resolveRef }: SafeDeleteConfig,
): void {
  server.registerTool(
    toolName,
    {
      description:
        `DESTRUCTIVE — delete an SWSD ${kind}. ` +
        (resolveRef
          ? RECORD_REFERENCE_DESCRIPTION
          : 'Requires the internal record id. ') +
        'First call without confirmation to preview the record. Ask the user to confirm, ' +
        'then re-call with confirm:true and confirm_id equal to the previewed internal id. ' +
        'Dry-run mode always previews; disabled mode blocks. Does not retry DELETE requests.',
      inputSchema: SafeDeleteInput,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: true },
    },
    async (input) => {
      try {
        // Disabled writes must be blocked even if the reference cannot be resolved.
        if (ctx.env.SWSD_WRITE_MODE === 'disabled') {
          const gated = checkWriteMode(ctx, {
            method: 'DELETE',
            path: `${collectionPath}/${String(input.id)}.json`,
            action: `delete ${kind} ${String(input.id)}`,
          });
          if (gated) return gated;
        }

        const { id } = resolveRef ? await resolveRef(input.id, ctx.client) : input;
        const path = `${collectionPath}/${String(id)}.json`;
        const request = { method: 'DELETE' as const, path };
        const { body } = await ctx.client.get<unknown>(path);
        // Accept both the existing client's flat records and the API's named envelopes.
        const raw = body && typeof body === 'object' && envelopeKey in body
          ? (body as Record<string, unknown>)[envelopeKey]
          : body;
        const summary = toGenericRecordSummary(raw);
        if (!summary || !Number.isInteger(summary.id) || summary.id <= 0 || summary.id !== id) {
          return toolError(`Could not verify ${kind} ${String(id)} from SWSD. No DELETE request was sent.`);
        }
        // Only expose the identity fields, never the raw response or its headers.
        const record = {
          id: summary.id,
          number: summary.number ?? null,
          name: summary.name,
          state: summary.state ?? null,
        };
        const gated = checkWriteMode(ctx, {
          ...request,
          action: `delete ${kind} ${String(id)}`,
        });
        if (gated?.isError) return gated;
        if (gated || input.confirm !== true || input.confirm_id !== id) {
          const hint =
            `Ask the user to confirm deletion of this ${kind}, then re-call with ` +
            `confirm:true and confirm_id:${String(id)} (the internal id).`;
          return structuredResult(
            {
              ...(gated ? { dry_run: true } : { confirmation_required: true }),
              would_delete: record,
              request,
              hint,
            },
            `${gated ? 'Dry run' : 'Confirmation required'}: would delete ${kind} ${String(id)}: ${record.name}. ` +
              `No DELETE request was sent. ${hint}`,
          );
        }

        await ctx.client.delete(path);
        return structuredResult(
          { deleted: true, record, request },
          `Deleted ${kind} ${String(id)}: ${record.name}`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}

interface SafeSubresourceDeleteConfig {
  kind: string;
  toolName: string;
  collection: 'comments' | 'tasks' | 'time_tracks';
  idField: 'comment_id' | 'task_id' | 'time_track_id';
  envelopeKey: 'comment' | 'task' | 'time_track';
  summarize: (raw: unknown) => ({ id: number } & Record<string, unknown>) | null;
}

/** Incident sub-resources are verified through their parent's list, never a guessed item GET. */
export function registerSafeSubresourceDelete(
  server: McpServer,
  ctx: ToolContext,
  { kind, toolName, collection, idField, envelopeKey, summarize }: SafeSubresourceDeleteConfig,
): void {
  server.registerTool(
    toolName,
    {
      description:
        `DESTRUCTIVE — delete an SWSD incident ${kind}. ` +
        'Accepts an incident internal id (>=7 digits) or human-facing number (<=6 digits), ' +
        `and the internal ${idField}. First call without confirmation to preview the record. ` +
        'Ask the user to confirm, then re-call with confirm:true and confirm_id equal to ' +
        'the previewed sub-record id, not the incident id. Dry-run mode always previews; ' +
        'disabled mode blocks. Does not retry DELETE requests.',
      inputSchema: SafeDeleteInput.omit({ id: true }).extend({
        incident_id: ListIncidentTasksInput.shape.incident_id,
        [idField]: SafeDeleteInput.shape.id.describe(`Internal ${kind} id from the parent's list tool.`),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: true },
    },
    async (input: Record<string, unknown>) => {
      try {
        const incidentRef = input.incident_id as number;
        const id = input[idField] as number;
        if (ctx.env.SWSD_WRITE_MODE === 'disabled') {
          const gated = checkWriteMode(ctx, {
            method: 'DELETE',
            path: `/incidents/${String(incidentRef)}/${collection}/${String(id)}.json`,
            action: `delete ${kind} ${String(id)} on incident ${String(incidentRef)}`,
          });
          if (gated) return gated;
        }

        const { id: incidentId } = await resolveIncidentRef(incidentRef, ctx.client);
        const parentPath = `/incidents/${String(incidentId)}/${collection}`;
        const request = { method: 'DELETE' as const, path: `${parentPath}/${String(id)}.json` };
        let record: ({ id: number; incident_id: number } & Record<string, unknown>) | undefined;
        // Bounded scan: at most 20 pages of 100 (2,000 sub-records) before giving up without deleting.
        for (let page = 1; page <= 20; page++) {
          const { body, pagination } = await ctx.client.get<unknown>(`${parentPath}.json`, { page, per_page: 100 });
          if (!Array.isArray(body)) {
            return toolError(`Could not verify ${kind} ${String(id)} from SWSD. No DELETE request was sent.`);
          }
          for (const row of body as unknown[]) {
            const raw = row && typeof row === 'object' && envelopeKey in row
              ? (row as Record<string, unknown>)[envelopeKey] : row;
            const summary = summarize(raw);
            if (summary && Number.isInteger(summary.id) && summary.id > 0 && summary.id === id) {
              record = { ...summary, incident_id: incidentId };
              break;
            }
          }
          if (record) break;
          if (!pagination.has_more) {
            return toolError(`${kind} ${String(id)} not found on incident ${String(incidentId)}. No DELETE request was sent.`);
          }
        }
        if (!record) {
          return toolError(`Could not verify ${kind} ${String(id)} within the list page limit. No DELETE request was sent.`);
        }

        const gated = checkWriteMode(ctx, {
          ...request,
          action: `delete ${kind} ${String(id)} on incident ${String(incidentId)}`,
        });
        if (gated?.isError) return gated;
        if (gated || input.confirm !== true || input.confirm_id !== id) {
          const hint = `Ask the user to confirm deletion of this ${kind}, then re-call with ` +
            `confirm:true and confirm_id:${String(id)} (the internal sub-record id).`;
          return structuredResult(
            {
              ...(gated ? { dry_run: true } : { confirmation_required: true }),
              would_delete: record,
              request,
              hint,
            },
            `${gated ? 'Dry run' : 'Confirmation required'}: would delete ${kind} ${String(id)} on incident ${String(incidentId)}. ` +
              `No DELETE request was sent. ${hint}`,
          );
        }
        await ctx.client.delete(request.path);
        return structuredResult(
          { deleted: true, record, request },
          `Deleted ${kind} ${String(id)} on incident ${String(incidentId)}.`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
