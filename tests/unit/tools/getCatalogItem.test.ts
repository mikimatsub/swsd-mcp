import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerGetCatalogItem } from '../../../src/tools/catalog/getCatalogItem.js';
import { GetCatalogItemInput } from '../../../src/schemas/catalogItem.js';
import type { ToolContext } from '../../../src/config/toolRegistry.js';
import type { SwsdClient, SwsdGetResult } from '../../../src/swsd/client.js';

interface RegisteredToolInternals {
  description?: string;
  annotations?: Record<string, unknown>;
  inputSchema?: unknown;
  handler: (input: unknown, extra: unknown) => Promise<unknown>;
}

interface McpServerInternals {
  _registeredTools: Record<string, RegisteredToolInternals>;
}

interface CapturedCall {
  path: string;
  params: Record<string, unknown>;
}

interface FakeClient extends SwsdClient {
  calls: CapturedCall[];
  setBody: (b: unknown) => void;
}

function makeFakeClient(): FakeClient {
  const calls: CapturedCall[] = [];
  let body: unknown = {};
  const get = async <T>(
    path: string,
    params: Record<string, unknown> = {},
  ): Promise<SwsdGetResult<T>> => {
    calls.push({ path, params });
    return {
      body: body as T,
      pagination: {
        page: 1,
        per_page: 25,
        total: undefined,
        has_more: false,
        next_page: undefined,
      },
      headers: new Headers(),
    };
  };
  const notImpl = async <T>(): Promise<T> => {
    throw new Error('not implemented in fake');
  };
  return {
    calls,
    setBody: (b: unknown) => {
      body = b;
    },
    get,
    post: notImpl,
    put: notImpl,
    rawRequest: notImpl,
  } as unknown as FakeClient;
}

const SAMPLE_ITEM = {
  id: 2757496,
  url_id: '2757496-new-employee-onboarding-process',
  name: 'New Employee Onboarding Process ',
  description: '<p>HTML body</p>',
  state: 'Approved',
  category: { id: 1, name: 'Employee Management' },
  subcategory: { id: 2, name: 'Onboarding' },
  request_count: 42,
  variables: [
    {
      id: 10999918,
      uuid: 10999918,
      name: 'New Employee First Name',
      kind: 'free_text',
      field_type: 1,
      options: null,
      required: '1',
      sorted: null,
      helptext: null,
    },
    {
      id: 10999942,
      uuid: 10999942,
      name: 'New Employee Hardware Profile',
      kind: 'drop_down_menu',
      field_type: 2,
      options: 'None\nAdministrative\nCAD Designer',
      required: '1',
      sorted: true,
      helptext: '<p>...</p>',
    },
  ],
  variables_unparsed: 'unused-internal-field',
};

function makeCtx(client: SwsdClient): ToolContext {
  return {
    client,
    profile: 'agent',
    env: {} as never,
    enabledTools: [],
    token: '',
  } satisfies ToolContext;
}

interface StructuredCallToolResult {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
}

interface ToolStructuredOutput {
  item: {
    id: number;
    name?: string;
    variables?: Array<Record<string, unknown>>;
  };
}

