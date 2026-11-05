// Real STDIO custom-profile resolution; synthetic credential, no SWSD requests.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const root = resolve(import.meta.dirname, '..');
const temporary = await mkdtemp(join(tmpdir(), 'swsd-profile-smoke-'));
const profile = join(temporary, 'custom profile.json');
try {
  await writeFile(profile, JSON.stringify({ name:'Release smoke', version:1, tools:['swsd_get_me'] }));
  for (const [label, file, tools, expected] of [
    ['file', profile, '', ['swsd_get_me']],
    ['SWSD_TOOLS', '', 'swsd_health_check', ['swsd_health_check']],
    ['file + SWSD_TOOLS', profile, ' swsd_health_check, swsd_get_me ', ['swsd_get_me','swsd_health_check']],
  ]) {
    const transport = new StdioClientTransport({ command:process.execPath,
      args:[join(root, 'dist/cli.js'), '--transport=stdio'], cwd:root, stderr:'pipe',
      env:{ ...process.env, SWSD_TOKEN:'profile-smoke-synthetic', SWSD_BASE_URL:'https://api.samanage.com',
        SWSD_PROFILE:'custom', SWSD_PROFILE_FILE:file, SWSD_TOOLS:tools, SWSD_ENABLE_EXTRAS:'', SWSD_WRITE_MODE:'disabled' } });
    const client = new Client({name:'profile-release-smoke',version:'1.0.0'});
    let errors = '';
    transport.stderr.on('data', chunk => { errors += chunk; });
    try {
      await client.connect(transport);
      const result = await client.listTools();
      assert.deepEqual(result.tools.map(tool => tool.name).sort(), expected.sort());
      assert.ok(!JSON.stringify(result).includes('profile-smoke-synthetic'));
      assert.ok(!errors.includes('profile-smoke-synthetic'));
      console.log(`PASS: custom ${label} exposes exactly ${expected.length} selected tools over STDIO.`);
    } finally { await client.close(); }
  }
} finally {
  assert.ok(resolve(temporary).startsWith(resolve(tmpdir())) && temporary.includes('swsd-profile-smoke-'));
  await rm(temporary, {recursive:true,force:true});
}
