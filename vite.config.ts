import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { resolve } from 'node:path';
import { UI_TOOLS } from './scripts/ui-tools.mjs';

/**
 * `vite-plugin-singlefile` enables `output.inlineDynamicImports: true` on
 * Vite ≤ 7. Rollup rejects that flag whenever the build has more than one
 * input, so each UI must be its own Vite invocation. `scripts/build-ui.mjs`
 * loops over `UI_TOOLS` and drives one build per entry, passing the entry
 * name via the `UI_ENTRY` env var which this config reads here.
 *
 * If `UI_ENTRY` isn't set (e.g. someone runs `vite build` by hand) we fall
 * back to all entries — the build will fail loudly with the
 * `inlineDynamicImports` error, which is the correct signal: drive via
 * `npm run build:ui`, not raw vite.
 */

/**
 * Flattens Vite's default multi-page HTML output (`<input-relative-path>/index.html`)
 * to `<entry-name>.html` at the outDir root. This keeps `dist/ui/<name>.html`
 * predictable for `loadUiResource(name)` while letting Rollup name JS chunks
 * however it wants — the singlefile plugin's classifier picks the right HTML
 * asset because the entry-name chunk is no longer in the bundle.
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
  plugins: [viteSingleFile(), flattenHtmlOutput()],
  build: {
    outDir: resolve(__dirname, 'dist', 'ui'),
    // emptyOutDir is overridden per-invocation by scripts/build-ui.mjs so the
    // first entry clears the dir and subsequent entries append.
    emptyOutDir: true,
    rollupOptions: {
      input: Object.fromEntries(
        entries.map((name) => [name, resolve(__dirname, 'src', 'ui', name, 'index.html')]),
      ),
    },
  },
});
