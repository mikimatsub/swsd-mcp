import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { EnvSchema, KNOWN_PROFILES } from '../../src/config/env.js';
import { CustomProfileSchema, MAX_PROFILE_BYTES, MAX_PROFILE_TOOLS, resolveProfileTools } from '../../src/config/customProfile.js';
import { PROFILE_TOOLS } from '../../src/config/profiles.js';
import { registerTools } from '../../src/config/toolRegistry.js';
import { PROMPTS } from '../../src/mcp/prompts.js';
import { makeFakeClient } from './tools/_helpers/mockClient.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'swsd-profile-')); });
afterEach(() => { vi.restoreAllMocks(); rmSync(dir, { recursive: true, force: true }); });

const fileProfile = { name: 'Synthetic desk', version: 1, description: 'Synthetic tools only', tools: ['swsd_get_incident'] };
function file(value: unknown = fileProfile): string {
  const path = join(dir, 'profile.json');
  writeFileSync(path, JSON.stringify(value));
  return path;
}
const custom = (vars: Record<string, string> = {}) => EnvSchema.parse({ SWSD_PROFILE: 'custom', ...vars });

describe('custom profile inputs', () => {
  it('publishes the same file validation rules used at runtime', () => {
    const schema = JSON.parse(readFileSync('schemas/swsd-profile.schema.json', 'utf8'));
    expect(schema).toEqual(CustomProfileSchema.toJSONSchema());
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.tools.maxItems).toBe(MAX_PROFILE_TOOLS);
  });

  it('trims CSV whitespace, ignores empty CSV entries, and deduplicates', () => {
    const env = custom({ SWSD_TOOLS: ' swsd_get_me, , swsd_get_incident,swsd_get_me,\t' });
    expect(resolveProfileTools(env)).toEqual(['swsd_get_me', 'swsd_get_incident']);
  });

  it('supports file-only and a deduplicated union with CSV', () => {
    const path = file();
    expect(resolveProfileTools(custom({ SWSD_PROFILE_FILE: path }))).toEqual(['swsd_get_incident']);
    expect(resolveProfileTools(custom({ SWSD_PROFILE_FILE: path, SWSD_TOOLS: 'swsd_get_me,swsd_get_incident' })))
      .toEqual(['swsd_get_me', 'swsd_get_incident']);
  });

  it('resolves cwd-relative paths including spaces and parent components', () => {
    const path = file();
    expect(resolveProfileTools(custom({ SWSD_PROFILE_FILE: relative(process.cwd(), path) }))).toEqual(['swsd_get_incident']);
    mkdirSync(join(dir, 'with spaces'));
    const spaced = join(dir, 'with spaces', 'desk.json');
    writeFileSync(spaced, JSON.stringify(fileProfile));
    expect(resolveProfileTools(custom({ SWSD_PROFILE_FILE: spaced }))).toEqual(['swsd_get_incident']);
  });

  it('warns on stderr with all unknown names from both sources and skips them', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const path = file({ ...fileProfile, tools: ['swsd_typo_file', 'swsd_get_incident'] });
    const env = custom({ SWSD_PROFILE_FILE: path, SWSD_TOOLS: 'swsd_typo_csv,swsd_get_me,swsd_typo_csv,toString' });
    expect(resolveProfileTools(env)).toEqual(['swsd_get_me', 'swsd_get_incident']);
    expect(stderr).toHaveBeenCalledExactlyOnceWith('Unknown custom profile tools (skipped): "swsd_typo_csv", "toString", "swsd_typo_file"\n');
    resolveProfileTools(env);
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(stdout).not.toHaveBeenCalled();
  });

  it.each([{}, { SWSD_TOOLS: ' , ' }, { SWSD_TOOLS: 'swsd_unknown' }])('fails clearly for an empty valid selection: %j', vars => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    expect(() => resolveProfileTools(custom(vars))).toThrow('Custom profile has no valid tools');
  });

  it('allows an empty file array if CSV supplies valid tools', () => {
    const path = file({ ...fileProfile, tools: [] });
    expect(() => resolveProfileTools(custom({ SWSD_PROFILE_FILE: path }))).toThrow('no valid tools');
    expect(resolveProfileTools(custom({ SWSD_PROFILE_FILE: path, SWSD_TOOLS: 'swsd_get_me' }))).toEqual(['swsd_get_me']);
  });

  it('accepts optional description and all bounded fields at their limits', () => {
    expect(CustomProfileSchema.safeParse({ name: 'a'.repeat(80), version: 1, description: 'x'.repeat(2_048), tools: ['x'.repeat(128)] }).success).toBe(true);
    expect(custom({ SWSD_PROFILE_FILE: '   ' }).SWSD_PROFILE_FILE).toBeUndefined();
    expect(EnvSchema.safeParse({ SWSD_PROFILE_FILE: 'a'.repeat(4_097) }).success).toBe(false);
    expect(resolveProfileTools(custom({ SWSD_PROFILE_FILE: file({ name: 'Synthetic desk', version: 1, tools: ['swsd_get_me'] }) }))).toEqual(['swsd_get_me']);
  });

  it.each([
    null, [], {}, { ...fileProfile, name: '' }, { ...fileProfile, name: 'a'.repeat(81) },
    { ...fileProfile, name: '../unsafe' }, { ...fileProfile, version: 2 }, { ...fileProfile, version: '1' },
    { ...fileProfile, description: 'x'.repeat(2_049) }, { ...fileProfile, tools: 'swsd_get_me' },
    { ...fileProfile, tools: [1] }, { ...fileProfile, tools: [''] }, { ...fileProfile, tools: ['x'.repeat(129)] },
    { ...fileProfile, unexpected: true }, { ...fileProfile, tools: Array(MAX_PROFILE_TOOLS + 1).fill('swsd_get_me') },
  ].map(value => ({ value })))('rejects invalid JSON profile structure %#', ({ value }) => {
    expect(() => resolveProfileTools(custom({ SWSD_PROFILE_FILE: file(value) }))).toThrow('Invalid SWSD_PROFILE_FILE');
  });

  it('bounds CSV size and the combined number of entries before deduplication', () => {
    expect(EnvSchema.safeParse({ SWSD_TOOLS: 'x'.repeat(65_537) }).success).toBe(false);
    const names = Array(MAX_PROFILE_TOOLS).fill('swsd_get_me').join(',');
    expect(resolveProfileTools(custom({ SWSD_TOOLS: names }))).toEqual(['swsd_get_me']);
    expect(() => resolveProfileTools(custom({ SWSD_TOOLS: `${names},swsd_get_me` }))).toThrow('exceeds 512');
    expect(() => resolveProfileTools(custom({ SWSD_TOOLS: names, SWSD_PROFILE_FILE: file() }))).toThrow('exceeds 512');
  });

  it('rejects missing files, directories, malformed JSON, and executable source', () => {
    expect(() => resolveProfileTools(custom({ SWSD_PROFILE_FILE: join(dir, 'missing.json') }))).toThrow('Invalid SWSD_PROFILE_FILE');
    expect(() => resolveProfileTools(custom({ SWSD_PROFILE_FILE: dir }))).toThrow('Invalid SWSD_PROFILE_FILE');
    const path = file();
    writeFileSync(path, '{"name":');
    expect(() => resolveProfileTools(custom({ SWSD_PROFILE_FILE: path }))).toThrow('Invalid SWSD_PROFILE_FILE');
    writeFileSync(path, 'throw new Error("must never execute")');
    expect(() => resolveProfileTools(custom({ SWSD_PROFILE_FILE: path }))).toThrow('Invalid SWSD_PROFILE_FILE');
  });

  it('accepts exactly 256 KiB and rejects even one additional byte', () => {
    const path = file();
    const json = JSON.stringify(fileProfile);
    writeFileSync(path, json + ' '.repeat(MAX_PROFILE_BYTES - Buffer.byteLength(json)));
    expect(resolveProfileTools(custom({ SWSD_PROFILE_FILE: path }))).toEqual(['swsd_get_incident']);
    writeFileSync(path, json + ' '.repeat(MAX_PROFILE_BYTES + 1 - Buffer.byteLength(json)));
    expect(() => resolveProfileTools(custom({ SWSD_PROFILE_FILE: path }))).toThrow('exceeds 262144 bytes');
  });

  it('takes an immutable startup snapshot and ignores later file changes', () => {
    const path = file();
    const env = custom({ SWSD_PROFILE_FILE: path });
    const first = resolveProfileTools(env);
    writeFileSync(path, '{}');
    expect(resolveProfileTools(env)).toBe(first);
    expect(first).toEqual(['swsd_get_incident']);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('does not read custom settings for built-in profiles', () => {
    const env = EnvSchema.parse({ SWSD_PROFILE: 'agent', SWSD_PROFILE_FILE: join(dir, 'missing.json'), SWSD_TOOLS: 'swsd_typo' });
    expect(resolveProfileTools(env)).toEqual(PROFILE_TOOLS.agent);
    expect(KNOWN_PROFILES).toEqual(['triage', 'agent', 'knowledge', 'operations', 'custom']);
  });
});

