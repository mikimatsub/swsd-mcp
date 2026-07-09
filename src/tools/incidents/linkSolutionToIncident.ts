import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LinkSolutionToIncidentInput } from '../../schemas/incident.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { mapSwsdError } from '../../swsd/errors.js';
import {
  buildIncidentWritePayload,
  toIncidentDetail,
} from '../../swsd/mappers/incident.js';
import { resolveIncidentRef, resolveSolutionRef } from '../../utils/idResolver.js';
import { checkWriteMode } from '../shared/writeMode.js';
import type { ToolContext } from '../../config/toolRegistry.js';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Extract existing linked solution IDs from an incident detail's read-shape
 * `solutions` array (each entry is `{id, href}`).
 */
function extractExistingSolutionIds(detail: Record<string, unknown>): number[] {
  const raw = detail.solutions;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry): number | null => {
      if (!isPlainObject(entry)) return null;
      const id =
        typeof entry.id === 'number'
          ? entry.id
          : typeof entry.id === 'string'
          ? Number(entry.id)
          : NaN;
      return Number.isFinite(id) && id > 0 ? id : null;
    })
    .filter((id): id is number => id !== null);
}

export function registerLinkSolutionToIncident(
  server: McpServer,
  ctx: ToolContext,
): void {
  server.registerTool(
    'swsd_link_solution_to_incident',
    {
      description:
        'Attach a knowledge-base solution to an incident. Fetches the incident ' +
        'first, reads its existing linked solutions, appends the new one (preserving ' +
        'others), then PUTs with `solution_ids` (the SWSD write shape — distinct from ' +
        'the read shape `solutions`). Idempotent — if the solution is already linked, ' +
        'returns success without modifying the record. WRITE — does not retry on ' +
        'transient failure.',
      inputSchema: LinkSolutionToIncidentInput.shape,
      annotations: { readOnlyHint: false, openWorldHint: true, idempotentHint: true },
    },
    async ({ incident_id, solution_id }) => {
      try {
        // Resolve both refs in parallel — they're independent lookups so
        // serializing them would needlessly add round-trip latency. Each may
        // throw InputError (no row found) or pass through the id with no I/O.
        const [
          { id: resolvedIncidentId },
          { id: resolvedSolutionId },
        ] = await Promise.all([
          resolveIncidentRef(incident_id, ctx.client),
          resolveSolutionRef(solution_id, ctx.client),
        ]);

        const fetchRes = await ctx.client.get<unknown>(
          `/incidents/${String(resolvedIncidentId)}.json`,
        );
        const detail = toIncidentDetail(fetchRes.body);
        if (!detail) {
          return toolError(
            `Could not parse incident ${String(resolvedIncidentId)} for read-before-link.`,
          );
        }

        const existingIds = extractExistingSolutionIds(detail);
        if (existingIds.includes(resolvedSolutionId)) {
          return structuredResult(
            { incident: detail, already_linked: true },
            `Solution ${String(resolvedSolutionId)} is already linked to incident ${String(resolvedIncidentId)} — no change.`,
          );
        }

        const merged = [...existingIds, resolvedSolutionId];
        const payload = buildIncidentWritePayload({ solution_ids: merged });
        const path = `/incidents/${String(resolvedIncidentId)}.json`;
        const gated = checkWriteMode(ctx, {
          method: 'PUT',
          path,
          body: payload,
          action: `link solution ${String(resolvedSolutionId)} to incident ${String(resolvedIncidentId)}`,
        });
        if (gated) return gated;
        const { body } = await ctx.client.put<unknown>(path, payload);
        const updated = toIncidentDetail(body);
        if (!updated) {
          return toolError('Could not parse update response after linking solution.');
        }
        return structuredResult(
          { incident: updated },
          `Linked solution ${String(resolvedSolutionId)} to incident ${String(resolvedIncidentId)} ` +
            `(now ${String(merged.length)} total linked solution${merged.length === 1 ? '' : 's'}).`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
