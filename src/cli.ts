#!/usr/bin/env node
import { parseEnv, type TransportName } from './config/env.js';
import { runStdio } from './transports/stdio.js';
import { runHttp } from './transports/http.js';

function parseArgs(argv: string[]): { transport?: TransportName } {
  const out: { transport?: TransportName } = {};
  for (const arg of argv) {
    if (arg.startsWith('--transport=')) {
      const v = arg.slice('--transport='.length);
      if (v === 'stdio' || v === 'http') {
        out.transport = v;
      } else {
        process.stderr.write(`Unknown --transport value: ${v}. Use stdio or http.\n`);
        process.exit(2);
      }
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        'Usage: swsd-mcp [--transport=stdio|http]\n\n' +
          'Environment variables (see .env.example for full list):\n' +
          '  SWSD_TOKEN          (required for stdio)\n' +
          '  SWSD_BASE_URL       (default https://api.samanage.com)\n' +
          '  SWSD_TRANSPORT      stdio | http (default stdio)\n' +
          '  SWSD_PROFILE        triage | agent | knowledge | operations | full (default agent)\n' +
          '  SWSD_WRITE_MODE     live | dry-run | disabled (default live)\n' +
          '  PORT                (http transport, default 3000)\n',
      );
      process.exit(0);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const env = parseEnv(process.env);
  const args = parseArgs(process.argv.slice(2));
  const transport = args.transport ?? env.SWSD_TRANSPORT;

  if (transport === 'stdio') {
    await runStdio(env);
  } else {
    await runHttp(env);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
