import type { Env } from '../config/env.js';
import { SERVER_NAME, SERVER_VERSION } from '../mcp/server.js';
import { validateToken } from '../utils/secrets.js';

export function buildHeaders(
  env: Env,
  token: string,
  extra?: Record<string, string>,
): Record<string, string> {
  validateToken(token);
  return {
    'X-Samanage-Authorization': `Bearer ${token}`,
    Accept: `application/vnd.samanage.${env.SWSD_API_VERSION}+json`,
    'Content-Type': 'application/json',
    'User-Agent': `${SERVER_NAME}/${SERVER_VERSION}`,
    ...extra,
  };
}
