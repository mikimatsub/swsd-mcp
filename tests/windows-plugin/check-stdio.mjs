// Real STDIO startup with a temporary Windows credential. No SolarWinds API calls.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const root = fileURLToPath(new URL('../../plugins/swsd/', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'swsd-stdio-'));
const target = `GAIConsultants/SWSD-MCP-test-${randomUUID()}`;
const fakeToken = 'test-only-not-a-real-token';
const runtime = join(process.env.LOCALAPPDATA, 'GAIConsultants/SWSD-MCP/runtime/2.3.1/node_modules/swsd-mcp/dist');
const { PROFILE_TOOLS } = await import(pathToFileURL(join(runtime, 'config/profiles.js')).href);
const quotePs = s => s.replaceAll("'", "''");
const ps = (file) => new Promise((resolvePromise, reject) => {
  const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', file]);
  let output = '';
  p.stdout.on('data', d => { output += d; });
  p.stderr.on('data', d => { output += d; });
  p.on('error', reject);
  p.on('exit', code => code === 0 ? resolvePromise(output) : reject(new Error(output)));
});
let server;
const stopServer = async () => {
  if (!server) return;
  await new Promise(resolveDone => {
    const killer = spawn('taskkill.exe', ['/PID', String(server.pid), '/T', '/F'], {stdio:'ignore'});
    killer.on('exit', resolveDone); killer.on('error', resolveDone);
  });
  server = undefined;
};
try {
  const common = (await readFile(join(root, 'scripts/Common.ps1'), 'utf8'))
    .replace("$script:SwsdCredentialTarget = 'GAIConsultants/SWSD-MCP'", `$script:SwsdCredentialTarget = '${target}'`)
    .replace("$script:SwsdHome = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'GAIConsultants\\SWSD-MCP'", `$script:SwsdHome = '${quotePs(temporary)}'`)
    .replace('return Join-Path $script:SwsdHome "runtime\\$script:SwsdPackageVersion\\node_modules\\swsd-mcp\\dist\\cli.js"', `return '${quotePs(join(runtime, 'cli.js'))}'`);
  await writeFile(join(temporary, 'Common.ps1'), common);
  await writeFile(join(temporary, 'Start-Swsd.ps1'), await readFile(join(root, 'scripts/Start-Swsd.ps1')));
  await writeFile(join(temporary, 'prepare.ps1'), `. (Join-Path $PSScriptRoot 'Common.ps1')\n[SwsdDesktop.Credentials]::Save('${target}', '${fakeToken}')`);
  await writeFile(join(temporary, 'cleanup.ps1'), `. (Join-Path $PSScriptRoot 'Common.ps1')\n[SwsdDesktop.Credentials]::Remove('${target}')`);
  await ps(join(temporary, 'prepare.ps1'));
  for (const profile of ['triage','agent','knowledge','operations','full']) {
  // Save through the same function as the dropdown, then launch a separate server process.
  await writeFile(join(temporary, 'profile.ps1'), `. (Join-Path $PSScriptRoot 'Common.ps1')\nSave-SwsdProfile -Profile '${profile}'`);
  await ps(join(temporary, 'profile.ps1'));
  server = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', join(temporary, 'Start-Swsd.ps1')]);
  let text = '';
  let errors = '';
  const messages = new Map();
  const pending = new Map();
  server.stderr.on('data', d => { errors += d; });
  server.stdout.on('data', d => {
    text += d;
    let newline;
    while ((newline = text.indexOf('\n')) >= 0) {
      const line = text.slice(0, newline).trim(); text = text.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { throw new Error('Non-JSON data on MCP stdout'); }
      if ('id' in message) { messages.set(message.id, message); pending.get(message.id)?.(message); }
    }
  });
  const request = async (id, method, params) => {
    const result = new Promise((resolveRequest, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${method}; stderr length ${errors.length}`)), 30000);
      pending.set(id, m => { clearTimeout(timeout); resolveRequest(m); });
    });
    server.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
    return result;
  };
  const initialized = await request(1, 'initialize', {protocolVersion:'2025-03-26', capabilities:{}, clientInfo:{name:'swsd-plugin-check',version:'1.0'}});
  assert.ok(initialized.result?.serverInfo);
  server.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  const listing = await request(2, 'tools/list', {});
  assert.ok(listing.result.tools.some(t => t.name === 'swsd_health_check'));
  assert.ok(listing.result.tools.some(t => t.name === 'swsd_get_me'));
  assert.deepEqual(listing.result.tools.map(t => t.name).sort(), [...PROFILE_TOOLS[profile]].sort());
  assert.ok(!JSON.stringify([...messages.values()]).includes(fakeToken));
  assert.ok(!errors.includes(fakeToken));
  console.log(`PASS: saved ${profile} profile starts with exactly ${listing.result.tools.length} expected tools; no credential in protocol output.`);
  await stopServer();
  }
} finally {
  await stopServer();
  await ps(join(temporary, 'cleanup.ps1'));
  assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + '\\'), 'Cleanup must stay within the temporary directory');
  assert.ok(temporary.includes('swsd-stdio-'), 'Cleanup must target this test folder');
  await rm(temporary, {recursive:true,force:true});
}
