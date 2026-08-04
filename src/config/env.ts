import { z } from 'zod';

const PROFILES = ['triage', 'agent', 'knowledge', 'operations', 'full'] as const;
const TRANSPORTS = ['stdio', 'http'] as const;
const WRITE_MODES = ['live', 'dry-run', 'disabled'] as const;

const csv = (raw: string | undefined): string[] =>
  raw
    ? raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

/**
 * Accepts trust-proxy values in the standard Express forms:
 * - "true" / "false" → boolean
 * - "1", "2", ... → number of trusted hops
 * - any other string → passed through (IP / IP-list / 'loopback' etc.)
 */
const trustProxyTransform = (v: string | undefined): boolean | number | string => {
  if (!v) return false;
  if (v === 'true') return true;
  if (v === 'false') return false;
  const n = Number(v);
  if (Number.isFinite(n) && Number.isInteger(n) && n >= 0) return n;
  return v;
};

/**
 * SSRF defense: SWSD_BASE_URL must be on the samanage.com domain. This
 * prevents an attacker who manages to influence the env var from redirecting
 * forwarded tokens to a server they control. samanage.com itself + any
 * subdomain is allowed (api., apieu., etc.).
 */
const isSamanageUrl = (url: string): boolean => {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === 'samanage.com' || h.endsWith('.samanage.com');
  } catch {
    return false;
  }
};

export const EnvSchema = z.object({
  SWSD_TOKEN: z.string().max(32_768).optional(),
  SWSD_BASE_URL: z
    .string()
    .max(2_048)
    .url()
    .refine(isSamanageUrl, {
      message: 'SWSD_BASE_URL must be on samanage.com (e.g., https://api.samanage.com or https://apieu.samanage.com)',
    })
    .default('https://api.samanage.com'),
  SWSD_API_VERSION: z.string().min(1).max(32).default('v2.1'),
  SWSD_TRANSPORT: z.enum(TRANSPORTS).default('stdio'),
  SWSD_PROFILE: z.enum(PROFILES).default('agent'),
  SWSD_WRITE_MODE: z
    .enum(WRITE_MODES)
    .default('live')
    .describe(
      'Write safety mode. live = call SWSD normally; dry-run = return the request that would be sent; disabled = reject all write tools.',
    ),
  SWSD_ATTACHMENT_ROOT: z
    .preprocess(
      (value) =>
        typeof value === 'string' && value.trim().length === 0 ? undefined : value,
      z.string().trim().min(1).max(4_096).optional(),
    )
    .describe(
      'Optional real-path root for stdio file_path attachments. Files outside this directory are rejected.',
    ),
  SWSD_ENABLE_EXTRAS: z
    .string()
    .max(10_000)
    .optional()
    .transform(csv),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  SWSD_ALLOWED_ORIGINS: z
    .string()
    .max(10_000)
    .optional()
    .transform(csv),
  SWSD_RETRY_MAX_ATTEMPTS: z.coerce.number().int().min(0).max(10).default(3),
  SWSD_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(300_000)
    .default(30_000)
    .describe('Per-request timeout for outbound SWSD calls. 30s default.'),
  SWSD_TRUST_PROXY: z.string().max(4_096).optional().transform(trustProxyTransform),
  SWSD_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
  SWSD_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100_000).default(100),
});

export type Env = z.infer<typeof EnvSchema>;
export type ProfileName = (typeof PROFILES)[number];
export type TransportName = (typeof TRANSPORTS)[number];
export type WriteMode = (typeof WRITE_MODES)[number];
export const KNOWN_PROFILES = PROFILES;
export const KNOWN_TRANSPORTS = TRANSPORTS;
export const KNOWN_WRITE_MODES = WRITE_MODES;

export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    process.stderr.write('Invalid environment configuration:\n');
    for (const issue of result.error.issues) {
      process.stderr.write(`  ${issue.path.join('.') || '(root)'}: ${issue.message}\n`);
    }
    process.exit(2);
  }
  return result.data;
}
