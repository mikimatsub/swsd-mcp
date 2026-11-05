import type { CallToolResult } from '@modelcontextprotocol/server';
import { redactSecrets, redactText } from '../utils/secrets.js';

export function structuredResult<T extends Record<string, unknown>>(
  structured: T,
  summaryText: string,
): CallToolResult {
  return {
    content: [{ type: 'text', text: redactText(summaryText) }],
    structuredContent: redactSecrets(structured),
  };
}

export function textResult(text: string): CallToolResult {
  return {
    content: [{ type: 'text', text: redactText(text) }],
  };
}
