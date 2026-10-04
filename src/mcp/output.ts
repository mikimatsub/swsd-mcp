import type { CallToolResult } from '@modelcontextprotocol/server';

export function structuredResult<T extends Record<string, unknown>>(
  structured: T,
  summaryText: string,
): CallToolResult {
  return {
    content: [{ type: 'text', text: summaryText }],
    structuredContent: structured,
  };
}

export function textResult(text: string): CallToolResult {
  return {
    content: [{ type: 'text', text }],
  };
}
