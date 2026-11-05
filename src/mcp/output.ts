import type { CallToolResult } from '@modelcontextprotocol/server';
import { redactValue } from '../utils/secrets.js';

export function structuredResult<T extends Record<string, unknown>>(
  structured: T,
  summaryText: string,
): CallToolResult {
  return {
    content: [{ type: 'text', text: redactValue(summaryText) }],
    structuredContent: redactValue(structured),
  };
}

export function textResult(text: string): CallToolResult {
  return {
    content: [{ type: 'text', text: redactValue(text) }],
  };
}
