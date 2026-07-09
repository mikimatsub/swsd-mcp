import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { UploadAttachmentInput } from '../../schemas/attachment.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { checkWriteMode } from '../shared/writeMode.js';
import type { ToolContext } from '../../config/toolRegistry.js';

const ATTACHABLE_TYPE: Record<string, string> = {
  incidents: 'Incident',
  problems: 'Problem',
  changes: 'Change',
  releases: 'Release',
  solutions: 'Solution',
  hardwares: 'Hardware',
  other_assets: 'OtherAsset',
  configuration_items: 'ConfigurationItem',
};

export function registerUploadAttachment(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_upload_attachment',
    {
      description:
        'Upload an attachment to a SWSD incident, problem, change, release, solution, hardware asset, other asset, or configuration item. ' +
        'Use content_base64 for hosted/HTTP clients; file_path is allowed only on stdio. WRITE — honors SWSD_WRITE_MODE.',
      inputSchema: UploadAttachmentInput.shape,
      annotations: { readOnlyHint: false, openWorldHint: true, idempotentHint: false },
    },
    async ({ parent_type, parent_id, file_name, content_base64, file_path }) => {
      try {
        if ((content_base64 ? 1 : 0) + (file_path ? 1 : 0) !== 1) {
          return toolError(
            'Provide exactly one attachment source.',
            'Pass content_base64 for HTTP/hosted use, or file_path for stdio-local use.',
          );
        }
        if (file_path && ctx.env.SWSD_TRANSPORT !== 'stdio') {
          return toolError(
            'file_path attachments are only allowed when SWSD_TRANSPORT=stdio.',
            'Use content_base64 when calling this server over HTTP.',
          );
        }

        const attachableType = ATTACHABLE_TYPE[parent_type];
        if (!attachableType) return toolError(`Unsupported attachment parent_type: ${parent_type}`);

        const bytes = file_path
          ? readFileSync(file_path)
          : Buffer.from(content_base64 ?? '', 'base64');
        if (bytes.length === 0) return toolError('Attachment contents are empty.');

        const displayName = file_name || (file_path ? basename(file_path) : 'attachment');
        const path = '/attachments.json';
        const dryRunBody = {
          file: {
            attachable_type: attachableType,
            attachable_id: parent_id,
            attachment: {
              file_name: displayName,
              bytes: bytes.length,
            },
          },
        };
        const gated = checkWriteMode(ctx, {
          method: 'POST',
          path,
          body: dryRunBody,
          action: `upload ${displayName} to ${parent_type} ${String(parent_id)}`,
        });
        if (gated) return gated;

        const form = new FormData();
        form.set('file[attachable_type]', attachableType);
        form.set('file[attachable_id]', String(parent_id));
        form.set('file[attachment]', new Blob([new Uint8Array(bytes)]), displayName);

        const { body, status } = await ctx.client.rawRequest(path, {
          method: 'POST',
          body: form,
          headers: {
            Accept: 'application/vnd.samanage.v1.3+json',
          },
        });

        return structuredResult(
          {
            attachment: body,
            parent: { type: parent_type, id: parent_id },
            status,
          },
          `Uploaded attachment ${displayName} to ${parent_type} ${String(parent_id)}.`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
