import type { CallToolResult } from '@modelcontextprotocol/server';

export function toolError(message: string, hint?: string): CallToolResult {
  const text = hint ? `${message}\n\nHint: ${hint}` : message;
  return {
    isError: true,
    content: [{ type: 'text', text }],
  };
}
