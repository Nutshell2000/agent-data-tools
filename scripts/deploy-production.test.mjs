import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, unlink, rmdir, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { checkRepository, deployProduction, runCommand } from './deploy-production.mjs';

const version = 'dcee04aa-e0fc-402e-ae76-fa5af36188cc';
const head = 'a'.repeat(40);
function commands({ dirty = false, stale = false, ci = true, changed = false } = {}) {
  const calls = [];
  const run = async (binary, args) => {
    calls.push([binary, ...args]);
    if (binary === 'git') {
      if (args[0] === 'status') return dirty ? ' M src/index.ts\n' : '';
      if (args[0] === 'merge-base' && stale) throw new Error('not an ancestor');
      return args[0] === 'rev-parse' ? head : '';
    }
    if (binary === 'gh') return JSON.stringify([{ headSha: head, status: 'completed', conclusion: ci ? 'success' : 'failure' }]);
    if (args[1] === 'deployments') return JSON.stringify([{ created_on: '2026-10-18T11:00:00Z', versions: [{ version_id: changed ? '0'.repeat(36) : version, percentage: 100 }] }]);
    if (args[1] === 'deploy') return 'uploaded fixture';
    throw new Error('Unexpected command');
  };
  return { run, calls, deployments: () => calls.filter(c => c[2] === 'deploy').length };
}

test('production guard never deploys dirty, stale, untested or concurrently replaced source', async () => {
  for (const condition of [{ dirty: true }, { stale: true }, { ci: false }, { changed: true }]) {
    const fixture = commands(condition);
    await assert.rejects(deployProduction(['--expected-version', version], fixture.run));
    assert.equal(fixture.deployments(), 0);
  }
});

test('check-only is non-deploying, while a validated invocation deploys once', async () => {
  const fixture = commands();
  assert.equal((await deployProduction(['--expected-version', version, '--check-only'], fixture.run)).deployed, false);
  assert.equal(fixture.deployments(), 0);
  await deployProduction(['--expected-version', version], fixture.run);
  assert.equal(fixture.deployments(), 1);
  await assert.rejects(deployProduction(['--expected-version', version, '--force'], fixture.run));
  assert.equal(fixture.deployments(), 1);
});

test('actual Git status rejects an uncommitted file before any fetch or deployment', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'x402-production-guard-'));
  try {
    await runCommand('git', ['init', '--quiet'], cwd);
    await writeFile(join(cwd, 'uncommitted.txt'), 'preserve this work');
    const calls = [];
    await assert.rejects(checkRepository(async (binary, args) => {
      calls.push(args[0]); return runCommand(binary, args, cwd);
    }), /Uncommitted files/);
    assert.deepEqual(calls, ['status']);
  } finally {
    await unlink(join(cwd, 'uncommitted.txt'));
    const gitDirectory = resolve(cwd, '.git');
    assert.equal(relative(cwd, gitDirectory), '.git');
    const metadata = await lstat(gitDirectory);
    assert.ok(metadata.isDirectory() && !metadata.isSymbolicLink());
    await rm(gitDirectory, { recursive: true });
    await rmdir(cwd);
  }
});
