// Verify deployed legacy clients against both real CLI transports; no SWSD API calls.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { resolve } from 'node:path';
import { PROFILE_TOOLS } from '../dist/config/profiles.js';
import { SERVER_VERSION } from '../dist/mcp/server.js';

const root = resolve(import.meta.dirname, '..');
const versions = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'];
const token = 'protocol-fixture-not-a-real-token';
function start(transport, port) {
  const processHandle = spawn(process.execPath, [resolve(root, 'dist/cli.js'), `--transport=${transport}`], {
    cwd: root,
    env: { ...process.env, SWSD_TOKEN: token, SWSD_BASE_URL: 'https://api.samanage.com',
      SWSD_PROFILE: 'full', SWSD_WRITE_MODE: 'disabled', SWSD_ENABLE_EXTRAS: '',
      SWSD_ALLOWED_ORIGINS: '', ...(port ? { PORT: String(port) } : {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  processHandle.stderr.on('data', data => { stderr += data; });
  return { processHandle, errors: () => stderr };
}
async function stop(server) {
  if (server.processHandle.exitCode === null) {
    const exited = once(server.processHandle, 'exit');
    server.processHandle.kill();
    await exited;
  }
  assert.ok(!server.errors().includes(token), 'Fixture token leaked to stderr');
}
function stdioRequest(server) {
  const pending = new Map();
  let buffer = '';
  server.processHandle.stdout.on('data', data => {
    buffer += data;
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
      if (!line) continue;
      assert.ok(!line.includes(token), 'Fixture token leaked to stdout');
      const message = JSON.parse(line);
      pending.get(message.id)?.(message);
    }
  });
  return message => new Promise((resolveResponse, reject) => {
    const timer = setTimeout(() => { pending.delete(message.id); reject(new Error('STDIO response timed out')); }, 15000);
    pending.set(message.id, response => { clearTimeout(timer); pending.delete(message.id); resolveResponse(response); });
    server.processHandle.stdin.write(JSON.stringify(message) + '\n');
  });
}
function request(id, method, params = {}) { return { jsonrpc: '2.0', id, method, params }; }
async function check(exchange, version) {
  const initialized = await exchange(request(1, 'initialize', {
    protocolVersion: version, capabilities: {}, clientInfo: { name: 'legacy-wire-smoke', version: '1.0.0' },
  }));
  assert.equal(initialized.result?.protocolVersion, version, 'Legacy negotiation changed');
  assert.equal(initialized.result?.serverInfo.version, SERVER_VERSION);
  const listing = await exchange(request(2, 'tools/list'));
  assert.deepEqual(listing.result.tools.map(tool => tool.name).sort(), [...PROFILE_TOOLS.full].sort());
  for (const tool of listing.result.tools) {
    assert.equal(tool.inputSchema.type, 'object');
    for (const hint of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
      assert.equal(typeof tool.annotations[hint], 'boolean');
    }
  }
  const info = await exchange(request(3, 'tools/call', { name: 'swsd_get_server_info', arguments: {} }));
  assert.ok(!info.result?.isError);
  assert.equal(info.result?.structuredContent.version, SERVER_VERSION);
  const resources = await exchange(request(4, 'resources/list'));
  assert.equal(resources.result.resources.length, 7);
  assert.ok(resources.result.resources.every(resource => resource.mimeType === 'text/html;profile=mcp-app'));
  const unknown = await exchange(request(5, 'tools/call', { name: '__swsd_unknown_tool__', arguments: {} }));
  assert.equal(unknown.error?.code, -32602, 'Unknown tools must use the SDK v2 protocol error');
  const invalid = await exchange(request(6, 'tools/call', { name: 'swsd_get_incident', arguments: { id: -1 } }));
  assert.equal(invalid.result?.isError, true, 'Known-tool argument errors must remain tool results');
}

for (const version of versions) {
  const server = start('stdio');
  try {
    const exchange = stdioRequest(server);
    await check(async message => {
      const response = await exchange(message);
      if (message.method === 'initialize') server.processHandle.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      return response;
    }, version);
    console.log(`PASS STDIO ${version}: negotiation, 66 tools, annotations, metadata call, 7 widgets`);
  } finally { await stop(server); }
}

const probe = net.createServer();
probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = probe.address().port;
await new Promise((resolveClose, reject) => probe.close(error => error ? reject(error) : resolveClose()));
const server = start('http', port);
const url = `http://127.0.0.1:${port}`;
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.processHandle.exitCode !== null) throw new Error('HTTP server stopped before readiness');
    try { ready = (await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* Wait for startup. */ }
    if (ready) break;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
  }
  assert.ok(ready, 'HTTP server did not become ready');
  for (const version of versions) {
    await check(async message => {
      const response = await fetch(`${url}/mcp`, {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
          authorization: `Bearer ${token}`, 'mcp-protocol-version': version },
        body: JSON.stringify(message), signal: AbortSignal.timeout(15000),
      });
      assert.equal(response.status, 200);
      const body = await response.text();
      assert.ok(!body.includes(token), 'Fixture token leaked to HTTP response');
      return response.headers.get('content-type').includes('text/event-stream')
        ? JSON.parse(body.split('\n').find(line => line.startsWith('data:')).slice(5).trim()) : JSON.parse(body);
    }, version);
    console.log(`PASS HTTP ${version}: negotiation, 66 tools, annotations, metadata call, 7 widgets`);
  }
} finally { await stop(server); }
console.log('8 legacy transport checks passed; fixture credential only, write mode disabled.');
