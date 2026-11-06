import type { McpServer } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { GetIncidentAttachmentInput } from '../../schemas/incident.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { formatBytes, mapSwsdError, SwsdTooLargeError } from '../../swsd/errors.js';
import { resolveIncidentRef } from '../../utils/idResolver.js';
import type { ToolContext } from '../../config/toolRegistry.js';

/** Default for SWSD_MAX_ATTACHMENT_BYTES (also used when a test context omits env). */
export const DEFAULT_MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

type AttachmentSource = 'incident' | 'comment' | 'description_inline' | 'comment_inline';

export interface IncidentAttachment {
  /** Stable reference to pass back: the SWSD attachment id, or the path for inline images. */
  ref: string;
  filename: string;
  content_type?: string;
  size?: number;
  source: AttachmentSource;
  comment_id?: number;
  /** Path on the SWSD API host. Internal: it works as a bearer link, so it is not returned. */
  path: string;
}

/**
 * SWSD serves both kinds of attachment under /attachments/<key>/...:
 *   - attachment records: `url` = /attachments/<key>/stream (200 with the file)
 *   - images pasted into descriptions/comments: <img src="/attachments/<key>/<name>?thumb=true">
 *     (303 to a pre-signed S3 URL; see SwsdClient.download)
 * Only paths of this shape are ever fetched, always from SWSD_BASE_URL, whatever host the
 * HTML names, so an <img> in ticket content can't make the server call another host.
 */
const ATTACHMENT_PATH = /^\/attachments\/[A-Za-z0-9_-]+(?:\/[^\s?#]*)?$/;
const IMG_SRC = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;

export function toAttachmentPath(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  try {
    const { pathname } = new URL(raw.trim(), 'https://swsd.invalid');
    return ATTACHMENT_PATH.test(pathname) ? pathname : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function lastSegment(path: string): string {
  const seg = path.split('/').filter(Boolean).pop() ?? 'attachment';
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

/** Every attachment and inline image on a `layout=long` incident, de-duplicated by path. */
export function collectIncidentAttachments(incident: Record<string, unknown>): IncidentAttachment[] {
  const out: IncidentAttachment[] = [];
  const seen = new Set<string>();
  const add = (item: IncidentAttachment): void => {
    if (seen.has(item.path)) return;
    seen.add(item.path);
    out.push(item);
  };

  const fromRecords = (list: unknown, source: AttachmentSource, commentId?: number): void => {
    if (!Array.isArray(list)) return;
    for (const raw of list) {
      if (!isRecord(raw)) continue;
      const path = toAttachmentPath(raw.url);
      if (!path) continue;
      const id = typeof raw.id === 'number' && Number.isInteger(raw.id) ? String(raw.id) : undefined;
      add({
        ref: id ?? path,
        filename: typeof raw.filename === 'string' && raw.filename ? raw.filename : lastSegment(path),
        ...(typeof raw.content_type === 'string' && raw.content_type ? { content_type: raw.content_type } : {}),
        ...(typeof raw.size === 'number' && Number.isFinite(raw.size) ? { size: raw.size } : {}),
        source,
        ...(commentId !== undefined ? { comment_id: commentId } : {}),
        path,
      });
    }
  };

  const fromHtml = (html: unknown, source: AttachmentSource, commentId?: number): void => {
    if (typeof html !== 'string') return;
    for (const match of html.matchAll(IMG_SRC)) {
      const path = toAttachmentPath(match[1]);
      if (!path) continue;
      add({
        ref: path,
        filename: lastSegment(path),
        source,
        ...(commentId !== undefined ? { comment_id: commentId } : {}),
        path,
      });
    }
  };

  fromRecords(incident.attachments, 'incident');
  fromHtml(incident.description, 'description_inline');
  if (Array.isArray(incident.comments)) {
    for (const c of incident.comments) {
      if (!isRecord(c)) continue;
      const commentId = typeof c.id === 'number' ? c.id : undefined;
      fromRecords(c.attachments, 'comment', commentId);
      fromHtml(c.body, 'comment_inline', commentId);
    }
  }
  return out;
}

const AttachmentOutput = z.object({
  ref: z.string(),
  filename: z.string(),
  content_type: z.string().optional(),
  size: z.number().optional(),
  source: z.enum(['incident', 'comment', 'description_inline', 'comment_inline']),
  comment_id: z.number().optional(),
});

function publicView(a: IncidentAttachment): z.infer<typeof AttachmentOutput> {
  const { path: _path, ...rest } = a;
  return rest;
}

export function registerGetIncidentAttachment(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_get_incident_attachment',
    {
      description:
        'List or fetch an incident\'s attachments, including images pasted into the description or ' +
        'comments. Call with only `id` to list them (ref, filename, type, size, where it came from). ' +
        'Call with `id` and `attachment: <ref>` to return the file: images come back as image content ' +
        'you can look at, other files as an embedded resource. Files over the size limit ' +
        '(SWSD_MAX_ATTACHMENT_BYTES, 5 MB by default) are refused.',
      inputSchema: GetIncidentAttachmentInput,
      outputSchema: z.object({
        incident_id: z.number().int(),
        attachments: z.array(AttachmentOutput).optional(),
        attachment: AttachmentOutput.optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    },
    async (input): Promise<CallToolResult> => {
      try {
        const { id } = await resolveIncidentRef(input.id, ctx.client);
        const { body } = await ctx.client.get<unknown>(`/incidents/${String(id)}.json`, { layout: 'long' });
        if (!isRecord(body)) {
          return toolError(`Could not parse incident ${String(id)} response from SWSD.`);
        }
        const items = collectIncidentAttachments(body);

        if (input.attachment === undefined) {
          const attachments = items.map(publicView);
          const summary = attachments.length === 0
            ? `Incident ${String(id)} has no attachments or inline images.`
            : `Incident ${String(id)} has ${String(attachments.length)} attachment${attachments.length === 1 ? '' : 's'}: ` +
              attachments.map((a) => `${a.filename} (ref ${a.ref})`).join(', ') + '.';
          return structuredResult({ incident_id: id, attachments }, summary);
        }

        const wanted = input.attachment;
        const wantedPath = toAttachmentPath(wanted);
        const match = items.find((a) => a.ref === wanted || (wantedPath !== undefined && a.path === wantedPath));
        if (!match) {
          return toolError(
            `Attachment "${wanted}" is not on incident ${String(id)}.`,
            'Call swsd_get_incident_attachment with only the incident id to list its attachments and their refs.',
          );
        }

        const limit = ctx.env?.SWSD_MAX_ATTACHMENT_BYTES ?? DEFAULT_MAX_ATTACHMENT_BYTES;
        if (match.size !== undefined && match.size > limit) throw new SwsdTooLargeError(limit, match.size);
        const { bytes, contentType } = await ctx.client.download(match.path, limit);

        const mimeType = contentType || match.content_type || 'application/octet-stream';
        const data = Buffer.from(bytes).toString('base64');
        const attachment = { ...publicView(match), content_type: mimeType, size: bytes.byteLength };
        const fileBlock: CallToolResult['content'][number] = mimeType.startsWith('image/')
          ? { type: 'image', data, mimeType }
          : {
              type: 'resource',
              resource: {
                uri: `swsd://incidents/${String(id)}/attachments/${encodeURIComponent(match.ref)}`,
                mimeType,
                blob: data,
              },
            };
        const result = structuredResult(
          { incident_id: id, attachment },
          `${match.filename} (${mimeType}, ${formatBytes(bytes.byteLength)}) from incident ${String(id)}.`,
        );
        return { ...result, content: [...result.content, fileBlock] };
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
