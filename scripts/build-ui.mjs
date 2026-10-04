// Drives a separate Vite build per UI entry.
//
// Code splitting is disabled so each widget can be inlined into its own HTML.
// A separate invocation per entry avoids shared external chunks. The list lives in
// `scripts/ui-tools.mjs` (single source of truth shared with `vite.config.ts`)
// and we loop. Each invocation reads the same `vite.config.ts`; we feed the
// active entry via the UI_ENTRY env var which the config picks up.
//
// Order matters slightly: `emptyOutDir: true` would clear `dist/ui` between
// runs, so we set it for the first entry only.

import { build } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UI_TOOLS } from './ui-tools.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(__dirname, '..');

let first = true;
for (const name of UI_TOOLS) {
  process.env.UI_ENTRY = name;
  await build({
    configFile: resolve(repoRoot, 'vite.config.ts'),
    build: { emptyOutDir: first },
  });
  first = false;
}
