import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { acceptanceChecks, deploymentBranch, minimumAgeMs, promote, requiredJobs,
  validateRelease, verifyWorkflow } from '../../scripts/promote-workspace-plugin.mjs';

const sha = 'a'.repeat(40);
const previous = 'b'.repeat(40);
const release = 'c'.repeat(40);
const pluginTree = 'd'.repeat(40);
const marketplaceBlob = 'e'.repeat(40);
const now = Date.parse('2026-11-10T12:00:00Z');
const publishedAt = now - minimumAgeMs;
function fixture() {
  return {
    root: { version: '3.4.1' }, plugin: { version: '3.4.1' },
    recipe: { version: '3.4.1', dependencies: { 'swsd-mcp': '3.4.1' } },
    lock: { packages: {
      '': { dependencies: { 'swsd-mcp': '3.4.1' } },
      'node_modules/swsd-mcp': { version: '3.4.1', integrity: 'sha512-fixture',
        resolved: 'https://registry.npmjs.org/swsd-mcp/-/swsd-mcp-3.4.1.tgz' },
    } },
    common: "$script:SwsdPackageVersion = '3.4.1'\n$script:SwsdClientVersion = '3.4.1'",
    mcp: 'swsd-mcp/client/3.4.1/Start-Swsd.ps1', pluginTree, marketplaceBlob,
    acceptance: { schemaVersion: 1, pluginTree, marketplaceBlob, clientVersion: '3.4.1',
      runtimeVersion: '3.4.1', checkedAt: new Date(now).toISOString(),
      evidence: 'Maintainer pilot report for fixture build.',
      checks: Object.fromEntries(acceptanceChecks.map(check => [check, true])) },
    registry: { 'dist-tags': { latest: '3.4.1' },
      versions: { '3.4.1': { version: '3.4.1', gitHead: release, dist: { integrity: 'sha512-fixture' } } },
      time: { '3.4.1': new Date(publishedAt).toISOString() } },
    releaseCommit: release, now,
  };
}

test('accepts exact published, aged, tested plugin at the three-day boundary', () => {
  assert.equal(validateRelease(fixture()), '3.4.1');
});

for (const [name, change] of [
  ['unpinned runtime', f => { f.recipe.dependencies['swsd-mcp'] = '^3.4.1'; }],
  ['root mismatch', f => { f.root.version = '3.4.2'; }],
  ['recipe mismatch', f => { f.recipe.version = '3.4.0'; }],
  ['lock mismatch', f => { f.lock.packages['node_modules/swsd-mcp'].version = '3.4.0'; }],
  ['missing lock integrity', f => { delete f.lock.packages['node_modules/swsd-mcp'].integrity; }],
  ['untrusted tarball URL', f => { f.lock.packages['node_modules/swsd-mcp'].resolved = 'https://example.com/a.tgz'; }],
  ['integrity mismatch', f => { f.registry.versions['3.4.1'].dist.integrity = 'sha512-other'; }],
  ['setup mismatch', f => { f.common = f.common.replace("SwsdPackageVersion = '3.4.1'", "SwsdPackageVersion = '3.4.0'"); }],
  ['client mismatch', f => { f.plugin.version = '3.4.0'; }],
  ['launcher mismatch', f => { f.mcp = 'swsd-mcp/client/3.4.0/Start-Swsd.ps1'; }],
  ['npm latest mismatch', f => { f.registry['dist-tags'].latest = '3.4.2'; }],
  ['unpublished package', f => { delete f.registry.versions['3.4.1']; }],
  ['release tag mismatch', f => { f.releaseCommit = previous; }],
  ['package younger than three days', f => { f.now--; }],
  ['missing publication date', f => { delete f.registry.time['3.4.1']; }],
  ['missing acceptance', f => { delete f.acceptance; }],
  ['changed plugin tree', f => { f.pluginTree = previous; }],
  ['changed marketplace', f => { f.marketplaceBlob = previous; }],
  ['acceptance for another runtime', f => { f.acceptance.runtimeVersion = '3.4.0'; }],
  ['acceptance before publication', f => { f.acceptance.checkedAt = new Date(publishedAt - 1).toISOString(); }],
  ['future acceptance', f => { f.acceptance.checkedAt = new Date(now + 1).toISOString(); }],
  ['missing acceptance evidence', f => { f.acceptance.evidence = ' '; }],
  ...acceptanceChecks.map(check => ['unpassed acceptance: ' + check, f => { f.acceptance.checks[check] = false; }]),
]) {
  test('rejects ' + name, () => {
    const input = fixture();
    change(input);
    assert.throws(() => validateRelease(input));
  });
}

