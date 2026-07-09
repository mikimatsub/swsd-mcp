import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from '../../../../src/config/toolRegistry.js';
import type {
  Env,
} from '../../../../src/config/env.js';
import type {
  SwsdClient,
  SwsdGetResult,
  SwsdMutationResult,
  SwsdRawResult,
  SwsdRequestInit,
} from '../../../../src/swsd/client.js';

/**
 * Shared test fixtures for `tests/unit/tools/*.test.ts`.
 *
 * The 8+ tool tests added in v2.1.0 (Tasks 2 + 3) all need the same
 * scaffolding: a fake SwsdClient that captures calls, an McpServer wrapper,
 * a ToolContext factory, and access to the SDK-internal _registeredTools map
 * to invoke the handler under test. Extracting these here keeps each test
 * file focused on the call-shape assertions.
 *
 * Surface:
 *   - `makeFakeClient()` — returns a `FakeClient` that captures every
 *     `get`/`post`/`put` call. Bodies are configured per-path via
 *     `setBodyForPath` (precise) or globally via `setLookupBody` /
 *     `setPostResponse` / `setPutResponse` (convenience for the common
 *     "one GET / one mutation" tool shape).
 *   - `makeCtx(client)` — wraps a SwsdClient in a ToolContext with stubbed
 *     env/profile fields the handlers don't actually read.
 *   - `getRegisteredTool(server, name)` — pulls the registered tool out of
 *     the McpServer's private registry so the test can invoke its handler
 *     directly (the public McpServer API doesn't expose handlers for
 *     in-process testing).
 */

interface RegisteredToolInternals {
  description?: string;
  annotations?: Record<string, unknown>;
  inputSchema?: unknown;
  handler: (input: unknown, extra: unknown) => Promise<unknown>;
}

interface McpServerInternals {
  _registeredTools: Record<string, RegisteredToolInternals>;
}

export type { RegisteredToolInternals };

export interface CapturedGet {
  type: 'get';
  path: string;
  params: Record<string, unknown>;
}

export interface CapturedPost {
  type: 'post';
  path: string;
  body: unknown;
}

export interface CapturedPut {
  type: 'put';
  path: string;
  body: unknown;
}

export interface CapturedRaw {
  type: 'raw';
  path: string;
  init: SwsdRequestInit;
}

export type CapturedCall = CapturedGet | CapturedPost | CapturedPut | CapturedRaw;

export interface FakeClient extends SwsdClient {
  /** Every captured call, in order. */
  calls: CapturedCall[];
  /**
   * Configure a GET response body for paths matching `matcher`. Last matcher
   * registered for a path wins (most-recent-first), matching the order tests
   * expect when stacking responders. If no matcher matches, the GET returns
   * `defaultGetBody`.
   */
  setBodyForPath: (matcher: (path: string) => boolean, body: unknown) => void;
  /** Set the default GET response body (for tests that don't care about path). */
  setLookupBody: (body: unknown) => void;
  /** Set the response body for any POST call. */
  setPostResponse: (body: unknown) => void;
  /** Set the response body for any PUT call. */
  setPutResponse: (body: unknown) => void;
  /** Set the response body/status for any rawRequest call. */
  setRawResponse: (body: unknown, status?: number) => void;
}

/**
 * Build a fake SwsdClient that records every call. Defaults:
 *   - GET returns `[]` unless `setLookupBody` or `setBodyForPath` overrides
 *   - POST returns `null` (override with `setPostResponse`)
 *   - PUT returns `null` (override with `setPutResponse`)
 *   - rawRequest returns `null` (override with `setRawResponse`)
 *
 * `setBodyForPath` matchers take precedence over `setLookupBody` — when a
 * matcher returns true for the requested path, that body is used; otherwise
 * the default lookup body is returned. This lets tests configure both
 * "any GET returns the lookup body" (the simple case) AND "different bodies
 * for different paths" (the resolver-then-fetch case) without two helpers.
 */
export function makeFakeClient(): FakeClient {
  const calls: CapturedCall[] = [];
  const responders: Array<{ matcher: (p: string) => boolean; body: unknown }> = [];
  let defaultGetBody: unknown = [];
  let postResponse: unknown = null;
  let putResponse: unknown = null;
  let rawResponse: unknown = null;
  let rawStatus = 200;

  const get = async <T>(
    path: string,
    params: Record<string, unknown> = {},
  ): Promise<SwsdGetResult<T>> => {
    calls.push({ type: 'get', path, params });
    const responder = responders.find((r) => r.matcher(path));
    const body = responder ? responder.body : defaultGetBody;
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

  const post = async <T>(
    path: string,
    body: unknown,
  ): Promise<SwsdMutationResult<T>> => {
    calls.push({ type: 'post', path, body });
    return {
      body: postResponse as T,
      headers: new Headers(),
      status: 201,
    };
  };

  const put = async <T>(
    path: string,
    body: unknown,
  ): Promise<SwsdMutationResult<T>> => {
    calls.push({ type: 'put', path, body });
    return {
      body: putResponse as T,
      headers: new Headers(),
      status: 200,
    };
  };

  const rawRequest = async (
    path: string,
    init: SwsdRequestInit,
  ): Promise<SwsdRawResult> => {
    calls.push({ type: 'raw', path, init });
    return {
      body: rawResponse,
      headers: new Headers(),
      status: rawStatus,
    };
  };

  return {
    calls,
    setBodyForPath: (matcher, body) => {
      responders.push({ matcher, body });
    },
    setLookupBody: (body: unknown) => {
      defaultGetBody = body;
    },
    setPostResponse: (body: unknown) => {
      postResponse = body;
    },
    setPutResponse: (body: unknown) => {
      putResponse = body;
    },
    setRawResponse: (body: unknown, status = 200) => {
      rawResponse = body;
      rawStatus = status;
    },
    get,
    post,
    put,
    rawRequest,
  } as unknown as FakeClient;
}

/**
 * Build a minimal ToolContext for handler invocation. The non-client fields
 * are stubbed because no tool handler under test reads them — they exist on
 * ToolContext for the registry's bookkeeping, not for the handler itself.
 */
export function makeCtx(client: SwsdClient, env: Partial<Env> = {}): ToolContext {
  return {
    client,
    profile: 'agent',
    env: {
      SWSD_WRITE_MODE: 'live',
      SWSD_TRANSPORT: 'stdio',
      ...env,
    } as Env,
    enabledTools: [],
    token: '',
  } satisfies ToolContext;
}

/**
 * Pull the registered tool out of the McpServer's private `_registeredTools`
 * map. The public SDK API doesn't expose registered handlers for in-process
 * invocation, so tests reach into the internals.
 */
export function getRegisteredTool(server: McpServer, name: string): RegisteredToolInternals {
  const internals = server as unknown as McpServerInternals;
  const t = internals._registeredTools[name];
  if (!t) throw new Error(`Tool ${name} not registered`);
  return t;
}
