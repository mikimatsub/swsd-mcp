import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { acceptanceChecks, deploymentBranch, minimumAgeMs, promote,
  validateRelease, verifyWorkflow, writePromotionOutputs } from '../../scripts/promote-workspace-plugin.mjs';

// Relevant fields captured from the canonical repository's REST workflow-runs
// and jobs endpoints on 2026-11-15. Cases below vary documented states only.
const observedRuns = {
  'ci.yml': { id: 43790440723, head_sha: 'f8795971b4e35d7115fb9163c179a3841e85dd8a',
    head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success' },
  'security.yml': { id: 43790440799, head_sha: 'f8795971b4e35d7115fb9163c179a3841e85dd8a',
    head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success' },
};
const observedJobs = {
  'ci.yml': [
    { name: 'Windows plugin checks', status: 'completed', conclusion: 'success' },
    { name: 'Lint, typecheck, test (Node 26)', status: 'completed', conclusion: 'success' },
    { name: 'Build docs site', status: 'completed', conclusion: 'success' },
    { name: 'Lint, typecheck, test (Node 24)', status: 'completed', conclusion: 'success' },
    { name: 'Build + smoke Docker image', status: 'completed', conclusion: 'success' },
    { name: 'Publish image to ghcr.io', status: 'completed', conclusion: 'success' },
  ],
  'security.yml': [
    { name: 'CodeQL (JavaScript/TypeScript)', status: 'completed', conclusion: 'success' },
    { name: 'Secret scan (gitleaks)', status: 'completed', conclusion: 'success' },
    { name: 'OSV-Scanner (dependencies) / osv-scan', status: 'completed', conclusion: 'success' },
  ],
};
const sha = observedRuns['ci.yml'].head_sha;
const previous = 'b'.repeat(40);
const release = 'c'.repeat(40);
const pluginTree = 'd'.repeat(40);
const marketplaceBlob = 'e'.repeat(40);
const now = Date.parse('2026-11-10T12:00:00Z');
const publishedAt = now - minimumAgeMs;

function missingFileError() {
  const directory = mkdtempSync(join(tmpdir(), 'swsd-promotion-missing-'));
  try {
    readFileSync(join(directory, 'plugin-promotion.json'), 'utf8');
  } catch (error) {
    assert.equal(error.code, 'ENOENT');
    return error;
  } finally { rmdirSync(directory); }
  throw new Error('Expected the absent acceptance file to produce ENOENT.');
}

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
  missingAcceptance = false, apiFailure = false, npmFailure = false, sameVersion = false, downgrade = false,
  releaseNotAncestor = false,
  workflowResponses = {}, jobResponses = {}, acceptanceText, acceptanceError, otherReadError } = {}) {
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
      return Object.hasOwn(workflowResponses, workflow) ? workflowResponses[workflow]
        : { workflow_runs: [{ ...observedRuns[workflow] }] };
    }
    if (path.startsWith('/actions/runs/')) {
      const workflow = path.includes('/' + observedRuns['ci.yml'].id + '/') ? 'ci.yml' : 'security.yml';
      return Object.hasOwn(jobResponses, workflow) ? jobResponses[workflow]
        : { jobs: observedJobs[workflow].map(job => ({ ...job })) };
    }
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
    if (args[0] === 'merge-base') return diverged ? release
      : releaseNotAncestor && args[1] === release ? previous : args[1];
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
    if (otherReadError && path === 'package.json') throw otherReadError;
    if (path === 'plugins/swsd/scripts/Common.ps1') return f.common;
    if (path === 'plugins/swsd/.mcp.json') return f.mcp;
    if (path === '.github/plugin-promotion.json') {
      if (missingAcceptance) throw missingFileError();
      if (acceptanceError) throw acceptanceError;
      if (acceptanceText !== undefined) return acceptanceText;
    }
    return JSON.stringify(files[path]);
  };
  return { writes, fixture: f, input: { api, git, read, now, npmRegistry: async () => {
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
for (const option of ['diverged', 'race', 'apiFailure', 'npmFailure', 'sameVersion', 'downgrade', 'releaseNotAncestor']) {
  test(option + ' fails closed without a write', async () => {
    const h = harness({ [option]: true });
    await assert.rejects(promote({ ...h.input, apply: true }));
    assert.equal(h.writes.length, 0);
  });
}
for (const conclusion of ['failure', 'cancelled', 'skipped', null]) {
  test('newest workflow ' + conclusion + ' blocks older success', async () => {
    const runs = [{ ...observedRuns['ci.yml'] }, { ...observedRuns['ci.yml'],
      id: observedRuns['ci.yml'].id + 1, conclusion }];
    await assert.rejects(verifyWorkflow(async () => ({ workflow_runs: runs }), 'ci.yml', sha));
  });
}
test('a successful PR run cannot authorize main deployment', async () => {
  const result = await verifyWorkflow(async () => ({ workflow_runs: [{ ...observedRuns['ci.yml'],
    event: 'pull_request' }] }), 'ci.yml', sha);
  assert.equal(result.status, 'waiting');
});
test('skipped required job fails despite aggregate success', async () => {
  const h = harness();
  const api = async path => path.startsWith('/actions/runs/')
    ? { jobs: observedJobs['ci.yml'].map(job => ({ ...job, conclusion: job.name === 'Windows plugin checks' ? 'skipped' : 'success' })) }
    : h.input.api(path);
  await assert.rejects(verifyWorkflow(api, 'ci.yml', sha));
});

for (const apply of [false, true]) {
  const mode = apply ? 'apply' : 'check';
  for (const workflow of ['ci.yml', 'security.yml']) {
    for (const state of ['missing', 'queued', 'in_progress', 'requested', 'waiting', 'pending']) {
      test(mode + ' waits for ' + workflow + ' ' + state + ' without falling back or writing', async () => {
        const runs = state === 'missing' ? [] : [{ ...observedRuns[workflow] },
          { ...observedRuns[workflow], id: observedRuns[workflow].id + 1, status: state, conclusion: null }];
        const h = harness({ workflowResponses: { [workflow]: { workflow_runs: runs } } });

        const result = await promote({ ...h.input, apply });

        assert.equal(result.status, 'waiting');
        assert.match(result.reason, new RegExp('Awaiting ' + workflow));
        assert.match(result.reason, /exact main commit/);
        assert.equal(h.writes.length, 0);
      });
    }
    for (const conclusion of ['failure', 'cancelled', 'skipped', null]) {
      test(mode + ' rejects latest completed ' + workflow + ' ' + conclusion + ' despite older success', async () => {
        const h = harness({ workflowResponses: { [workflow]: { workflow_runs: [
          { ...observedRuns[workflow] }, { ...observedRuns[workflow], id: observedRuns[workflow].id + 1, conclusion },
        ] } } });
        await assert.rejects(promote({ ...h.input, apply }));
        assert.equal(h.writes.length, 0);
      });
    }
  }

  for (const [name, change] of [
    ['another commit', { head_sha: previous }],
    ['another branch', { head_branch: 'untrusted-branch' }],
    ['PR event', { event: 'pull_request' }],
    ['manual event', { event: 'workflow_dispatch' }],
  ]) {
    test(mode + ' waits when only a green run for ' + name + ' exists', async () => {
      const h = harness({ workflowResponses: { 'ci.yml': { workflow_runs: [
        { ...observedRuns['ci.yml'], ...change },
      ] } } });
      assert.equal((await promote({ ...h.input, apply })).status, 'waiting');
      assert.equal(h.writes.length, 0);
    });
  }

  for (const failedWorkflow of ['ci.yml', 'security.yml']) {
    test(mode + ' does not hide failed ' + failedWorkflow + ' while the other workflow is pending', async () => {
      const pendingWorkflow = failedWorkflow === 'ci.yml' ? 'security.yml' : 'ci.yml';
      const h = harness({ workflowResponses: {
        [failedWorkflow]: { workflow_runs: [{ ...observedRuns[failedWorkflow], conclusion: 'failure' }] },
        [pendingWorkflow]: { workflow_runs: [{ ...observedRuns[pendingWorkflow], status: 'in_progress', conclusion: null }] },
      } });
      await assert.rejects(promote({ ...h.input, apply }));
      assert.equal(h.writes.length, 0);
    });
  }

  test(mode + ' waits only for real missing acceptance ENOENT without writing', async () => {
    const h = harness({ missingAcceptance: true });
    const result = await promote({ ...h.input, apply });
    assert.equal(result.status, 'waiting');
    assert.match(result.reason, /actual clean-Windows-user and workspace-policy acceptance/);
    assert.match(result.reason, /\.github\/plugin-promotion\.json/);
    assert.equal(h.writes.length, 0);
  });

  for (const [name, text] of [
    ['empty', ''], ['malformed', '{'], ['JSON null', 'null'], ['incomplete', '{}'],
    ['mismatched', JSON.stringify({ ...fixture().acceptance, pluginTree: previous })],
    ['unpassed', JSON.stringify({ ...fixture().acceptance, checks: {} })],
  ]) {
    test(mode + ' rejects present ' + name + ' acceptance instead of waiting', async () => {
      const h = harness({ acceptanceText: text });
      await assert.rejects(promote({ ...h.input, apply }));
      assert.equal(h.writes.length, 0);
    });
  }

  for (const code of ['EACCES', 'EIO', undefined]) {
    test(mode + ' rejects acceptance read error ' + code + ' without writing', async () => {
      const error = new Error('Fixture acceptance read error.');
      if (code) error.code = code;
      const h = harness({ acceptanceError: error });
      await assert.rejects(promote({ ...h.input, apply }));
      assert.equal(h.writes.length, 0);
    });
  }

  test(mode + ' does not treat ENOENT from another metadata file as missing acceptance', async () => {
    const h = harness({ otherReadError: missingFileError() });
    await assert.rejects(promote({ ...h.input, apply }));
    assert.equal(h.writes.length, 0);
  });

  for (const [name, change] of [
    ['version', h => { h.fixture.root.version = '3.4.0'; }],
    ['integrity', h => { h.fixture.registry.versions['3.4.1'].dist.integrity = 'sha512-other'; }],
    ['publication age', h => { h.input.now--; }],
    ['ancestry', h => { const git = h.input.git; h.input.git = (...args) =>
      args[0] === 'merge-base' && args[1] === release ? previous : git(...args); }],
    ['npm outage', h => { h.input.npmRegistry = async () => { throw new Error('npm unavailable'); }; }],
  ]) {
    test(mode + ' still rejects ' + name + ' when acceptance is absent', async () => {
      const h = harness({ missingAcceptance: true });
      change(h);
      await assert.rejects(promote({ ...h.input, apply }));
      assert.equal(h.writes.length, 0);
    });
  }

  for (const [name, response] of [
    ['missing run list', {}], ['invalid run list', { workflow_runs: {} }],
    ['invalid run row', { workflow_runs: [{}] }],
    ['unknown state', { workflow_runs: [{ ...observedRuns['ci.yml'], status: 'unknown', conclusion: null }] }],
    ['nonterminal with a conclusion', { workflow_runs: [{ ...observedRuns['ci.yml'], status: 'queued' }] }],
  ]) {
    test(mode + ' rejects malformed workflow response: ' + name, async () => {
      const h = harness({ workflowResponses: { 'ci.yml': response } });
      await assert.rejects(promote({ ...h.input, apply }));
      assert.equal(h.writes.length, 0);
    });
  }

  for (const conclusion of ['failure', 'cancelled', 'skipped', null]) {
    test(mode + ' rejects required job ' + conclusion + ' despite aggregate workflow success', async () => {
      const h = harness({ jobResponses: { 'ci.yml': { jobs: observedJobs['ci.yml'].map(job =>
        job.name === 'Windows plugin checks' ? { ...job, conclusion } : { ...job }) } } });
      await assert.rejects(promote({ ...h.input, apply }));
      assert.equal(h.writes.length, 0);
    });
  }
  test(mode + ' rejects an incomplete required job despite its success conclusion', async () => {
    const h = harness({ jobResponses: { 'ci.yml': { jobs: observedJobs['ci.yml'].map(job =>
      job.name === 'Windows plugin checks' ? { ...job, status: 'in_progress' } : { ...job }) } } });
    await assert.rejects(promote({ ...h.input, apply }));
    assert.equal(h.writes.length, 0);
  });
}

function outputFiles(t) {
  const directory = mkdtempSync(join(tmpdir(), 'swsd-promotion-output-'));
  const outputPath = join(directory, 'output');
  const summaryPath = join(directory, 'summary');
  t.after(() => {
    rmSync(outputPath, { force: true });
    rmSync(summaryPath, { force: true });
    rmdirSync(directory);
  });
  return { outputPath, summaryPath };
}

for (const awaiting of ['workflow', 'acceptance']) {
  test('waiting for ' + awaiting + ' appends eligible=false and an explicit non-deployment summary', async t => {
    const h = harness(awaiting === 'workflow'
      ? { workflowResponses: { 'ci.yml': { workflow_runs: [] } } }
      : { missingAcceptance: true });
    const result = await promote({ ...h.input, apply: true });
    const paths = outputFiles(t);
    writeFileSync(paths.outputPath, 'existing=true\n');
    writeFileSync(paths.summaryPath, '# Existing summary\n');

    writePromotionOutputs(result, paths);

    assert.equal(readFileSync(paths.outputPath, 'utf8'), 'existing=true\neligible=false\nstatus=waiting\n');
    const summary = readFileSync(paths.summaryPath, 'utf8');
    assert.ok(summary.startsWith('# Existing summary\n'));
    assert.ok(summary.includes(result.reason));
    assert.match(summary, /No deployment branch update was made/);
    assert.match(summary, /Workspace sync and delivery to a local desktop have not been verified/);
    assert.equal(h.writes.length, 0);
  });
}

test('eligible output is true only after all release, check and actual acceptance gates passed', async t => {
  const h = harness();
  const result = await promote(h.input);
  const paths = outputFiles(t);
  writePromotionOutputs(result, paths);
  assert.equal(readFileSync(paths.outputPath, 'utf8'), 'eligible=true\nstatus=eligible\n');
  assert.match(readFileSync(paths.summaryPath, 'utf8'), /This check did not update the deployment branch/);
  assert.equal(h.writes.length, 0);
});

for (const status of ['unchanged', 'promoted']) {
  test(status + ' output is not eligible and does not claim workspace delivery', t => {
    const paths = outputFiles(t);
    writePromotionOutputs({ status, sha, version: '3.4.1' }, paths);
    assert.equal(readFileSync(paths.outputPath, 'utf8'), 'eligible=false\nstatus=' + status + '\n');
    assert.match(readFileSync(paths.summaryPath, 'utf8'), /Workspace sync and delivery to a local desktop have not been verified/);
  });
}
