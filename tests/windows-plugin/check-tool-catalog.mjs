// Diff the shipped humanized capture against the actual registered server metadata.
// Registration only: no handler, HTTP request, credential, process, or clipboard use.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const runtime = resolve(process.argv[2] ?? 'plugins/swsd/runtime/node_modules/swsd-mcp/dist');
const load = file => import(pathToFileURL(join(runtime, file)).href);
const [{ createMcpServer }, { registerTools }, { PROFILE_TOOLS }, { parseEnv }] = await Promise.all([
  load('mcp/server.js'), load('config/toolRegistry.js'), load('config/profiles.js'), load('config/env.js'),
]);
const catalog = JSON.parse(await readFile(new URL('../../plugins/swsd/assets/tool-catalog.json', import.meta.url), 'utf8'));
const bannedShort = /authenticated user|numeric ID|structured filters|pagination|\[from, to\)|scanned tickets created OR|DESTRUCTIVE\s*—/i;
const token = randomBytes(32).toString('hex');
const completeProfile = Object.hasOwn(PROFILE_TOOLS, 'full') ? 'full' : 'operations';
const env = parseEnv({ SWSD_TOKEN: token, SWSD_ENABLE_EXTRAS: '', SWSD_PROFILE: completeProfile });
const server = createMcpServer();
const client = new Proxy({}, { get() { throw new Error('Catalog verification must never call an HTTP client'); } });
try {
  registerTools(server, { env, client, token, profile: env.SWSD_PROFILE, enabledTools: [] });
  // Same inspected SDK registry used by tests/unit/toolAnnotations.test.ts.
  const registered = server._registeredTools;
  assert.equal(new Set(catalog.map(t => t.name)).size, catalog.length, 'Duplicate catalog IDs');
  assert.deepEqual(catalog.map(t => t.name).sort(), Object.keys(registered).sort(), 'Catalog tool IDs drifted');
  for (const tool of catalog) {
    const actual = registered[tool.name];
    assert.equal(tool.description, actual.description, `${tool.name}: description drift`);
    assert.deepEqual(tool.annotations, actual.annotations, `${tool.name}: annotation drift`);
    // The pinned published runtime may still expose full separately. Its union
    // becomes operations in the current catalog, matching the server alias.
    const profiles = [...new Set(Object.entries(PROFILE_TOOLS).filter(([, names]) => names.includes(tool.name))
      .map(([profile]) => profile === 'full' ? 'operations' : profile))];
    assert.deepEqual([...tool.profiles].sort(), profiles.sort(), `${tool.name}: profile drift`);
    assert.ok(tool.profiles.includes('operations') && !tool.profiles.includes('full'), `${tool.name}: noncanonical complete profile`);
    assert.ok(tool.friendly && tool.area && tool.short && tool.example, `${tool.name}: missing humanized metadata`);
    assert.doesNotMatch(tool.short, bannedShort, `${tool.name}: developer wording in short description`);
    const kind = actual.annotations.readOnlyHint ? 'read' : actual.annotations.destructiveHint && /^swsd_(delete_|remove_group_member$)/.test(tool.name) ? 'delete' : 'edit';
    assert.equal(tool.kind, kind, `${tool.name}: incorrect operation badge`);
  }
  console.log(`PASS: ${catalog.length} catalog tools match actual server IDs, descriptions, annotations, profile membership and R/E/D badges.`);
} finally { await server.close(); }
