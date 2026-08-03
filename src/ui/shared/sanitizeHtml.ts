import DOMPurify from 'dompurify';

/**
 * Sanitize untrusted HTML for rendering inside an MCP App iframe.
 *
 * The output of `sanitizeHtml` is a *trusted* HTML string — DOMPurify guarantees:
 *   - no <script>, <style>, <iframe>, <object>, <embed>, <form>, etc.
 *   - no inline event handlers (`onclick`, `onload`, …)
 *   - no `javascript:`, `data:text/html`, or `vbscript:` URLs
 *   - no `style` attribute (CSS injection vector)
 *
 * That guarantee is what lets the calling widget assign the result to
 * `innerHTML` — anywhere else in this codebase the rule is "no raw HTML
 * strings", but the sanitized output is safe by construction.
 *
 * Allow-list rationale: the SWSD KB articles we render are user-authored
 * but reviewed; common content is paragraphs, headings, lists, code blocks,
 * tables, links, and inline images. The list is intentionally tight — when
 * in doubt we exclude. New tags should be added with a regression test in
 * `tests/unit/ui/sanitizeHtml.test.ts`.
 *
 * Link safety: an `afterSanitizeAttributes` hook forces every <a> to
 * `target="_blank" rel="noopener noreferrer"`. The hook is registered once
 * (idempotent) so repeated calls do not stack handlers.
 *
 * Verified DOMPurify@3.4.13 — `addHook` signatures and
 * `Config` shape come from the bundled `.d.ts`. No `@types/dompurify` is
 * needed; that types package is deprecated for DOMPurify 3.x.
 */

const ALLOWED_TAGS = [
  'p',
  'br',
  'div',
  'span',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'em',
  'b',
  'i',
  'u',
  'code',
  'pre',
  'blockquote',
  'cite',
  'ul',
  'ol',
  'li',
  'a',
  'img',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'hr',
];

const ALLOWED_ATTR = [
  'href',
  'rel',
  'target',
  'title',
  'src',
  'alt',
  'width',
  'height',
  'class',
  'id',
  'colspan',
  'rowspan',
];

const FORBID_TAGS = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'textarea',
  'button',
  'link',
  'meta',
];

const FORBID_ATTR = ['style'];

let configured = false;
function configure(): void {
  if (configured) return;
  configured = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    // Force external-link safety: open in new tab, no opener / no referrer.
    // We check tagName instead of `instanceof HTMLAnchorElement` so this
    // works under jsdom and the iframe DOM both — `instanceof` across
    // realms is unreliable.
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

export function sanitizeHtml(html: string): string {
  configure();
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_TAGS,
    FORBID_ATTR,
    ALLOW_DATA_ATTR: false,
  });
}
