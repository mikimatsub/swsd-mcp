import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Env, ProfileName } from './env.js';
import { PROFILE_TOOLS } from './profiles.js';

export const MAX_PROFILE_BYTES = 256 * 1024;
export const MAX_PROFILE_TOOLS = 512;

// The published JSON Schema is generated from this same runtime schema.
// Tool names intentionally remain strings: unknown names warn and are skipped.
export const CustomProfileSchema = z.strictObject({
  name: z.string().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9 _.-]*$/),
  version: z.literal(1),
  description: z.string().max(2_048).optional(),
  tools: z.array(z.string().min(1).max(128)).max(MAX_PROFILE_TOOLS),
});

function readProfile(path: string): z.infer<typeof CustomProfileSchema> {
  // Accept explicit absolute paths or paths relative to startup cwd. Resolve
  // symlinks, open read-only/nonblocking, and check the opened file itself.
  // Bound the read as well as stat size to handle files growing after stat.
  let fd: number | undefined;
  try {
    const resolved = realpathSync(resolve(path));
    fd = openSync(resolved, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error('must be a regular JSON file');
    if (stat.size > MAX_PROFILE_BYTES) throw new Error(`exceeds ${MAX_PROFILE_BYTES} bytes (256 KiB)`);
    const buffer = Buffer.alloc(MAX_PROFILE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const bytes = readSync(fd, buffer, length, buffer.length - length, length);
      if (bytes === 0) break;
      length += bytes;
    }
    if (length > MAX_PROFILE_BYTES) throw new Error(`exceeds ${MAX_PROFILE_BYTES} bytes (256 KiB)`);
    const parsed: unknown = JSON.parse(buffer.toString('utf8', 0, length));
    const result = CustomProfileSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(result.error.issues.map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; '));
    }
    return result.data;
  } catch (error) {
    throw new Error(`Invalid SWSD_PROFILE_FILE: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

const selections = new WeakMap<Env, readonly string[]>();

/** Snapshot custom configuration once per server, including stateless HTTP. */
export function resolveProfileTools(env: Env, profile: ProfileName = env.SWSD_PROFILE): readonly string[] {
  if (profile !== 'custom') return PROFILE_TOOLS[profile];
  const cached = selections.get(env);
  if (cached) return cached;
  const fileTools = env.SWSD_PROFILE_FILE ? readProfile(env.SWSD_PROFILE_FILE).tools : [];
  if (env.SWSD_TOOLS.length + fileTools.length > MAX_PROFILE_TOOLS) {
    throw new Error(`Custom profile exceeds ${MAX_PROFILE_TOOLS} tool entries across SWSD_TOOLS and SWSD_PROFILE_FILE.`);
  }
  const requested = new Set([...env.SWSD_TOOLS, ...fileTools]);
  const known = new Set<string>(PROFILE_TOOLS.operations);
  const unknown = [...requested].filter(name => !known.has(name));
  if (unknown.length) process.stderr.write(`Unknown custom profile tools (skipped): ${unknown.map(name => JSON.stringify(name)).join(', ')}\n`);
  const tools = [...requested].filter(name => known.has(name));
  if (!tools.length) {
    throw new Error('Custom profile has no valid tools. Set SWSD_TOOLS and/or SWSD_PROFILE_FILE with at least one known tool.');
  }
  const snapshot = Object.freeze(tools);
  selections.set(env, snapshot);
  return snapshot;
}
