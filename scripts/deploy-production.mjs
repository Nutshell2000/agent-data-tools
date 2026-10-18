import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const execute = promisify(execFile);
const worker = 'agent-data-tools';
const wrangler = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

export async function runCommand(binary, args, cwd = root) {
  try { return (await execute(binary, args, { cwd, maxBuffer: 2 * 1024 * 1024 })).stdout; }
  catch { throw new Error(`Production command failed: ${binary === 'git' ? 'git' : binary === 'gh' ? 'GitHub checks' : 'Wrangler'}. No automatic retry. Inspect current production state before attempting another deployment.`); }
}

export async function checkRepository(run = runCommand) {
  if ((await run('git', ['status', '--porcelain'])).trim()) throw new Error('Uncommitted files: preserve them and use a clean production checkout.');
  await run('git', ['fetch', 'origin', 'main']);
  try { await run('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD']); }
  catch { throw new Error('Stale source: this checkout does not contain current origin/main. Do not deploy it over production.'); }
  return (await run('git', ['rev-parse', 'HEAD'])).trim();
}

export function checkBaseline(deployments, expected) {
  if (!uuid.test(expected ?? '')) throw new Error('Supply --expected-version with the currently deployed Worker version UUID.');
  const latest = [...deployments].sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0];
  if (!latest || latest.versions?.length !== 1 || latest.versions[0].percentage !== 100 || latest.versions[0].version_id !== expected) {
    throw new Error('Production changed or has a split deployment. Inspect and reconcile it before deploying; do not overwrite another deployment.');
  }
}

export async function deployProduction(args, run = runCommand) {
  const expectedAt = args.indexOf('--expected-version');
  const expected = expectedAt >= 0 ? args[expectedAt + 1] : undefined;
  const checkOnly = args.includes('--check-only');
  if (!uuid.test(expected ?? '') || args.length !== (checkOnly ? 3 : 2) || expectedAt !== 0 || (checkOnly && args[2] !== '--check-only')) {
    throw new Error('Usage: npm run deploy:production -- --expected-version <live-version-uuid> [--check-only]');
  }
  const head = await checkRepository(run);
  const checks = JSON.parse(await run('gh', ['run', 'list', '--repo', 'Nutshell2000/agent-data-tools', '--commit', head,
    '--workflow', 'mcp-contract.yml', '--limit', '5', '--json', 'headSha,status,conclusion']));
  if (!checks.some(r => r.headSha === head && r.status === 'completed' && r.conclusion === 'success')) {
    throw new Error('No successful clean-install CI run for this exact commit. Wait for its checks before deploying.');
  }
  const deployments = JSON.parse(await run(process.execPath, [wrangler, 'deployments', 'list', '--name', worker, '--json']));
  checkBaseline(deployments, expected);
  if (checkOnly) return { ok: true, mode: 'check-only', head, expectedProductionVersion: expected, deployed: false };
  // The SDK build runs inside this invocation. This check is not a Cloudflare-side
  // atomic lock: other operators must use the same production process.
  const output = await run(process.execPath, [wrangler, 'deploy', '--name', worker]);
  return { ok: true, mode: 'deploy', head, expectedProductionVersion: expected, output };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await deployProduction(process.argv.slice(2)))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
