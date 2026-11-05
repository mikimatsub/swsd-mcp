import type { Transport } from '@modelcontextprotocol/server';

const REDACTED = '[REDACTED]';
const SENSITIVE_KEY = /authorization|bearer|token|password|passwd|secret|api[_-]?key/i;
export const INVALID_TOKEN_MESSAGE = 'Invalid SWSD token. Tokens must contain only visible ASCII characters without whitespace.';

export function isValidToken(token: string): boolean {
  return token.length > 0 && token.length <= 32_768 &&
    [...token].every((char) => char.charCodeAt(0) >= 33 && char.charCodeAt(0) <= 126);
}

export function validateToken(token: string): void {
  if (!isValidToken(token)) throw new Error(INVALID_TOKEN_MESSAGE);
}

export function redactText(text: string, token?: string): string {
  // Parse serialized objects too: error bodies and MCP text can contain JSON.
  if (text.trimStart().startsWith('{') || text.trimStart().startsWith('[')) {
    try {
      return JSON.stringify(redactSecrets(JSON.parse(text) as unknown, token));
    } catch {
      // Non-JSON messages are handled conservatively below.
    }
  }
  const clean = token ? text.split(token).join(REDACTED) : text;
  return clean.replace(/\bBearer[ \t]+[^\s,;"'<>}\]]+/gi, `Bearer ${REDACTED}`)
    .split(/\r?\n/)
    .map((line) => {
      // For unstructured key/value text, omit the rest of the line rather than
      // guessing where an arbitrary credential value ends.
      for (const match of line.matchAll(/(?:^|[^\w-])["']?([\w-]+)["']?[ \t]*[:=][ \t]*/g)) {
        if (SENSITIVE_KEY.test(match[1] ?? '')) {
          return line.slice(0, match.index + match[0].length) + REDACTED;
        }
      }
      return line;
    }).join('\n');
}

export function redactSecrets<T>(value: T, token?: string): T {
  if (typeof value === 'string') return redactText(value, token) as T;
  if (Array.isArray(value)) return value.map((item: unknown) => redactSecrets(item, token)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      token ? key.split(token).join(REDACTED) : key,
      SENSITIVE_KEY.test(key) ? REDACTED : redactSecrets(item, token),
    ])) as T;
  }
  return value;
}

/** Final request-scoped boundary, including SDK errors and both MCP result forms. */
export function redactTransport(transport: Transport, token: string): Transport {
  const send = transport.send.bind(transport);
  transport.send = (message, options) => {
    if ('error' in message) {
      return send({ ...message, error: redactSecrets(message.error, token) }, options);
    }
    if ('result' in message && ('content' in message.result || 'structuredContent' in message.result)) {
      return send({ ...message, result: redactSecrets(message.result, token) }, options);
    }
    return send(message, options);
  };
  return transport;
}
