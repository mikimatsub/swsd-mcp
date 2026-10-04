import { defineConfig, type Plugin } from 'vite';
import { inlineUiAssets } from './scripts/inline-ui-assets.mjs';
import { resolve } from 'node:path';
import { UI_TOOLS } from './scripts/ui-tools.mjs';

/**
 * Each widget is built separately with code splitting disabled, then its
 * JavaScript and CSS are inlined by our dependency-free build plugin.
 * `scripts/build-ui.mjs` drives one build per UI_TOOLS entry and supplies
 * the entry name through UI_ENTRY.
 *
 * If `UI_ENTRY` isn't set (e.g. someone runs `vite build` by hand) we fall
 * back to all entries. Shared external chunks fail the inliner's integrity
 * check; use `npm run build:ui` for the supported build.
 */

/**
 * Flattens Vite's default multi-page HTML output (`<input-relative-path>/index.html`)
 * to `<entry-name>.html` at the outDir root. This keeps `dist/ui/<name>.html`
 * predictable for `loadUiResource(name)` after the inliner consumes the
 * JavaScript and CSS assets.
 */
function flattenHtmlOutput(): Plugin {
  return {
    name: 'flatten-html-output',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const [oldKey, asset] of Object.entries(bundle)) {
        if (asset.type !== 'asset' || !oldKey.endsWith('/index.html')) continue;
        // Match `<...>/<name>/index.html` and flatten to `<name>.html` at root.
        const match = oldKey.match(/(?:^|\/)([^/]+)\/index\.html$/);
        if (!match) continue;
        const entryName = match[1];
        asset.fileName = `${entryName}.html`;
      }
    },
  };
}

const activeEntry = process.env.UI_ENTRY;
const entries = activeEntry ? [activeEntry] : UI_TOOLS;

export default defineConfig({
  base: './',
  plugins: [inlineUiAssets(), flattenHtmlOutput()],
  build: {
    assetsInlineLimit: () => true,
    assetsDir: '',
    cssCodeSplit: false,
    modulePreload: false,
    outDir: resolve(import.meta.dirname, 'dist', 'ui'),
    // emptyOutDir is overridden per-invocation by scripts/build-ui.mjs so the
    // first entry clears the dir and subsequent entries append.
    emptyOutDir: true,
    rollupOptions: {
      output: { codeSplitting: false },
      input: Object.fromEntries(
        entries.map((name) => [name, resolve(import.meta.dirname, 'src', 'ui', name, 'index.html')]),
      ),
    },
  },
});
