// 21 Nov 2026 (safety audit): what the release tooling and the CI workflows must keep doing, read from their text.
// These guard against a quiet step back: `git add -A` in the release commit, a hard-coded npx cache folder, a write
// token handed to dependency install scripts, or a workflow or job renamed away from what the deploy guard looks for.
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
// A Windows checkout holds these files with CRLF line ends; the checks below are written for LF.
const read = (path) => readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n");
const workflows = Object.fromEntries(readdirSync(new URL(".github/workflows/", root)).map((name) => [name, read(`.github/workflows/${name}`)]));

test("the release commit never stages the whole folder", () => {
  const release = read("scripts/release.ps1");
  const code = release.split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");
  assert.ok(!/git add (-A|--all|\.)(\s|;|$)/m.test(code), "no `git add -A`, `--all` or `.` in release.ps1");
  assert.match(code, /Step 'commit\+push' \{ StageRelease;/, "the commit step stages through StageRelease");
  assert.match(code, /function StageRelease \{\s*git add -u/, "tracked changes first");
  assert.match(code, /ls-files --others --exclude-standard/, "new files are listed, then chosen");
  // The pattern that keeps key-like files out, tried on names (the same expression, read from the script).
  const pattern = /\$SecretLikeFile = '\(\?i\)(.+)'/.exec(release)?.[1];
  assert.ok(pattern, "the secret-name pattern is in the script");
  const secretLike = new RegExp(pattern, "i");
  for (const name of [".env", "src/.env.local", ".dev.vars", "scripts/deploy.pem", "x/server.key", "scripts/id_rsa", "id_ed25519", "wallet.json", "tests/fixtures/wallet-backup.json", ".test-wallet.json", ".402index-token", "src/credentials.json", "src/lib/.secret-cache", "service-account-prod.json", "a/b/.payout-key"]) assert.ok(secretLike.test(name), `${name} is kept out`);
  for (const name of ["src/lib/response-headers.ts", "tests/api-key-header.test.cjs", "src/lib/keyring.ts", "scripts/warm-quotes-tally.mjs", "docs/wallets.md", ".github/workflows/new.yml", "src/lib/token-prices.ts", "tests/secret-scan.test.cjs"]) assert.ok(!secretLike.test(name), `${name} is an ordinary file`);
});

test("the release names no npx cache folder and can pin the agentcash CLI", () => {
  const release = read("scripts/release.ps1");
  assert.ok(!/_npx\\[0-9a-f]{8,}/.test(release), "no hard-coded npx cache folder name");
  assert.match(release, /function FindDiscoveryDist/);
  assert.match(release, /AGENTCASH_DISCOVERY_DIST/);
  assert.match(release, /discovery check skipped: @agentcash\/discovery was not found\. Looked at:/, "a missing package is reported with where it was looked for");
  assert.match(release, /\[string\]\$AgentcashVersion = ''/);
  assert.match(release, /npx --yes \$agentcashSpec register \$Origin/);
  assert.match(release, /"agentcash@\$AgentcashVersion"/);
  // The order of the release is unchanged: the same named steps, in the same order.
  const steps = [...release.matchAll(/^\s*(?:\$\w+ = )?(?:if \([^)]*\) \{ )?(?:Step|Proof|Once) '([\w:+-]+)'/gm)].map((m) => m[1]);
  const wanted = ["auth", "wallet", "sync-main", "bump", "page-lastmod", "update:mcp-contract", "check:mcp-contract", "tsc", "staging-deploy", "proof-v2", "proof-v1", "proof-mcp", "proof-mpp-evm", "check:live", "warm-quotes", "indexnow", "x402scan", "agent402", "zero", "402index"];
  let at = -1;
  for (const name of wanted) { const i = steps.indexOf(name, at + 1); assert.ok(i > at, `step ${name} is present, after the one before it (${steps.join(", ")})`); at = i; }
});

test("workflows: names and jobs the deploy guard and the publishers rely on are unchanged", () => {
  assert.deepEqual(Object.keys(workflows).sort(), ["402index-price-sync.yml", "mcp-contract.yml", "ofac-mirror.yml", "publish-mcp.yml", "publish-n8n-glyphcall-node.yml", "publish-n8n-node.yml", "se-company-mirror.yml", "se-financials-mirror.yml"]);
  assert.match(workflows["mcp-contract.yml"], /^name: MCP contract$/m);
  assert.match(workflows["mcp-contract.yml"], /^jobs:\n  check:$/m);
  assert.match(read("scripts/deploy-production.mjs"), /'--workflow', 'mcp-contract\.yml'/, "the deploy guard still asks for this workflow by file name");
  const jobs = (text) => [...text.slice(text.indexOf("\njobs:")).matchAll(/^  ([a-z][\w-]*):$/gm)].map((m) => m[1]);
  assert.deepEqual(jobs(workflows["ofac-mirror.yml"]), ["mirror"]);
  assert.deepEqual(jobs(workflows["se-company-mirror.yml"]), ["mirror"]);
  assert.deepEqual(jobs(workflows["se-financials-mirror.yml"]), ["plan", "extract", "build"]);
  assert.deepEqual(jobs(workflows["publish-mcp.yml"]), ["publish"]);
  assert.deepEqual(jobs(workflows["402index-price-sync.yml"]), ["sync"]);
});

test("workflows: every one states its permissions, and none gives all jobs a write token", () => {
  for (const [name, text] of Object.entries(workflows)) {
    assert.match(text, /^\s*permissions:$/m, `${name} states its permissions`);
    const top = /^permissions:\n((?:  .+\n)+)/m.exec(text)?.[1] ?? "";
    assert.ok(!/write/.test(top), `${name}: no write permission for the whole workflow`);
    assert.ok(!/pull_request_target|workflow_run:/.test(text), `${name}: no trigger that runs other people's code with secrets`);
  }
  assert.match(workflows["mcp-contract.yml"], /^permissions:\n  contents: read$/m);
  assert.match(workflows["402index-price-sync.yml"], /^permissions:\n  contents: read$/m);
  assert.match(workflows["se-financials-mirror.yml"], /^permissions:\n  contents: read$/m);
  assert.match(workflows["se-financials-mirror.yml"], /  build:[\s\S]*?permissions:\n      contents: write/, "only the publishing job may write");
});

test("workflows: a job that can write or publish never runs dependency install scripts, and holds its token only where it uploads", () => {
  for (const name of ["ofac-mirror.yml", "publish-mcp.yml", "publish-n8n-node.yml", "publish-n8n-glyphcall-node.yml", "se-company-mirror.yml", "se-financials-mirror.yml"]) {
    for (const line of workflows[name].split("\n").filter((l) => /\bnpm (ci|install)\b/.test(l) && !l.trim().startsWith("#"))) assert.match(line, /--ignore-scripts/, `${name}: ${line.trim()}`);
  }
  for (const name of ["ofac-mirror.yml", "se-company-mirror.yml", "se-financials-mirror.yml"]) {
    // No token for a whole job: `env:` directly under a job (four spaces) must not carry it.
    assert.ok(!/^    env:\n      GH_TOKEN:/m.test(workflows[name]), `${name}: GH_TOKEN is not job-wide`);
    assert.match(workflows[name], /^        env:\n          GH_TOKEN: \$\{\{ github\.token \}\}/m, `${name}: the token is given to single steps`);
  }
  // The step that installs and runs dependencies in the sanctions mirror has no token.
  const build = /- name: Build the pre-parsed index the Worker loads\n([\s\S]*?)\n      - name:/.exec(workflows["ofac-mirror.yml"])[1];
  assert.ok(!/GH_TOKEN/.test(build));
  // The registry publisher signs in only after the dependencies were installed and the manifests built.
  const publish = workflows["publish-mcp.yml"];
  assert.ok(publish.indexOf("npm ci --ignore-scripts") < publish.indexOf("mcp-publisher login"), "install and build come before the sign-in");
});

test("workflows: no trigger for a branch that is gone", () => {
  for (const [name, text] of Object.entries(workflows)) for (const m of text.matchAll(/^\s*branches:\s*\[([^\]]*)\]/gm)) assert.deepEqual(m[1].split(",").map((s) => s.trim()), ["main"], `${name} runs on main only`);
});

test("pay-test never invents a wallet for a payment command", () => {
  const source = read("scripts/pay-test.mjs");
  assert.match(source, /a payment command never creates one/);
  assert.match(source, /flag: "wx", mode: 0o600/);
  assert.match(read("scripts/seed-bazaar.mjs"), /flag: "wx", mode: 0o600/);
  const wallet = new URL(".test-wallet.json", root);
  if (existsSync(wallet)) return; // a checkout that holds a test wallet: the guard is not reached, and nothing may be paid from a test
  const run = spawnSync(process.execPath, [fileURLToPath(new URL("scripts/pay-test.mjs", root)), "https://pay-test-guard.invalid/btc-fees"], { encoding: "utf8", env: { ...process.env, PAY_TEST_REQUIRE_WALLET: "" }, timeout: 60_000 });
  assert.notEqual(run.status, 0, "the command stops");
  assert.match(run.stderr, /Run `node scripts\/pay-test\.mjs address` to create the test wallet/);
  assert.equal(existsSync(wallet), false, "and no wallet file was written");
});