describe('swsd_get_catalog_item', () => {
  let server: McpServer;
  let client: FakeClient;
  let tool: RegisteredToolInternals;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    client = makeFakeClient();
    registerGetCatalogItem(server, makeCtx(client));
    const internals = server as unknown as McpServerInternals;
    const registered = internals._registeredTools['swsd_get_catalog_item'];
    if (!registered) throw new Error('Tool was not registered');
    tool = registered;
  });

  it('registers with the right name and read-only annotations', () => {
    expect(tool).toBeDefined();
    expect(tool.annotations).toMatchObject({
      readOnlyHint: true,
      openWorldHint: true,
      idempotentHint: true,
    });
  });

  it('GETs /catalog_items/{id}.json with the input id interpolated', async () => {
    client.setBody(SAMPLE_ITEM);

    const result = (await tool.handler(
      { id: 2757496 },
      {},
    )) as StructuredCallToolResult;
    expect(result.isError).toBeFalsy();

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.path).toBe('/catalog_items/2757496.json');
    expect(client.calls[0]?.params).toEqual({});
  });

  it('returns structured output with item.id and a normalized variables array', async () => {
    client.setBody(SAMPLE_ITEM);

    const result = (await tool.handler(
      { id: 2757496 },
      {},
    )) as StructuredCallToolResult;
    const struct = result.structuredContent as ToolStructuredOutput | undefined;

    expect(struct).toBeDefined();
    expect(struct?.item.id).toBe(2757496);
    expect(struct?.item.name).toBe('New Employee Onboarding Process ');
    expect(struct?.item.variables).toHaveLength(2);
    const firstVar = struct?.item.variables?.[0];
    expect(firstVar?.id).toBe(10999918);
    expect(firstVar?.name).toBe('New Employee First Name');
    // Each variable has at least one of kind/field_type populated.
    expect(firstVar?.kind === 'free_text' || firstVar?.field_type === 1).toBe(true);
  });

  it('passes through top-level fields like description and category for power users', async () => {
    client.setBody(SAMPLE_ITEM);

    const result = (await tool.handler(
      { id: 2757496 },
      {},
    )) as StructuredCallToolResult;
    const struct = result.structuredContent as ToolStructuredOutput | undefined;
    const itemRaw = struct?.item as unknown as Record<string, unknown>;
    expect(itemRaw.description).toBe('<p>HTML body</p>');
    expect(itemRaw.category).toEqual({ id: 1, name: 'Employee Management' });
  });

  it('strips variables_unparsed from the output', async () => {
    client.setBody(SAMPLE_ITEM);

    const result = (await tool.handler(
      { id: 2757496 },
      {},
    )) as StructuredCallToolResult;
    const struct = result.structuredContent as ToolStructuredOutput | undefined;
    const itemRaw = struct?.item as unknown as Record<string, unknown>;
    expect(itemRaw).not.toHaveProperty('variables_unparsed');
  });

  it('returns an error result when SWSD returns a non-object body', async () => {
    client.setBody('not an object');

    const result = (await tool.handler(
      { id: 12345 },
      {},
    )) as StructuredCallToolResult;
    expect(result.isError).toBe(true);
    const text = result.content?.[0]?.text ?? '';
    expect(text.toLowerCase()).toMatch(/12345|not found|unexpected/);
  });

  it('returns an error result when the body is missing an id', async () => {
    client.setBody({ name: 'no id here' });

    const result = (await tool.handler(
      { id: 99999 },
      {},
    )) as StructuredCallToolResult;
    expect(result.isError).toBe(true);
  });

  it('summary text mentions the catalog item name and variable count', async () => {
    client.setBody(SAMPLE_ITEM);

    const result = (await tool.handler(
      { id: 2757496 },
      {},
    )) as StructuredCallToolResult;
    const text = result.content?.[0]?.text ?? '';
    expect(text).toContain('New Employee Onboarding Process');
    // Use a word-boundary match so the assertion is satisfied by the variable
    // count, not by the digit '2' that also happens to appear in the input id.
    expect(text).toMatch(/\b2 variables\b/);
  });

  it('rejects non-positive ids at the schema boundary', () => {
    // The zod schema's .positive() guard should reject 0 and negative ids
    // before they ever hit the API — preventing wasted /catalog_items/-5.json
    // 404s and surfacing the problem at the input layer. The MCP transport
    // runs this validation before the tool handler is invoked; tested
    // directly here against the schema for a stable, transport-independent
    // assertion.
    expect(GetCatalogItemInput.safeParse({ id: -1 }).success).toBe(false);
    expect(GetCatalogItemInput.safeParse({ id: 0 }).success).toBe(false);
    expect(GetCatalogItemInput.safeParse({ id: 1.5 }).success).toBe(false);
    expect(GetCatalogItemInput.safeParse({ id: 'abc' }).success).toBe(false);
    expect(GetCatalogItemInput.safeParse({ id: 2757496 }).success).toBe(true);
  });
});
