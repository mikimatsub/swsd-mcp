import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { ToolContext } from '../../config/toolRegistry.js';
import type { SwsdClient } from '../../swsd/client.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { toGenericRecordSummary } from '../../swsd/mappers/record.js';
import { checkWriteMode } from './writeMode.js';

export const SafeDeleteInput = z.object({
  id: z.number().int().positive().describe('Record reference. See the tool description for supported IDs or numbers.'),
  confirm: z.boolean().default(false).describe('Set true only after the user confirms deletion of the previewed record.'),
  confirm_id: z.number().int().positive().optional().describe('Internal record ID from the preview, required to confirm deletion.'),
});

interface SafeDeleteConfig {
<<<<<<< HEAD
  kind: string;
  toolName: string;
  collectionPath: string;
  envelopeKey: string;
=======
  kind: 'incident' | 'problem' | 'change' | 'release' | 'solution';
>>>>>>> origin/main
  resolveRef?: (input: number, client: SwsdClient) => Promise<{ id: number }>;
}

export function registerSafeDelete(
  server: McpServer,
  ctx: ToolContext,
<<<<<<< HEAD
  { kind, toolName, collectionPath, envelopeKey, resolveRef }: SafeDeleteConfig,
): void {
  server.registerTool(
    toolName,
=======
  { kind, resolveRef }: SafeDeleteConfig,
): void {
  server.registerTool(
    `swsd_delete_${kind}`,
>>>>>>> origin/main
    {
      description:
        `DESTRUCTIVE — delete an SWSD ${kind}. ` +
        (resolveRef
          ? 'Accepts an internal id (>=7 digits) or human-facing number (<=6 digits). '
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
<<<<<<< HEAD
            path: `${collectionPath}/${String(input.id)}.json`,
=======
            path: `/${kind}s/${String(input.id)}.json`,
>>>>>>> origin/main
            action: `delete ${kind} ${String(input.id)}`,
          });
          if (gated) return gated;
        }

        const { id } = resolveRef ? await resolveRef(input.id, ctx.client) : input;
<<<<<<< HEAD
        const path = `${collectionPath}/${String(id)}.json`;
        const request = { method: 'DELETE' as const, path };
        const { body } = await ctx.client.get<unknown>(path);
        // Accept both the existing client's flat records and the API's named envelopes.
        const raw = body && typeof body === 'object' && envelopeKey in body
          ? (body as Record<string, unknown>)[envelopeKey]
=======
        const path = `/${kind}s/${String(id)}.json`;
        const request = { method: 'DELETE' as const, path };
        const { body } = await ctx.client.get<unknown>(path);
        // Accept both the existing client's flat records and the API's named envelopes.
        const raw = body && typeof body === 'object' && kind in body
          ? (body as Record<string, unknown>)[kind]
>>>>>>> origin/main
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
