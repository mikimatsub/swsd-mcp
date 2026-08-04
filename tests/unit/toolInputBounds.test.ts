import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { registerTools } from '../../src/config/toolRegistry.js';
import { makeCtx, makeFakeClient } from './tools/_helpers/mockClient.js';

interface JsonSchemaNode {
  type?: string;
  enum?: unknown[];
  maxLength?: number;
  maxItems?: number;
  properties?: Record<string, JsonSchemaNode>;
  additionalProperties?: boolean | JsonSchemaNode;
  items?: JsonSchemaNode;
  anyOf?: JsonSchemaNode[];
  oneOf?: JsonSchemaNode[];
  allOf?: JsonSchemaNode[];
  $defs?: Record<string, JsonSchemaNode>;
}

interface RegisteredToolInternals {
  inputSchema: Parameters<typeof z.toJSONSchema>[0];
}

interface McpServerInternals {
  _registeredTools: Record<string, RegisteredToolInternals>;
}

function collectUnboundedInputs(schema: JsonSchemaNode, path: string, issues: string[]): void {
  if (schema.type === 'string' && !schema.enum && schema.maxLength === undefined) {
    issues.push(`${path} is an unbounded string`);
  }
  if (schema.type === 'array' && schema.maxItems === undefined) {
    issues.push(`${path} is an unbounded array`);
  }

  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    collectUnboundedInputs(property, `${path}.${name}`, issues);
  }
  if (typeof schema.additionalProperties === 'object') {
    collectUnboundedInputs(schema.additionalProperties, `${path}.*`, issues);
  }
  if (schema.items) collectUnboundedInputs(schema.items, `${path}[]`, issues);
  for (const [kind, alternatives] of [
    ['anyOf', schema.anyOf],
    ['oneOf', schema.oneOf],
    ['allOf', schema.allOf],
  ] as const) {
    for (const [index, alternative] of (alternatives ?? []).entries()) {
      collectUnboundedInputs(alternative, `${path}.${kind}[${String(index)}]`, issues);
    }
  }
  for (const [name, definition] of Object.entries(schema.$defs ?? {})) {
    collectUnboundedInputs(definition, `${path}.$defs.${name}`, issues);
  }
}

describe('tool input resource bounds', () => {
  it('bounds every non-enum string and every array exposed by every tool', () => {
    const server = new McpServer({ name: 'input-bounds-test', version: '0.0.0' });
    const ctx = makeCtx(makeFakeClient(), { SWSD_ENABLE_EXTRAS: [] });
    ctx.profile = 'full';
    registerTools(server, ctx);

    const internals = server as unknown as McpServerInternals;
    const issues: string[] = [];
    for (const [name, tool] of Object.entries(internals._registeredTools)) {
      const schema = z.toJSONSchema(tool.inputSchema) as JsonSchemaNode;
      collectUnboundedInputs(schema, name, issues);
    }

    expect(issues).toEqual([]);
  });
});
