import type { Env } from '../config/env.js';
import { buildHeaders } from './headers.js';
import { InputError } from '../utils/idResolver.js';
import { SwsdHttpError } from './errors.js';

const hasControl = (value: string) => [...value].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

export interface AttachmentDownload { bytes: Uint8Array; contentType: string }

/** Canonical SWSD attachment path only. Discard thumbnail/query flags and never accept a caller host. */
export function attachmentPath(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 4096 || (/[\\\s]/u.test(value) || hasControl(value))) return;
  if (!value.startsWith('/') && !value.startsWith('https://')) return;
  if (value.startsWith('//')) return;
  try {
    // Check before URL normalization so dot segments cannot change the requested resource.
    const rawPath = value.startsWith('https://') ? value.slice(value.indexOf('/', 8)) : value;
    for (const segment of rawPath.split(/[/?#]/)) {
      const decoded = decodeURIComponent(segment);
      if (decoded === '.' || decoded === '..' || (/[%\\/]/u.test(decoded) || hasControl(decoded))) return;
    }
    const url = new URL(value, 'https://api.samanage.com');
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !(url.hostname === 'samanage.com' || url.hostname.endsWith('.samanage.com'))) return;
    if (!/^\/attachments\/[a-zA-Z0-9_-]{1,256}(?:\/[^/]+)?$/.test(url.pathname)) return;
    return url.pathname;
  } catch { return; }
}

export function isAttachmentStorageUrl(url: URL): boolean {
  // Only AWS S3 service endpoints. HTTPS alone would still permit internal-network requests.
  return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
    /^(?:[a-z0-9][a-z0-9.-]*\.)?s3(?:[.-](?:us|eu|ap|sa|ca|me|af|il|mx)-(?:[a-z]+-)?\d)?\.amazonaws\.com$/.test(url.hostname);
}

export async function downloadAttachment(env: Env, token: string, path: string, maxBytes: number): Promise<AttachmentDownload> {
  if (attachmentPath(path) !== path) throw new InputError('Invalid attachment path. List this incident’s attachments again.');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 25 * 1024 * 1024) {
    throw new InputError('Invalid attachment download limit. Set SWSD_MAX_ATTACHMENT_BYTES between 1 and 26214400.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.SWSD_REQUEST_TIMEOUT_MS);
  const tooLarge = () => new InputError(`Attachment exceeds SWSD_MAX_ATTACHMENT_BYTES (${maxBytes} bytes). View it in SWSD or ask the server administrator to adjust the limit.`);
  let response: Response | undefined;
  try {
    const headers = buildHeaders(env, token, { Accept: '*/*' });
    delete headers['Content-Type'];
    response = await fetch(new URL(path, env.SWSD_BASE_URL), {
      headers, redirect: 'manual', credentials: 'omit', signal: controller.signal,
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      let target: URL | undefined;
      try { if (location) target = new URL(location); } catch { /* reject below */ }
      if (!target || !isAttachmentStorageUrl(target)) {
        throw new InputError('Attachment redirect is not an approved HTTPS S3 destination. View the file in SWSD.');
      }
      // Deliberately no SWSD headers, cookies, referrer, or second redirect.
      response = await fetch(target, { redirect: 'manual', credentials: 'omit', signal: controller.signal });
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new SwsdHttpError(response.status, 'Attachment download failed. List the attachments again before retrying.');
    }
    const declared = response.headers.get('content-length');
    if (declared !== null && Number(declared) > maxBytes) {
      await response.body?.cancel();
      throw tooLarge();
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (response.body) {
      const reader = response.body.getReader();
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > maxBytes) { await reader.cancel(); throw tooLarge(); }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
    return { bytes, contentType: /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(type) ? type : 'application/octet-stream' };
  } catch (error) {
    if (error instanceof InputError || error instanceof SwsdHttpError) throw error;
    // Fetch/body exceptions can contain pre-signed URLs. Never expose their text or cause.
    throw new InputError('Attachment download failed or timed out. List the attachments again and retry.');
  } finally { clearTimeout(timer); controller.abort(); }
}
