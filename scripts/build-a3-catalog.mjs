// Humanization follows the A3 design; metadata comes from actual server registration.
import { writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/build-a3-catalog.mjs [server-dist-directory]\nDefaults to dist. Registers tools without calling handlers or an HTTP client.');
  process.exit(0);
}
const runtime = resolve(process.argv[2] ?? 'dist');
const load = file => import(pathToFileURL(join(runtime, file)).href);
const [{ createMcpServer }, { registerTools }, { PROFILE_TOOLS }, { parseEnv }] = await Promise.all([
  load('mcp/server.js'), load('config/toolRegistry.js'), load('config/profiles.js'), load('config/env.js'),
]);
const token = randomBytes(32).toString('hex');
const env = parseEnv({ SWSD_TOKEN: token, SWSD_PROFILE: 'full', SWSD_ENABLE_EXTRAS: '' });
const server = createMcpServer();
const client = new Proxy({}, { get() { throw new Error('Catalog generation must never call an HTTP client'); } });
let tools;
try {
  registerTools(server, { env, client, token, profile: 'full', enabledTools: [] });
  tools = Object.entries(server._registeredTools).map(([name, metadata]) => ({
    name, description: metadata.description, annotations: metadata.annotations,
    profiles: Object.entries(PROFILE_TOOLS).filter(([, names]) => names.includes(name)).map(([profile]) => profile),
  })).sort((a, b) => a.name.localeCompare(b.name));
} finally { await server.close(); }
const areas = [
  ['Incidents', /incident|sla_risk|ticket_stats|my_queue/], ['Problems', /problem/],
  ['Changes', /change(?!_catalog)|change_calendar/], ['Releases', /release/],
  ['Comments & tasks', /comment|task|time_track|log_time|attachment/], ['Knowledge', /solution/],
  ['Service catalog', /catalog|service_request/],
  ['Assets & CMDB', /hardware|mobile|printer|software|other_asset|configuration_item|warrant|risk/],
  ['Contracts & vendors', /contract|purchase|vendor/],
  ['Directory', /user|group|site|department|role|categor|me$/], ['Utilities', /./],
];
const special = { sla: 'SLA', cmdb: 'CMDB', swsd: 'SWSD', id: 'ID', jwt: 'JWT' };
const examples = {
  swsd_list_my_incidents: 'Show my open P1 incidents',
  swsd_sla_risk: 'Which tickets are about to breach SLA today?',
  swsd_delete_incident: 'Preview deleting test incident 48213',
};
const catalog = tools.map(t => {
  const words = t.name.slice(5).split('_').map(w => special[w] ?? w).join(' ');
  const friendly = words[0].toUpperCase() + words.slice(1);
  const sentence = t.description.trim().split(/(?<=[.!?])\s/)[0].replace(/\.$/, '');
  const short = sentence.length <= 90 ? sentence : sentence.slice(0, 87).replace(/\s\S*$/, '') + '…';
  // destructiveHint also marks edits. Only deletion/membership removal has the D badge.
  const kind = t.annotations.readOnlyHint ? 'read' : t.annotations.destructiveHint && /^swsd_(delete_|remove_group_member$)/.test(t.name) ? 'delete' : 'edit';
  return { ...t, area: areas.find(([, rx]) => rx.test(t.name))[0], friendly, short, kind,
    example: examples[t.name] ?? (kind === 'delete' ? `Preview: ${friendly.toLowerCase()} in SWSD` : `${friendly} in SWSD`) };
});
await writeFile(new URL('../plugins/swsd/assets/tool-catalog.json', import.meta.url), JSON.stringify(catalog, null, 2) + '\n');
console.log(`Wrote ${catalog.length} tools.`);
