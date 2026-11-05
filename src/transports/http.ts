import { createHash } from 'node:crypto';
import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import type { Env } from '../config/env.js';
import { createMcpServer, SERVER_NAME, SERVER_VERSION } from '../mcp/server.js';
import { createSwsdClient } from '../swsd/client.js';
import { registerTools } from '../config/toolRegistry.js';
import { extractToken, parseToken, AuthError } from './auth.js';
import { redactTransport } from '../utils/secrets.js';

// Legacy MCP protocol versions supported by SDK v2.
// When upgrading the SDK, re-check the spec versions it supports.
const SUPPORTED_PROTOCOL_VERSIONS = new Set<string>([
  '2024-11-05',
  '2025-03-26',
  '2025-06-18',
  '2025-11-25',
]);

function isLoopbackOrigin(origin: string): boolean {
  if (!/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?$/i.test(origin)) return false;
  try {
    return new URL(origin).origin !== 'null';
  } catch {
    return false;
  }
}

export async function runHttp(config: Env): Promise<void> {
  // HTTP must never inherit stdio's permission to read server-local attachments.
  const env: Env = { ...config, SWSD_TRANSPORT: 'http' };
  const app = express();

  // Trust upstream proxy hops so req.ip reflects the real client (not the
  // proxy). Required for accurate rate-limit keying behind Azure App Service,
  // Nginx, Cloudflare, etc. Default false = no proxy (single instance dev).
  app.set('trust proxy', env.SWSD_TRUST_PROXY);

  // Helmet — defense-in-depth security headers on every response (including
  // /healthz, errors, and 404s). Mounted FIRST so headers apply universally.
  // Helmet 8.1.0 defaults set (verified against actual response headers):
  //   - Strict-Transport-Security: max-age=31536000; includeSubDomains (1y)
  //   - Content-Security-Policy: default-src 'self'; ...
  //   - X-Frame-Options: SAMEORIGIN (Helmet 8 default; restricts embedding to
  //     same-origin only, which is fine for our JSON-only API endpoints since
  //     no legitimate client iframes our responses)
  //   - X-Content-Type-Options: nosniff
  //   - Referrer-Policy: no-referrer
  //   - Cross-Origin-Opener-Policy + Cross-Origin-Resource-Policy: same-origin
  //   - X-DNS-Prefetch-Control, X-Download-Options, X-Permitted-Cross-Domain-Policies
  // No customization needed: the server returns JSON only (no HTML, no
  // scripts, no inline styles), so Helmet's strict defaults are correct.
  app.use(helmet());

  // Health endpoint — minimal payload (no version disclosure), separate
  // from /mcp so monitoring doesn't auth-fail and so health probes don't
  // count against the rate limit.
  app.get('/healthz', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // Rate limit /mcp only. Keyed by sha256(token+IP) so each user-on-IP gets
  // their own quota. Token is hashed (never stored as raw key) for memory
  // safety. Falls back to IP-only when no token is present (which would 401
  // anyway, but throttles brute-force attempts).
  //
  // IP normalization: pass the raw req.ip through `ipKeyGenerator` from
  // express-rate-limit before hashing. For IPv6 addresses, that helper
  // collapses each /56 prefix (the library default — see
  // ipKeyGenerator's `ipv6Subnet` option) to a single key — without it,
  // two IPv6 clients in the same /56 would get different keys and
  // effectively bypass the limit. (The library emits a startup
  // ValidationError if you forget this step in 8.5.x+.)
  const mcpLimiter = rateLimit({
    windowMs: env.SWSD_RATE_LIMIT_WINDOW_MS,
    limit: env.SWSD_RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req: Request): string => {
      const token = parseToken(req) ?? '';
      const ipKey = ipKeyGenerator(req.ip ?? '0.0.0.0');
      return createHash('sha256').update(`${token}:${ipKey}`).digest('hex');
    },
    message: { error: 'Too many requests. Slow down and try again later.' },
  });
  app.use('/mcp', mcpLimiter);

  // Origin validation — spec MUST for DNS-rebinding prevention.
  // With no explicit allowlist, accept only loopback browser origins.
  const allowedOrigins = new Set(env.SWSD_ALLOWED_ORIGINS);
  const allowedHosts = new Set(env.SWSD_ALLOWED_HOSTS);
  app.use('/mcp', (req: Request, res: Response, next: NextFunction) => {
    const origin = req.header('origin');
    if (origin !== undefined && !(allowedOrigins.size > 0 ? allowedOrigins.has(origin) : isLoopbackOrigin(origin))) {
      res.status(403).json({ error: 'Origin not allowed.' });
      return;
    }
    if (allowedHosts.size > 0 && !allowedHosts.has(req.header('host') ?? '')) {
      res.status(403).json({ error: 'Host not allowed.' });
      return;
    }
    next();
  });

  // MCP-Protocol-Version header validation when present.
  app.use('/mcp', (req: Request, res: Response, next: NextFunction) => {
    const v = req.header('mcp-protocol-version');
    if (v && !SUPPORTED_PROTOCOL_VERSIONS.has(v)) {
      res.status(400).json({
        error: 'Unsupported MCP-Protocol-Version.',
        supported: [...SUPPORTED_PROTOCOL_VERSIONS],
      });
      return;
    }
    next();
  });

  // Authenticate and throttle before parsing potentially large or malformed JSON.
  app.post('/mcp', (req: Request, res: Response, next: NextFunction) => {
    try {
      extractToken(req);
    } catch (e) {
      if (e instanceof AuthError) {
        res.status(401).json({ error: e.message });
        return;
      }
      throw e;
    }
    next();
  });

  app.post('/mcp', express.json({ limit: '4mb' }), async (req: Request, res: Response) => {
    const token = extractToken(req);
    const client = createSwsdClient({ env, token });
    const server = createMcpServer();
    const enabledTools: string[] = [];
    registerTools(server, {
      env,
      profile: env.SWSD_PROFILE,
      client,
      enabledTools,
      token,
    });

    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      allowedHosts: env.SWSD_ALLOWED_HOSTS,
      enableDnsRebindingProtection: allowedHosts.size > 0,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    await server.connect(redactTransport(transport, token));
    await transport.handleRequest(req, res, req.body as unknown);
  });

  // Four arguments are required for Express to recognize error middleware.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const type = err && typeof err === 'object' && 'type' in err ? err.type : undefined;
    const status = type === 'entity.parse.failed' ? 400 : type === 'entity.too.large' ? 413 : 500;
    const code = status === 400 ? 'INVALID_JSON' : status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INTERNAL_ERROR';
    const message = status === 400 ? 'Malformed JSON request.' : status === 413 ? 'Request payload too large.' : 'Internal server error.';
    process.stderr.write(`HTTP request failed: ${JSON.stringify({ status, code })}\n`);
    if (!res.headersSent) res.status(status).json({ error: { code, message } });
    else res.end();
  });

  app.listen(env.PORT, () => {
    process.stderr.write(
      `${SERVER_NAME} ${SERVER_VERSION} HTTP transport listening on :${String(env.PORT)} ` +
        `(POST /mcp, GET /healthz; rate limit ${String(env.SWSD_RATE_LIMIT_MAX)}/` +
        `${String(env.SWSD_RATE_LIMIT_WINDOW_MS / 1000)}s, request timeout ${String(env.SWSD_REQUEST_TIMEOUT_MS / 1000)}s)\n`,
    );
  });
}
