import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerCreateServiceRequest } from '../../../src/tools/catalog/createServiceRequest.js';
import { CreateServiceRequestInput } from '../../../src/schemas/serviceRequest.js';
import type { ToolContext } from '../../../src/config/toolRegistry.js';
import type {
  SwsdClient,
  SwsdGetResult,
  SwsdMutationResult,
} from '../../../src/swsd/client.js';

interface RegisteredToolInternals {
  description?: string;
  annotations?: Record<string, unknown>;
  inputSchema?: unknown;
  handler: (input: unknown, extra: unknown) => Promise<unknown>;
}

interface McpServerInternals {
  _registeredTools: Record<string, RegisteredToolInternals>;
}

interface CapturedGet {
  type: 'get';
  path: string;
  params: Record<string, unknown>;
}

interface CapturedPost {
  type: 'post';
  path: string;
  body: unknown;
}

type CapturedCall = CapturedGet | CapturedPost;

interface FakeClient extends SwsdClient {
  calls: CapturedCall[];
  setUserBody: (b: unknown) => void;
  setPostResponse: (b: unknown) => void;
}

function makeFakeClient(): FakeClient {
  const calls: CapturedCall[] = [];
  let userBody: unknown = {
    id: 11643235,
    email: 'jwt-user@example.com',
    name: 'JWT User',
  };
  let postResponse: unknown = {
    id: 999,
    number: 12345,
    name: 'Data Recovery',
    is_service_request: true,
    state: 'New - Unassigned',
    href_account_domain: 'https://example.samanage.com/incidents/999',
  };

  const get = async <T>(
    path: string,
    params: Record<string, unknown> = {},
  ): Promise<SwsdGetResult<T>> => {
    calls.push({ type: 'get', path, params });
    return {
      body: userBody as T,
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

  const post = async <T>(
    path: string,
    body: unknown,
  ): Promise<SwsdMutationResult<T>> => {
    calls.push({ type: 'post', path, body });
    return {
      body: postResponse as T,
      headers: new Headers(),
      status: 200,
    };
  };

  const notImpl = async <T>(): Promise<T> => {
    throw new Error('not implemented in fake');
  };

  return {
    calls,
    setUserBody: (b: unknown) => {
      userBody = b;
    },
    setPostResponse: (b: unknown) => {
      postResponse = b;
    },
    get,
    post,
    put: notImpl,
    rawRequest: notImpl,
  } as unknown as FakeClient;
}

// Token with payload {"user_id":11643235,"generated_at":"2026-03-11"}.
// Header is { "alg": "HS512", "typ": "JWT" }; signature unused (we never verify).
function makeJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS512', typ: 'JWT' }),
  ).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.signature`;
}

const TOKEN_WITH_USER_ID = makeJwt({
  user_id: 11643235,
  generated_at: '2026-03-11',
});
const TOKEN_WITHOUT_USER_ID = makeJwt({ generated_at: '2026-03-11' });

function makeCtx(client: SwsdClient, token = TOKEN_WITH_USER_ID): ToolContext {
  return {
    client,
    profile: 'agent',
    env: {} as never,
    enabledTools: [],
    token,
  } satisfies ToolContext;
}

interface StructuredCallToolResult {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
}

interface ToolStructuredOutput {
  incident: {
    id: number;
    number?: number;
    name?: string;
    is_service_request?: boolean;
    state?: string;
    url?: string;
  };
}

function getRegisteredTool(server: McpServer, name: string): RegisteredToolInternals {
  const internals = server as unknown as McpServerInternals;
  const t = internals._registeredTools[name];
  if (!t) throw new Error(`Tool ${name} not registered`);
  return t;
}

describe('swsd_create_service_request', () => {
  let server: McpServer;
  let client: FakeClient;
  let tool: RegisteredToolInternals;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    client = makeFakeClient();
    registerCreateServiceRequest(server, makeCtx(client));
    tool = getRegisteredTool(server, 'swsd_create_service_request');
  });

  it('registers with the right name and write annotations', () => {
    expect(tool).toBeDefined();
    expect(tool.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
      idempotentHint: false,
    });
  });

  it('POSTs to /catalog_items/{id}/service_requests.json (NOT /incidents.json)', async () => {
    await tool.handler(
      {
        catalog_item_id: 794451,
        request_variables: [{ custom_field_id: 2181315, value: 'test' }],
      },
      {},
    );
    const post = client.calls.find((c) => c.type === 'post');
    expect(post).toBeDefined();
    expect(post?.type === 'post' ? post.path : '').toBe(
      '/catalog_items/794451/service_requests.json',
    );
  });

  it('wraps body as {incident: {...}} and uses request_variables_attributes (not request_variables) on the wire', async () => {
    await tool.handler(
      {
        catalog_item_id: 794451,
        request_variables: [
          { custom_field_id: 2181315, value: 'test_folder' },
          { custom_field_id: 2181363, value: 'Z:\\test\\path' },
        ],
      },
      {},
    );
    const post = client.calls.find((c) => c.type === 'post');
    expect(post).toBeDefined();
    if (!post || post.type !== 'post') throw new Error('post not captured');
    const body = post.body as Record<string, unknown>;
    expect(body).toHaveProperty('incident');
    const incident = body.incident as Record<string, unknown>;
    // request_variables on the input becomes request_variables_attributes on the wire.
    // SWSD silently drops request_variables (the read-shape name) on this endpoint.
    expect(incident).toHaveProperty('request_variables_attributes');
    expect(incident).not.toHaveProperty('request_variables');
    expect(incident.request_variables_attributes).toEqual([
      { custom_field_id: 2181315, value: 'test_folder' },
      { custom_field_id: 2181363, value: 'Z:\\test\\path' },
    ]);
  });

  it('defaults requester_email to the JWT user\'s email via GET /users/{id}.json', async () => {
    client.setUserBody({
      id: 11643235,
      email: 'jwt-user@example.com',
    });
    await tool.handler(
      {
        catalog_item_id: 794451,
        request_variables: [],
      },
      {},
    );
    const get = client.calls.find((c) => c.type === 'get');
    expect(get).toBeDefined();
    expect(get?.type === 'get' ? get.path : '').toBe('/users/11643235.json');

    const post = client.calls.find((c) => c.type === 'post');
    if (!post || post.type !== 'post') throw new Error('post not captured');
    const incident = (post.body as { incident: Record<string, unknown> }).incident;
    expect(incident.requester).toEqual({ email: 'jwt-user@example.com' });
  });

  it('uses the explicit requester_email and skips the /users lookup when provided', async () => {
    await tool.handler(
      {
        catalog_item_id: 794451,
        request_variables: [],
        requester_email: 'someone-else@example.com',
      },
      {},
    );
    // No /users GET should happen.
    expect(client.calls.find((c) => c.type === 'get')).toBeUndefined();
    const post = client.calls.find((c) => c.type === 'post');
    if (!post || post.type !== 'post') throw new Error('post not captured');
    const incident = (post.body as { incident: Record<string, unknown> }).incident;
    expect(incident.requester).toEqual({ email: 'someone-else@example.com' });
  });

  it('wraps custom_fields into the SAManage nested-wrapper shape', async () => {
    await tool.handler(
      {
        catalog_item_id: 794451,
        request_variables: [],
        custom_fields: [
          { name: 'Cost Center', value: '1001' },
          { name: 'Approval Required', value: true },
        ],
      },
      {},
    );
    const post = client.calls.find((c) => c.type === 'post');
    if (!post || post.type !== 'post') throw new Error('post not captured');
    const incident = (post.body as { incident: Record<string, unknown> }).incident;
    expect(incident.custom_fields_values).toEqual({
      custom_fields_value: [
        { name: 'Cost Center', value: '1001' },
        { name: 'Approval Required', value: true },
      ],
    });
  });

  it('passes through optional description', async () => {
    await tool.handler(
      {
        catalog_item_id: 794451,
        request_variables: [],
        description: 'Please prioritize this request.',
      },
      {},
    );
    const post = client.calls.find((c) => c.type === 'post');
    if (!post || post.type !== 'post') throw new Error('post not captured');
    const incident = (post.body as { incident: Record<string, unknown> }).incident;
    expect(incident.description).toBe('Please prioritize this request.');
  });

  it('returns structured incident output with id and url from href_account_domain', async () => {
    client.setPostResponse({
      id: 181278194,
      number: 60356,
      name: 'Data Recovery',
      is_service_request: true,
      state: 'New - Unassigned',
      href_account_domain: 'https://example.samanage.com/incidents/181278194',
    });
    const result = (await tool.handler(
      {
        catalog_item_id: 794451,
        request_variables: [],
      },
      {},
    )) as StructuredCallToolResult;
    expect(result.isError).toBeFalsy();
    const struct = result.structuredContent as ToolStructuredOutput | undefined;
    expect(struct?.incident.id).toBe(181278194);
    expect(struct?.incident.number).toBe(60356);
    expect(struct?.incident.name).toBe('Data Recovery');
    expect(struct?.incident.is_service_request).toBe(true);
    expect(struct?.incident.url).toBe(
      'https://example.samanage.com/incidents/181278194',
    );
  });

  it('summary text mentions the SR number, the catalog item id, and the count of variables', async () => {
    client.setPostResponse({
      id: 181278194,
      number: 60356,
      name: 'Data Recovery',
      is_service_request: true,
    });
    const result = (await tool.handler(
      {
        catalog_item_id: 794451,
        request_variables: [
          { custom_field_id: 2181315, value: 'a' },
          { custom_field_id: 2181363, value: 'b' },
        ],
      },
      {},
    )) as StructuredCallToolResult;
    const text = result.content?.[0]?.text ?? '';
    expect(text).toContain('60356');
    expect(text).toContain('794451');
    expect(text).toMatch(/\b2 request_variables?\b/);
  });

  it('returns a tool error when the JWT lacks user_id and no explicit requester_email is given', async () => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    client = makeFakeClient();
    registerCreateServiceRequest(
      server,
      makeCtx(client, TOKEN_WITHOUT_USER_ID),
    );
    tool = getRegisteredTool(server, 'swsd_create_service_request');

    const result = (await tool.handler(
      {
        catalog_item_id: 794451,
        request_variables: [],
      },
      {},
    )) as StructuredCallToolResult;
    expect(result.isError).toBe(true);
    const text = result.content?.[0]?.text ?? '';
    expect(text.toLowerCase()).toMatch(/user_id|user_ic|requester/);
  });

  it('returns a tool error when the SWSD POST response is non-object', async () => {
    client.setPostResponse('not an object');
    const result = (await tool.handler(
      {
        catalog_item_id: 794451,
        request_variables: [],
      },
      {},
    )) as StructuredCallToolResult;
    expect(result.isError).toBe(true);
  });

  it('returns a tool error when the SWSD POST response is missing a numeric id', async () => {
    client.setPostResponse({ number: 60356, name: 'Data Recovery' });
    const result = (await tool.handler(
      {
        catalog_item_id: 794451,
        request_variables: [],
      },
      {},
    )) as StructuredCallToolResult;
    expect(result.isError).toBe(true);
  });

  it('rejects non-positive catalog_item_id at the schema boundary', () => {
    // The zod schema's .positive() guard should reject 0 and negative ids
    // before they ever hit the API. The MCP transport runs this validation
    // before the handler is invoked; tested here directly against the
    // schema for a stable, transport-independent assertion.
    expect(
      CreateServiceRequestInput.safeParse({
        catalog_item_id: -1,
        request_variables: [],
      }).success,
    ).toBe(false);
    expect(
      CreateServiceRequestInput.safeParse({
        catalog_item_id: 0,
        request_variables: [],
      }).success,
    ).toBe(false);
    expect(
      CreateServiceRequestInput.safeParse({
        catalog_item_id: 1.5,
        request_variables: [],
      }).success,
    ).toBe(false);
    expect(
      CreateServiceRequestInput.safeParse({
        catalog_item_id: 794451,
        request_variables: [],
      }).success,
    ).toBe(true);
  });

  it('rejects request_variables entries with non-positive custom_field_id at the schema boundary', () => {
    expect(
      CreateServiceRequestInput.safeParse({
        catalog_item_id: 794451,
        request_variables: [{ custom_field_id: -1, value: 'x' }],
      }).success,
    ).toBe(false);
    expect(
      CreateServiceRequestInput.safeParse({
        catalog_item_id: 794451,
        request_variables: [{ custom_field_id: 0, value: 'x' }],
      }).success,
    ).toBe(false);
    expect(
      CreateServiceRequestInput.safeParse({
        catalog_item_id: 794451,
        request_variables: [{ custom_field_id: 2181315, value: 'x' }],
      }).success,
    ).toBe(true);
  });
});
