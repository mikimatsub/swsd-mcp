import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repository = 'mikimatsub/swsd-mcp';
export const deploymentBranch = 'codex/windows-plugin-setup';
export const minimumAgeMs = 3 * 24 * 60 * 60 * 1000;
export const acceptanceChecks = [
  'freshUserInstall', 'setupWithoutToken', 'installAndShortcut',
  'privateTokenAndConnection', 'restartAndHealth', 'identityAndRead',
  'profilesAndSavedToken', 'replacementAndRemoval', 'workspacePolicy',
];
export const requiredJobs = {
  'ci.yml': [
    'Windows plugin checks',
    'Lint, typecheck, test (Node 24)',
    'Lint, typecheck, test (Node 26)',
    'Build docs site', 'Build + smoke Docker image', 'Publish image to ghcr.io',
  ],
  'security.yml': [
    'Secret scan (gitleaks)', 'CodeQL (JavaScript/TypeScript)',
    'OSV-Scanner (dependencies) / osv-scan',
  ],
};

const requireThat = (condition, message) => {
  if (!condition) throw new Error(message);
};
const shaPattern = /^[a-f0-9]{40}$/;
const versionPattern = /^\d+\.\d+\.\d+$/;

// Pure policy function: no API calls, installations or writes.
export function validateRelease({ root, plugin, recipe, lock, common, mcp, acceptance,
  pluginTree, marketplaceBlob, registry, releaseCommit, now }) {
  const pin = recipe.dependencies?.['swsd-mcp'];
  requireThat(versionPattern.test(pin), 'Runtime must have an exact stable version.');
  requireThat(root.version === pin && recipe.version === pin, 'Root and recipe must match the published release.');
  const installed = lock.packages?.['node_modules/swsd-mcp'];
  requireThat(lock.packages?.['']?.dependencies?.['swsd-mcp'] === pin &&
    installed?.version === pin, 'Runtime lock does not match the pin.');
  const variable = name => new RegExp("\\$script:" + name + " = '([^']+)'").exec(common)?.[1];
  requireThat(variable('SwsdPackageVersion') === pin, 'Setup runtime version does not match.');
  requireThat(versionPattern.test(plugin.version) &&
    variable('SwsdClientVersion') === plugin.version &&
    mcp.includes('swsd-mcp/client/' + plugin.version + '/Start-Swsd.ps1'),
  'Plugin client versions do not match.');

  const published = registry.versions?.[pin];
  requireThat(registry['dist-tags']?.latest === pin && published?.version === pin,
    'Runtime must be the current published npm release.');
  requireThat(installed.resolved === 'https://registry.npmjs.org/swsd-mcp/-/swsd-mcp-' + pin + '.tgz' &&
    /^sha512-/.test(installed.integrity) && installed.integrity === published.dist?.integrity,
  'Published runtime integrity does not match the lock.');
  requireThat(shaPattern.test(releaseCommit) && published.gitHead === releaseCommit,
    'npm release commit does not match the immutable release tag.');
  const publishedAt = Date.parse(registry.time?.[pin]);
  requireThat(Number.isFinite(publishedAt) && now - publishedAt >= minimumAgeMs,
    'Published runtime has not passed the three-day minimum age gate.');

  requireThat(acceptance?.schemaVersion === 1 && acceptance.pluginTree === pluginTree &&
    acceptance.marketplaceBlob === marketplaceBlob && acceptance.clientVersion === plugin.version &&
    acceptance.runtimeVersion === pin, 'Missing acceptance record for this exact plugin and marketplace.');
  requireThat(acceptanceChecks.every(check => acceptance.checks?.[check] === true),
    'All clean-Windows-user and workspace-policy acceptance checks must be recorded as passed.');
  const checkedAt = Date.parse(acceptance.checkedAt);
  requireThat(Number.isFinite(checkedAt) && checkedAt >= publishedAt && checkedAt <= now &&
    typeof acceptance.evidence === 'string' && acceptance.evidence.trim().length > 0,
  'Acceptance needs a valid post-publication date and a non-sensitive evidence reference.');
  return pin;
}

export async function verifyWorkflow(api, workflow, sha) {
  const result = await api('/actions/workflows/' + workflow +
    '/runs?branch=main&head_sha=' + sha + '&per_page=100');
  // A newer failed, queued or rerunning run must not be hidden by an older success.
  const runs = result.workflow_runs.filter(run => run.head_sha === sha && run.head_branch === 'main' &&
    ['push', 'schedule'].includes(run.event)).sort((a, b) => b.id - a.id);
  const latest = runs[0];
  requireThat(latest?.status === 'completed' && latest.conclusion === 'success',
    workflow + ' has no successful latest run for the exact main commit.');
  const jobs = [];
  for (let page = 1; ; page++) {
    const result = await api('/actions/runs/' + latest.id +
      '/jobs?filter=latest&per_page=100&page=' + page);
    jobs.push(...result.jobs);
    if (result.jobs.length < 100) break;
  }
  for (const name of requiredJobs[workflow]) {
    requireThat(jobs.some(job => job.name === name && job.conclusion === 'success'),
      workflow + ': missing or unsuccessful required job: ' + name);
  }
}