function harness({ samePlugin = false, diverged = false, advanced = false, race = false,
  missingAcceptance = false, apiFailure = false, npmFailure = false, sameVersion = false, downgrade = false } = {}) {
  const f = fixture();
  const writes = [];
  let deployment = previous;
  let mainReads = 0;
  const api = async (path, options) => {
    if (apiFailure) throw new Error('GitHub unavailable');
    if (path === '/git/ref/heads/main') {
      mainReads++;
      return { object: { sha: advanced || (race && mainReads > 1) ? previous : sha } };
    }
    if (path === '/git/ref/heads/' + deploymentBranch) return { object: { sha: deployment } };
    if (path.startsWith('/actions/workflows/')) {
      const workflow = path.includes('security.yml') ? 'security.yml' : 'ci.yml';
      return { workflow_runs: [{ id: workflow === 'ci.yml' ? 1 : 2, head_sha: sha,
        head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success' }] };
    }
    if (path.startsWith('/actions/runs/')) return { jobs: requiredJobs[path.includes('/1/') ? 'ci.yml' : 'security.yml']
      .map(name => ({ name, conclusion: 'success' })) };
    if (options?.method === 'PATCH') {
      assert.equal(path, '/git/refs/heads/' + deploymentBranch);
      writes.push(options);
      deployment = options.body.sha;
      return { object: { sha: deployment } };
    }
    throw new Error('Unexpected API path: ' + path);
  };
  const git = (...args) => {
    if (args[0] === 'show') return JSON.stringify({ version: sameVersion ? '3.4.1' : downgrade ? '3.5.0' : '3.4.0' });
    if (args[0] === 'merge-base') return diverged ? release : args[1];
    if (args[1] === 'HEAD') return sha;
    if (args[1] === 'refs/tags/v3.4.1^{commit}') return release;
    if (args[1] === sha + ':plugins/swsd') return pluginTree;
    if (args[1] === previous + ':plugins/swsd') return samePlugin ? pluginTree : previous;
    if (args[1].endsWith(':.agents/plugins/marketplace.json')) return marketplaceBlob;
    throw new Error('Unexpected git invocation: ' + args.join(' '));
  };
  const files = {
    'package.json': f.root, 'plugins/swsd/.codex-plugin/plugin.json': f.plugin,
    'plugins/swsd/runtime/package.json': f.recipe, 'plugins/swsd/runtime/package-lock.json': f.lock,
    '.github/plugin-promotion.json': f.acceptance,
  };
  const read = path => {
    if (path === 'plugins/swsd/scripts/Common.ps1') return f.common;
    if (path === 'plugins/swsd/.mcp.json') return f.mcp;
    if (missingAcceptance && path === '.github/plugin-promotion.json') throw new Error('Missing acceptance file');
    return JSON.stringify(files[path]);
  };
  return { writes, input: { api, git, read, now, npmRegistry: async () => {
    if (npmFailure) throw new Error('npm unavailable');
    return f.registry;
  } } };
}

test('check mode never writes', async () => {
  const h = harness();
  assert.equal((await promote(h.input)).status, 'eligible');
  assert.equal(h.writes.length, 0);
});
test('promotion writes only the exact checked commit, fast-forward only, and verifies afterward', async () => {
  const h = harness();
  assert.deepEqual(await promote({ ...h.input, apply: true }), { status: 'promoted', sha, version: '3.4.1' });
  assert.deepEqual(h.writes, [{ method: 'PATCH', body: { sha, force: false } }]);
});
test('unchanged plugin needs no new acceptance and never writes', async () => {
  const h = harness({ samePlugin: true, missingAcceptance: true });
  assert.equal((await promote({ ...h.input, apply: true })).status, 'unchanged');
  assert.equal(h.writes.length, 0);
});
test('stale candidate waits without writing', async () => {
  const h = harness({ advanced: true });
  assert.equal((await promote({ ...h.input, apply: true })).status, 'waiting');
  assert.equal(h.writes.length, 0);
});
for (const option of ['diverged', 'race', 'missingAcceptance', 'apiFailure', 'npmFailure', 'sameVersion', 'downgrade']) {
  test(option + ' fails closed without a write', async () => {
    const h = harness({ [option]: true });
    await assert.rejects(promote({ ...h.input, apply: true }));
    assert.equal(h.writes.length, 0);
  });
}
for (const conclusion of ['failure', 'cancelled', 'skipped', null]) {
  test('newest workflow ' + conclusion + ' blocks older success', async () => {
    const runs = [1, 2].map(id => ({ id, head_sha: sha, head_branch: 'main', event: 'push',
      status: id === 2 && conclusion === null ? 'in_progress' : 'completed',
      conclusion: id === 1 ? 'success' : conclusion }));
    await assert.rejects(verifyWorkflow(async () => ({ workflow_runs: runs }), 'ci.yml', sha));
  });
}
test('a successful PR run cannot authorize main deployment', async () => {
  await assert.rejects(verifyWorkflow(async () => ({ workflow_runs: [{ id: 1,
    head_sha: sha, head_branch: 'main', event: 'pull_request', status: 'completed', conclusion: 'success' }] }), 'ci.yml', sha));
});
test('skipped required job fails despite aggregate success', async () => {
  const h = harness();
  const api = async path => path.startsWith('/actions/runs/')
    ? { jobs: requiredJobs['ci.yml'].map(name => ({ name, conclusion: name === 'Windows plugin checks' ? 'skipped' : 'success' })) }
    : h.input.api(path);
  await assert.rejects(verifyWorkflow(api, 'ci.yml', sha));
});
