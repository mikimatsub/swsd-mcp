// Exercise the exact checkout as an npm-packed server before it is published.
// Only the test lock's archive location/integrity change; restore its bytes even
// on failure. Installed/retained recipes therefore test the real npm ci path.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '../..');
const temporary = mkdtempSync(join(tmpdir(), 'swsd-candidate-'));
const lockPath = join(root, 'plugins/swsd/runtime/package-lock.json');
const original = readFileSync(lockPath);
const runtime = join(root, 'plugins/swsd/runtime');
const npmCli = process.env.npm_execpath ?? join(process.execPath, '../node_modules/npm/bin/npm-cli.js');
const run = (command, args, capture = false, cwd = root) => {
  const env = { ...process.env, SWSD_TOKEN: '', SWSD_PROFILE_FILE: '', SWSD_TOOLS: '' };
  // Windows PowerShell must discover its own modules, not inherit PS7's paths.
  delete env.PSModulePath;
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    env });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed`);
  return result.stdout;
};
const npm = (args, capture = false, cwd = root) => run(process.execPath, [npmCli, ...args], capture, cwd);
const ps = (file, ...args) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-WindowStyle', 'Hidden', '-File', file, ...args]);
try {
  assert.equal(process.platform, 'win32', 'Windows plugin checks require Windows');
  const [packed] = JSON.parse(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], true));
  const lock = JSON.parse(original.toString('utf8'));
  assert.equal(packed.version, lock.packages['node_modules/swsd-mcp'].version);
  assert.match(packed.integrity, /^sha512-/);
  Object.assign(lock.packages['node_modules/swsd-mcp'], {
    resolved: pathToFileURL(join(temporary, packed.filename)).href, integrity: packed.integrity,
  });
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  npm(['ci', '--ignore-scripts', '--strict-peer-deps', '--no-fund'], false, runtime);
  npm(['audit', '--audit-level=low'], false, runtime);
  run(process.execPath, ['tests/windows-plugin/check-tool-catalog.mjs', join(runtime, 'node_modules/swsd-mcp/dist')]);
  for (const file of ['check-install', 'check-profiles', 'check-launcher', 'check-ui-handlers', 'check-update', 'check-diagnostics', 'check-dpi']) {
    ps(`tests/windows-plugin/${file}.ps1`);
  }
  ps('plugins/swsd/scripts/Manage-Swsd.ps1', '-ValidateUi');
  run(process.execPath, ['tests/windows-plugin/check-stdio.mjs', join(runtime, 'node_modules/swsd-mcp/dist')]);
  run(process.execPath, ['scripts/smoke-profiles.mjs']);
  console.log(`PASS: packed swsd-mcp ${packed.version}; all isolated Windows checks passed.`);
} finally {
  writeFileSync(lockPath, original);
  assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + '\\') && temporary.includes('swsd-candidate-'));
  rmSync(temporary, { recursive: true, force: true });
}