async function connect(tools: string, extras = '', vars: Record<string, string> = {}) {
  const env = custom({ SWSD_TOOLS: tools, SWSD_ENABLE_EXTRAS: extras, ...vars });
  const server = new McpServer({ name: 'synthetic-profile', version: '0.0.0' });
  const fake = makeFakeClient();
  const enabledTools: string[] = [];
  registerTools(server, { env, profile: env.SWSD_PROFILE, client: fake, enabledTools, token: 'SYNTHETIC_TOKEN' });
  const client = new Client({ name: 'synthetic-client', version: '0.0.0' });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(s), client.connect(c)]);
  return { client, fake, enabledTools, close: async () => { await client.close(); await server.close(); } };
}

describe('custom tool registration over MCP', () => {
  it('only lists selected tools and reports the custom profile with actual counts', async () => {
    const session = await connect('swsd_get_server_info,swsd_get_me');
    try {
      expect((await session.client.listTools()).tools.map(t => t.name).sort()).toEqual(['swsd_get_me', 'swsd_get_server_info']);
      const info = await session.client.callTool({ name: 'swsd_get_server_info', arguments: {} });
      expect(info.structuredContent).toMatchObject({ profile: 'custom', tools: ['swsd_get_me', 'swsd_get_server_info'] });
      expect(session.fake.calls).toEqual([]);
    } finally { await session.close(); }
  });

  it('keeps operations complete and the full alias compatible, with one stderr notice', async () => {
    vi.resetModules();
    const { EnvSchema: fresh } = await import('../../src/config/env.js');
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    expect(fresh.parse({ SWSD_PROFILE: 'full' }).SWSD_PROFILE).toBe('operations');
    expect(fresh.parse({ SWSD_PROFILE: 'full' }).SWSD_PROFILE).toBe('operations');
    expect(stderr).toHaveBeenCalledExactlyOnceWith('SWSD_PROFILE=full is deprecated; use operations (all tools).\n');
    expect(stdout).not.toHaveBeenCalled();
    for (const profile of ['operations', 'full']) {
      const env = fresh.parse({ SWSD_PROFILE: profile });
      const enabledTools: string[] = [];
      registerTools(new McpServer({ name: 'synthetic', version: '0' }), { env, profile: env.SWSD_PROFILE, client: makeFakeClient(), enabledTools, token: '' });
      expect(enabledTools).toHaveLength(145);
      expect(new Set(enabledTools)).toEqual(new Set(PROFILE_TOOLS.operations));
      expect(enabledTools).toContain('swsd_create_solution');
      expect(enabledTools).toContain('swsd_update_solution');
    }
  });

  it.each(PROMPTS)('only includes $name when all required tools are present', async prompt => {
    const complete = await connect(prompt.requires.join(','));
    try { expect((await complete.client.listPrompts()).prompts.map(p => p.name)).toContain(prompt.name); }
    finally { await complete.close(); }
    for (const missing of prompt.requires) {
      const partial = await connect(['swsd_get_server_info', ...prompt.requires.filter(t => t !== missing)].join(','));
      try {
        const listed = await partial.client.listPrompts();
        expect(listed.prompts.map(p => p.name)).not.toContain(prompt.name);
      } finally { await partial.close(); }
    }
  });

  it('omits the catalog form unless both lookup and submission tools are selected', async () => {
    for (const selected of ['swsd_get_catalog_item', 'swsd_create_service_request', 'swsd_get_catalog_item,swsd_create_service_request']) {
      const session = await connect(selected);
      try {
        const tools = (await session.client.listTools()).tools;
        const lookup = tools.find(t => t.name === 'swsd_get_catalog_item');
        const both = selected.includes(',');
        expect(lookup?._meta?.['ui/resourceUri']).toBe(both ? 'ui://swsd/catalog-item-form.html' : undefined);
        const resources = await session.client.listResources();
        expect(resources.resources.map(r => r.uri)).toEqual(both ? ['ui://swsd/catalog-item-form.html'] : []);
        if (lookup) {
          session.fake.setLookupBody({ id: 42, name: 'Synthetic catalog item' });
          expect((await session.client.callTool({ name: lookup.name, arguments: { id: 42 } })).isError).not.toBe(true);
        }
      } finally { await session.close(); }
    }
  });

  it('includes read widgets only for their selected tools', async () => {
    const session = await connect('swsd_get_incident');
    try {
      expect((await session.client.listResources()).resources.map(r => r.uri)).toEqual(['ui://swsd/incident-detail.html']);
    } finally { await session.close(); }
  });

  it('preserves preview and both confirmation gates for an explicitly selected delete', async () => {
    const session = await connect('swsd_delete_incident');
    const id = 195000010;
    session.fake.setLookupBody({ id, name: 'Synthetic incident' });
    try {
      for (const args of [{ id }, { id, confirm: true }, { id, confirm: true, confirm_id: id + 1 }]) {
        const preview = await session.client.callTool({ name: 'swsd_delete_incident', arguments: args });
        expect(preview.structuredContent).toMatchObject({ confirmation_required: true, would_delete: { id, name: 'Synthetic incident' } });
        expect(session.fake.calls.filter(c => c.type === 'delete')).toEqual([]);
      }
      const deleted = await session.client.callTool({ name: 'swsd_delete_incident', arguments: { id, confirm: true, confirm_id: id } });
      expect(deleted.isError).not.toBe(true);
      expect(session.fake.calls.filter(c => c.type === 'delete')).toEqual([{ type: 'delete', path: `/incidents/${id}.json` }]);
      expect(session.enabledTools).toEqual(['swsd_delete_incident']);
    } finally { await session.close(); }
  });

  it.each(['swsd_delete_incident', 'swsd_remove_group_member'])('does not allow extras to smuggle %s into other profiles', name => {
    for (const profile of ['triage', 'agent', 'knowledge', 'custom']) {
      const env = EnvSchema.parse({ SWSD_PROFILE: profile, SWSD_TOOLS: 'swsd_get_me', SWSD_ENABLE_EXTRAS: name });
      const ctx = { env, profile: env.SWSD_PROFILE, client: makeFakeClient(), enabledTools: [], token: '' };
      expect(() => registerTools(new McpServer({ name: 'synthetic', version: '0' }), ctx)).toThrow('Delete tools require operations or explicit selection');
      expect(ctx.enabledTools).toEqual([]);
    }
  });

  it('registers every destructive tool when explicitly selected from a file', async () => {
    const tools = PROFILE_TOOLS.operations.filter(name => name.startsWith('swsd_delete_') || name === 'swsd_remove_group_member');
    expect(tools).toHaveLength(25);
    const session = await connect('', '', { SWSD_PROFILE_FILE: file({ ...fileProfile, tools }) });
    try { expect(new Set((await session.client.listTools()).tools.map(t => t.name))).toEqual(new Set(tools)); }
    finally { await session.close(); }
  });

  it.each(['dry-run', 'disabled'])('keeps custom deletes gated in %s write mode even with confirmation', async mode => {
    const session = await connect('swsd_delete_incident', '', { SWSD_WRITE_MODE: mode });
    session.fake.setLookupBody({ id: 195000010, name: 'Synthetic incident' });
    try {
      const result = await session.client.callTool({ name: 'swsd_delete_incident', arguments: { id: 195000010, confirm: true, confirm_id: 195000010 } });
      if (mode === 'dry-run') expect(result.structuredContent).toMatchObject({ dry_run: true, would_delete: { id: 195000010 } });
      else expect(result.isError).toBe(true);
      expect(session.fake.calls.filter(c => c.type === 'delete')).toEqual([]);
    } finally { await session.close(); }
  });

  it('retains loud failure for unknown extras including inherited object keys', async () => {
    for (const name of ['swsd_typo', 'toString', '__proto__']) {
      await expect(connect('swsd_get_me', name)).rejects.toThrow('Unknown tool in SWSD_ENABLE_EXTRAS');
    }
  });
});
