import { el } from './dom.js';

/** Restore the original subtree, including cached nodes and event listeners. */
export function clearError(rootEl: HTMLElement): void {
  const content = rootEl.querySelector(':scope > .error-content');
  if (content) content.replaceWith(...content.childNodes);
  rootEl.querySelector(':scope > .error-state')?.remove();
}

/**
 * Renders a clean error state into a widget root.
 *
 * Wired up by every widget's `mountApp({ onError })` so a tool returning
 * `isError: true` no longer leaves the iframe stuck on its loading spinner
 * forever. The DOM is built via the safe-DOM helper (`el`) — the
 * codebase's "no raw HTML strings" rule applies here as everywhere else, so
 * `message` (a host-supplied string) lands in `textContent` and an attacker
 * who could control the tool's error text still cannot inject markup.
 *
 * The `role="alert"` on the container ensures screen readers announce the
 * change immediately; without it the swap from "Loading…" to error text is
 * silent for assistive tech.
 *
 * Visual design intentionally minimal: red border + tinted background so
 * the user immediately distinguishes it from a normal empty state, plus a
 * one-line hint suggesting the next action ("Try the operation again").
 */
export function renderError(rootEl: HTMLElement, message: string): void {
  clearError(rootEl);
  // Hide, but keep, the main subtree. Widgets with cached targets call
  // clearError before rendering again; widgets that rebuild clear the root.
  const content = el('div', { class: 'error-content', hidden: true });
  content.append(...rootEl.childNodes);
  rootEl.appendChild(content);
  rootEl.appendChild(
    el('div', { class: 'error-state', role: 'alert' }, [
      el('h2', undefined, ['Unable to load']),
      el('p', { class: 'error-message' }, [message]),
      el('p', { class: 'error-hint' }, [
        'Try the operation again, or check the host logs for details.',
      ]),
    ]),
  );
}
