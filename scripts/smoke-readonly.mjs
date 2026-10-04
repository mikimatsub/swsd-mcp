// Run against an existing personal token. Output contains counts and labels only.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { PROFILE_TOOLS } from '../dist/config/profiles.js';
import { SERVER_VERSION } from '../dist/mcp/server.js';

assert.ok(process.env.SWSD_TOKEN, 'SWSD_TOKEN must already be configured');
const repoRoot = resolve(import.meta.dirname, '..');
let passed = 0;
for (const profile of ['triage', 'agent', 'knowledge', 'operations', 'full']) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(repoRoot, 'dist/cli.js'), '--transport=stdio'],
    cwd: repoRoot,
    stderr: 'pipe',
    env: { ...process.env, SWSD_PROFILE: profile, SWSD_WRITE_MODE: 'disabled', SWSD_ENABLE_EXTRAS: '' },
  });
  transport.stderr?.on('data', () => {});
  const client = new Client({ name: 'swsd-readonly-release-smoke', version: '1.0.0' });
  let currentCheck = `${profile} handshake`;
  try {
    await client.connect(transport);
    assert.ok(client.getServerVersion()?.version === SERVER_VERSION, 'Runtime version mismatch');
    const { tools } = await client.listTools();
    assert.ok(tools.length === PROFILE_TOOLS[profile].length, 'Profile tool count mismatch');
    assert.ok(PROFILE_TOOLS[profile].every((name) => tools.some((tool) => tool.name === name)), 'Profile tool missing');
    passed++;
    console.log(`PASS ${profile} handshake (${tools.length} tools)`);
    if (profile !== 'full') continue;
    async function call(name, args = {}) {
      currentCheck = name;
      const tool = tools.find((item) => item.name === name);
      assert.ok(tool?.annotations?.readOnlyHint === true, 'Smoke checks require a read-only tool');
      const result = await client.callTool({ name, arguments: args });
      assert.ok(!result.isError && result.structuredContent, 'Tool did not return structured success');
      passed++;
      console.log(`PASS ${name}`);
      return result.structuredContent;
    }
    const info = await call('swsd_get_server_info');
    assert.ok(info.version === SERVER_VERSION, 'Server metadata mismatch');
    const health = await call('swsd_health_check');
    assert.ok(health.ok === true, 'SWSD is unhealthy');
    const me = await call('swsd_get_me');
    assert.ok(Number.isInteger(me.user?.id), 'User record missing');
    const incidents = await call('swsd_list_incidents', { per_page: 1 });
    assert.ok(Array.isArray(incidents.incidents) && incidents.incidents.length > 0, 'No incident available for smoke checks');
    const id = incidents.incidents[0].id;
    const detail = await call('swsd_get_incident', { id, detail_level: 'long' });
    assert.ok(detail.incident?.id === id, 'Incident detail mismatch');
    await call('swsd_list_incident_comments', { incident_id: id, per_page: 1 });
    await call('swsd_list_my_incidents', { per_page: 1 });
    await call('swsd_list_categories', { per_page: 1 });
    await call('swsd_search_solutions', { per_page: 1 });
    const resources = await client.listResources();
    const ui = resources.resources.filter((item) => item.uri.startsWith('ui://swsd/'));
    assert.ok(ui.length === 7, 'Expected seven widget resources');
    for (const resource of ui) {
      currentCheck = 'widget resource';
      const result = await client.readResource({ uri: resource.uri });
      assert.ok(result.contents.every((item) => typeof item.text === 'string' && item.text.length > 1000 && !/<script\b[^>]*\bsrc=/i.test(item.text) && !/<link\b[^>]*\bhref=["'][^"']+\.css/i.test(item.text)), 'Widget is not self-contained');
    }
    passed++;
    console.log('PASS seven self-contained widget resources');
  } catch {
    // Never emit upstream payloads, JWT claims, ticket contents, or token values.
    console.error(`FAIL ${currentCheck}`);
    process.exitCode = 1;
    break;
  } finally {
    await client.close();
  }
}
console.log(`${passed} read-only smoke checks passed; write mode disabled.`);
