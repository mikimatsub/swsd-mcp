import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  MAX_ATTACHMENT_BYTES,
  UploadAttachmentInput,
} from '../../schemas/attachment.js';
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

class AttachmentInputError extends Error {}

function isWithinRoot(root: string, filePath: string): boolean {
  const relativePath = relative(root, filePath);
  return (
    relativePath === '' ||
    (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
  );
}

function readBoundedAttachment(filePath: string, allowedRoot?: string): Buffer {
  let realFilePath: string;
  try {
    realFilePath = realpathSync(filePath);
  } catch {
    throw new AttachmentInputError('Attachment file_path could not be resolved.');
  }

  if (allowedRoot) {
    let realRoot: string;
    try {
      realRoot = realpathSync(allowedRoot);
    } catch {
      throw new AttachmentInputError('SWSD_ATTACHMENT_ROOT could not be resolved.');
    }
    if (!statSync(realRoot).isDirectory()) {
      throw new AttachmentInputError('SWSD_ATTACHMENT_ROOT must reference a directory.');
    }
    if (!isWithinRoot(realRoot, realFilePath)) {
      throw new AttachmentInputError('Attachment file_path is outside SWSD_ATTACHMENT_ROOT.');
    }
  }

  let descriptor: number;
  try {
    descriptor = openSync(realFilePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch {
    throw new AttachmentInputError('Attachment file_path could not be opened safely.');
  }

  try {
    const stats = fstatSync(descriptor);
    if (!stats.isFile()) {
      throw new AttachmentInputError('Attachment file_path must reference a regular file.');
    }
    if (stats.size > MAX_ATTACHMENT_BYTES) {
      throw new AttachmentInputError('Attachment exceeds the SWSD 25 MB file limit.');
    }

    const bytes = Buffer.allocUnsafe(stats.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) {
        throw new AttachmentInputError('Attachment changed while it was being read.');
      }
      offset += count;
    }

    const probe = Buffer.allocUnsafe(1);
    if (readSync(descriptor, probe, 0, 1, stats.size) > 0) {
      throw new AttachmentInputError('Attachment changed while it was being read.');
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

export function registerUploadAttachment(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_upload_attachment',
    {
      description:
        'Upload an attachment to a SWSD incident, problem, change, release, solution, hardware asset, other asset, or configuration item. ' +
        'Use content_base64 for hosted/HTTP clients; file_path is allowed only on stdio. WRITE — honors SWSD_WRITE_MODE.',
      inputSchema: UploadAttachmentInput,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
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
          ? readBoundedAttachment(file_path, ctx.env.SWSD_ATTACHMENT_ROOT)
          : Buffer.from(content_base64 ?? '', 'base64');
        if (bytes.length === 0) return toolError('Attachment contents are empty.');
        if (bytes.length > MAX_ATTACHMENT_BYTES) {
          return toolError('Attachment exceeds the SWSD 25 MB file limit.');
        }

        const displayName = file_name;
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
        if (err instanceof AttachmentInputError) return toolError(err.message);
        return mapSwsdError(err);
      }
    },
  );
}