export async function promote({ api, git, read, npmRegistry, now = Date.now(), apply = false }) {
  const sha = git('rev-parse', 'HEAD');
  requireThat(shaPattern.test(sha), 'Invalid candidate commit.');
  const main = await api('/git/ref/heads/main');
  if (main.object.sha !== sha) return { status: 'waiting', reason: 'Main advanced; waiting for its checks.' };
  const deployed = await api('/git/ref/heads/' + deploymentBranch);
  requireThat(shaPattern.test(deployed.object.sha), 'Invalid deployment commit.');
  if (deployed.object.sha === sha) return { status: 'unchanged', sha };
  // Checkout fetches history but never executes deployment-branch code.
  const tree = ref => git('rev-parse', ref + ':plugins/swsd');
  const marketplace = ref => git('rev-parse', ref + ':.agents/plugins/marketplace.json');
  const pluginTree = tree(sha);
  const marketplaceBlob = marketplace(sha);
  if (tree(deployed.object.sha) === pluginTree && marketplace(deployed.object.sha) === marketplaceBlob) {
    return { status: 'unchanged', reason: 'No plugin or marketplace changes.' };
  }
  requireThat(git('merge-base', deployed.object.sha, sha) === deployed.object.sha,
    'Deployment branch diverged; refusing a non-fast-forward update.');
  for (const workflow of Object.keys(requiredJobs)) await verifyWorkflow(api, workflow, sha);
  const json = path => JSON.parse(read(path));
  const plugin = json('plugins/swsd/.codex-plugin/plugin.json');
  if (tree(deployed.object.sha) !== pluginTree) {
    const previous = JSON.parse(git('show', deployed.object.sha + ':plugins/swsd/.codex-plugin/plugin.json'));
    requireThat(versionPattern.test(previous.version) && versionPattern.test(plugin.version),
      'Both deployed and candidate client versions must be stable semantic versions.');
    const oldParts = previous.version.split('.').map(BigInt);
    const newParts = plugin.version.split('.').map(BigInt);
    const firstDifference = newParts.findIndex((part, i) => part !== oldParts[i]);
    requireThat(firstDifference >= 0 && newParts[firstDifference] > oldParts[firstDifference],
      'Changed plugin files require a higher client version than the deployed plugin.');
  }
  const recipe = json('plugins/swsd/runtime/package.json');
  const version = recipe.dependencies?.['swsd-mcp'];
  requireThat(versionPattern.test(version), 'Invalid runtime pin.');
  const releaseCommit = git('rev-parse', 'refs/tags/v' + version + '^{commit}');
  requireThat(git('merge-base', releaseCommit, sha) === releaseCommit,
    'Release tag is not an ancestor of the candidate.');
  const pin = validateRelease({
    root: json('package.json'), plugin,
    recipe, lock: json('plugins/swsd/runtime/package-lock.json'),
    common: read('plugins/swsd/scripts/Common.ps1'), mcp: read('plugins/swsd/.mcp.json'),
    acceptance: json('.github/plugin-promotion.json'),
    pluginTree, marketplaceBlob, registry: await npmRegistry(), releaseCommit, now,
  });
  if (!apply) return { status: 'eligible', sha, version: pin };
  // Recheck both refs after the network checks. GitHub independently rejects non-FF writes.
  const currentMain = await api('/git/ref/heads/main');
  const currentDeployment = await api('/git/ref/heads/' + deploymentBranch);
  requireThat(currentMain.object.sha === sha && currentDeployment.object.sha === deployed.object.sha,
    'A branch changed during verification; retry with fresh checks.');
  await api('/git/refs/heads/' + deploymentBranch, { method: 'PATCH', body: { sha, force: false } });
  const confirmed = await api('/git/ref/heads/' + deploymentBranch);
  requireThat(confirmed.object.sha === sha, 'Promotion write was not confirmed; inspect the branch before retrying.');
  return { status: 'promoted', sha, version: pin };
}

async function main() {
  requireThat(process.env.GITHUB_REPOSITORY === repository, 'Promotion is restricted to the canonical repository.');
  requireThat(process.argv.slice(2).every(arg => ['--apply', '--check'].includes(arg)), 'Unexpected argument.');
  const token = process.env.GH_TOKEN;
  requireThat(token, 'GH_TOKEN is required.');
  const api = async (path, options = {}) => {
    const response = await fetch('https://api.github.com/repos/' + repository + path, {
      method: options.method || 'GET',
      headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'content-type': 'application/json' },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    requireThat(response.ok, 'GitHub request failed (' + response.status + ') for ' + path + '.');
    return response.json();
  };
  const result = await promote({
    api,
    git: (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim(),
    read: path => readFileSync(path, 'utf8'),
    npmRegistry: async () => {
      const response = await fetch('https://registry.npmjs.org/swsd-mcp', { signal: AbortSignal.timeout(30000) });
      requireThat(response.ok, 'npm registry lookup failed (' + response.status + ').');
      return response.json();
    },
    apply: process.argv.includes('--apply'),
  });
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_OUTPUT, 'eligible=' + (result.status === 'eligible') + '\n');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
