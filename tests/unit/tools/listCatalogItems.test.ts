import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerListCatalogItems } from '../../../src/tools/catalog/listCatalogItems.js';
import type { ToolContext } from '../../../src/config/toolRegistry.js';
import type { SwsdClient, SwsdGetResult } from '../../../src/swsd/client.js';

interface RegisteredToolInternals {
  description?: string;
  annotations?: Record<string, unknown>;
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
  setTotal: (t: number | undefined) => void;
}

function makeFakeClient(): FakeClient {
  const calls: CapturedCall[] = [];
  let body: unknown = [];
  let total: number | undefined = undefined;
  const get = async <T>(
    path: string,
    params: Record<string, unknown> = {},
  ): Promise<SwsdGetResult<T>> => {
    calls.push({ path, params });
    const page = typeof params.page === 'number' ? params.page : 1;
    const per_page = typeof params.per_page === 'number' ? params.per_page : 25;
    return {
      body: body as T,
      pagination: {
        page,
        per_page,
        total,
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
    setTotal: (t: number | undefined) => {
      total = t;
    },
    get,
    post: notImpl,
    put: notImpl,
    rawRequest: notImpl,
  } as unknown as FakeClient;
}

const SAMPLE_ITEM = {
  id: 100,
  name: 'New Hire Onboarding',
  state: 'Approved',
  category: { id: 1, name: 'HR' },
  subcategory: { id: 2, name: 'Onboarding' },
  request_count: 5,
  updated_at: '2026-04-01T12:00:00Z',
  variables: [{ id: 1, name: 'First Name' }, { id: 2, name: 'Last Name' }],
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
  items: unknown[];
  pagination: {
    page: number;
    per_page: number;
    total?: number;
    total_scope: 'filtered' | 'tenant' | 'unknown';
    has_more: boolean;
  };
  applied_filters: Record<string, unknown>;
}

describe('swsd_list_catalog_items', () => {
  let server: McpServer;
  let client: FakeClient;
  let tool: RegisteredToolInternals;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    client = makeFakeClient();
    registerListCatalogItems(server, makeCtx(client));
    const internals = server as unknown as McpServerInternals;
    const registered = internals._registeredTools['swsd_list_catalog_items'];
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

  it('with no filters, applied_filters is empty and total_scope is "tenant" when total present', async () => {
    client.setBody([SAMPLE_ITEM]);
    client.setTotal(14);

    const result = (await tool.handler(
      { page: 1, per_page: 25 },
      {},
    )) as StructuredCallToolResult;
    expect(result.isError).toBeFalsy();

    const struct = result.structuredContent as ToolStructuredOutput | undefined;
    expect(struct).toBeDefined();
    expect(struct?.applied_filters).toEqual({});
    expect(struct?.pagination.total_scope).toBe('tenant');
    expect(struct?.pagination.total).toBe(14);
    expect(struct?.items).toHaveLength(1);

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.path).toBe('/catalog_items.json');
    expect(client.calls[0]?.params).toEqual({ page: 1, per_page: 25 });
  });

  it('with no filters and missing X-Total-Count, total_scope is "unknown"', async () => {
    client.setBody([SAMPLE_ITEM]);
    client.setTotal(undefined);

    const result = (await tool.handler(
      { page: 1, per_page: 25 },
      {},
    )) as StructuredCallToolResult;
    const struct = result.structuredContent as ToolStructuredOutput | undefined;
    expect(struct?.pagination.total_scope).toBe('unknown');
  });

  it('with state filter, applied_filters.state is set and total_scope is "filtered"', async () => {
    client.setBody([SAMPLE_ITEM]);
    client.setTotal(1);

    const result = (await tool.handler(
      { page: 1, per_page: 25, state: 'Approved' },
      {},
    )) as StructuredCallToolResult;
    const struct = result.structuredContent as ToolStructuredOutput | undefined;
    expect(struct?.applied_filters.state).toBe('Approved');
    expect(struct?.pagination.total_scope).toBe('filtered');

    expect(client.calls[0]?.params).toMatchObject({ state: 'Approved' });
  });

  it('the `query` input maps to the SWSD `name` query param', async () => {
    client.setBody([]);
    client.setTotal(0);

    const result = (await tool.handler(
      { page: 1, per_page: 25, query: 'onboarding' },
      {},
    )) as StructuredCallToolResult;
    const struct = result.structuredContent as ToolStructuredOutput | undefined;
    expect(struct?.applied_filters.query).toBe('onboarding');

    // Crucial: query → name on the wire (SWSD's catalog endpoint uses `name`).
    expect(client.calls[0]?.params).toMatchObject({ name: 'onboarding' });
    expect(client.calls[0]?.params).not.toHaveProperty('query');
  });

  it('passes department and site filters through', async () => {
    client.setBody([]);
    client.setTotal(0);

    await tool.handler(
      {
        page: 1,
        per_page: 25,
        department: 'Engineering',
        site: 'NYC',
      },
      {},
    );
    expect(client.calls[0]?.params).toMatchObject({
      department: 'Engineering',
      site: 'NYC',
    });
  });

  it('filters out non-object rows from a malformed response body', async () => {
    client.setBody([SAMPLE_ITEM, null, 'oops', { name: 'no-id-row' }]);
    const result = (await tool.handler(
      { page: 1, per_page: 25 },
      {},
    )) as StructuredCallToolResult;
    const struct = result.structuredContent as ToolStructuredOutput | undefined;
    expect(struct?.items).toHaveLength(1);
  });

  it('handles non-array body gracefully (returns empty items)', async () => {
    client.setBody({ not: 'an array' });
    const result = (await tool.handler(
      { page: 1, per_page: 25 },
      {},
    )) as StructuredCallToolResult;
    const struct = result.structuredContent as ToolStructuredOutput | undefined;
    expect(struct?.items).toEqual([]);
  });

  it('summary text includes count, total, and scope', async () => {
    client.setBody([SAMPLE_ITEM]);
    client.setTotal(14);
    const result = (await tool.handler(
      { page: 1, per_page: 25 },
      {},
    )) as StructuredCallToolResult;
    const text = result.content?.[0]?.text;
    expect(text).toContain('1');
    expect(text).toContain('14');
    expect(text).toContain('tenant-wide');
  });
});
