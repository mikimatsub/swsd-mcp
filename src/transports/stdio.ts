import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import type { Env } from '../config/env.js';
import { createMcpServer } from '../mcp/server.js';
import { createSwsdClient } from '../swsd/client.js';
import { registerTools } from '../config/toolRegistry.js';

export async function runStdio(env: Env): Promise<void> {
  if (!env.SWSD_TOKEN) {
    process.stderr.write(
      'SWSD_TOKEN environment variable is required for stdio transport.\n',
    );
    process.exit(2);
  }

  const client = createSwsdClient({ env, token: env.SWSD_TOKEN });
  const server = createMcpServer();
  const enabledTools: string[] = [];

  registerTools(server, {
    env,
    profile: env.SWSD_PROFILE,
    client,
    enabledTools,
    token: env.SWSD_TOKEN,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
