import { createHmac } from 'node:crypto';
import { attachmentPath } from './attachmentDownload.js';
import { InputError } from '../utils/idResolver.js';

export interface IncidentAttachment {
  ref: string;
  filename: string;
  source: 'incident' | 'description_inline' | 'comment' | 'comment_inline';
  comment_id?: number;
  content_type?: string;
  size?: number;
  path: string;
}
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const displayName = (v: string) => [...v].filter(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127).join('').slice(0, 255) || 'attachment';
function decodeAttribute(v: string): string {
  return v.replace(/&(?:amp|quot|apos|lt|gt|#\d{1,7}|#x[\da-f]{1,6});/gi, match => {
    const named: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
    if (named[match.toLowerCase()]) return named[match.toLowerCase()]!;
    const code = match[2]?.toLowerCase() === 'x' ? parseInt(match.slice(3, -1), 16) : Number(match.slice(2, -1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

export function collectIncidentAttachments(incident: Record<string, unknown>, comments: unknown[], incidentId: number, token: string): IncidentAttachment[] {
  const items = new Map<string, IncidentAttachment>();
  function add(raw: unknown, source: IncidentAttachment['source'], comment_id?: number) {
    if (!record(raw)) return;
    const path = attachmentPath(raw.url);
    if (!path || items.has(path)) return;
    let name = path.split('/').at(-1) ?? 'attachment';
    try { name = decodeURIComponent(name); } catch { /* safe fallback */ }
    const ref = createHmac('sha256', token).update(`${incidentId}\n${path}`).digest('hex');
    items.set(path, {
      ref, path, source, filename: displayName(typeof raw.filename === 'string' ? raw.filename : name),
      ...(comment_id === undefined ? {} : { comment_id }),
      ...(typeof raw.size === 'number' && Number.isSafeInteger(raw.size) && raw.size >= 0 ? { size: raw.size } : {}),
      ...(typeof raw.content_type === 'string' && raw.content_type.length < 128 ? { content_type: raw.content_type } : {}),
    });
    if (items.size > 1000) throw new InputError('This incident has more than 1000 attachments. View its files in SWSD.');
  }
  function html(value: unknown, source: IncidentAttachment['source'], commentId?: number) {
    if (typeof value !== 'string') return;
    if (value.length > 2 * 1024 * 1024) throw new InputError('Incident HTML exceeds the attachment scan limit. View its files in SWSD.');
    for (const tag of value.matchAll(/<img\b[^>]{0,8192}>/gi)) {
      const src = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(tag[0]);
      if (src) add({ url: decodeAttribute(src[1] ?? src[2] ?? src[3] ?? '') }, source, commentId);
    }
  }
  if (Array.isArray(incident.attachments)) for (const a of incident.attachments) add(a, 'incident');
  html(incident.description, 'description_inline');
  for (const comment of comments) {
    if (!record(comment)) throw new InputError('Could not read incident comments. Retry the attachment listing.');
    const id = typeof comment.id === 'number' && Number.isSafeInteger(comment.id) ? comment.id : undefined;
    if (Array.isArray(comment.attachments)) for (const a of comment.attachments) add(a, 'comment', id);
    html(comment.body, 'comment_inline', id);
  }
  return [...items.values()];
}

/** Only raster formats whose bytes identify them are returned as MCP image content. */
export function rasterImageType(bytes: Uint8Array): string | undefined {
  const b = Buffer.from(bytes);
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a$/.test(b.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (b.length >= 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return;
}
