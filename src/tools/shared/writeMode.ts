import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from '../../config/toolRegistry.js';
import { toolError } from '../../mcp/errors.js';
import { structuredResult } from '../../mcp/output.js';

export interface WriteRequestPreview {
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
}

export interface WriteModeCheckInput extends WriteRequestPreview {
  action: string;
  dryRunBody?: unknown;
}

export function checkWriteMode(
  ctx: ToolContext,
  input: WriteModeCheckInput,
): CallToolResult | null {
  if (ctx.env.SWSD_WRITE_MODE === 'disabled') {
    return toolError(
      `Write tool blocked: SWSD_WRITE_MODE=disabled. Would have attempted to ${input.action}.`,
      'Set SWSD_WRITE_MODE=live to permit writes, or dry-run to inspect write payloads without calling SWSD.',
    );
  }

  if (ctx.env.SWSD_WRITE_MODE === 'dry-run') {
    return structuredResult(
      {
        dry_run: true,
        request: {
          method: input.method,
          path: input.path,
          body: input.dryRunBody ?? input.body,
        },
      },
      `Dry run: would ${input.action}. No SWSD write request was sent.`,
    );
  }

  return null;
}
