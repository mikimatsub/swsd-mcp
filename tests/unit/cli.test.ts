import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnvSchema } from '../../src/config/env.js';
import type * as EnvModule from '../../src/config/env.js';
import { runHttp } from '../../src/transports/http.js';
import { runStdio } from '../../src/transports/stdio.js';

vi.mock('../../src/transports/http.js', () => ({ runHttp: vi.fn() }));
vi.mock('../../src/transports/stdio.js', () => ({ runStdio: vi.fn() }));
vi.mock('../../src/config/env.js', async (importOriginal) => ({
  ...await importOriginal<typeof EnvModule>(), parseEnv: vi.fn(),
}));

afterEach(() => { vi.resetAllMocks(); });

describe('CLI transport resolution', () => {
  it.each([
    ['stdio', 'http'], ['http', 'stdio'], ['http', undefined],
  ])('propagates env %s and CLI %s into the selected transport context', async (envTransport, cliTransport) => {
    vi.resetModules();
    const { parseEnv } = await import('../../src/config/env.js');
    vi.mocked(parseEnv).mockReturnValue(EnvSchema.parse({ SWSD_TRANSPORT: envTransport }));
    const argv = process.argv;
    try {
      process.argv = ['node', 'swsd-mcp', ...(cliTransport ? [`--transport=${cliTransport}`] : [])];
      await import('../../src/cli.js');
      const selected = cliTransport ?? envTransport;
      expect(selected === 'http' ? runHttp : runStdio).toHaveBeenCalledWith(expect.objectContaining({ SWSD_TRANSPORT: selected }));
      expect(selected === 'http' ? runStdio : runHttp).not.toHaveBeenCalled();
    } finally {
      process.argv = argv;
    }
  });
});
