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
  for (const [name, text] of Object.entries(workflows)) for (const m of text.matchAll(/^\s*branches:\s*\[([^\]]*)\]/gm)) for (const branch of m[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""))) assert.ok(branch === "main" || branch === "release-*" || branch === "ci/**", `${name} runs on main and the release patterns only, not on ${branch}`);
});

// 21 Nov 2026, second round: each job states its own permissions and a time limit, and nothing starts for a pushed
// branch other than main. Read with a YAML parser, so an indentation slip cannot hide a job from the check.
test("workflows: every job has its own minimal permissions and a time limit", async () => {
  const { parse } = await import("yaml");
  // The only write scopes any job may hold, and why. Anything else must be read (or absent).
  const mayWrite = {
    "ofac-mirror.yml/mirror": { contents: "write" }, "se-company-mirror.yml/mirror": { contents: "write" }, "se-financials-mirror.yml/build": { contents: "write" },
    "publish-mcp.yml/publish": { "id-token": "write" }, "publish-n8n-node.yml/publish": { "id-token": "write" }, "publish-n8n-glyphcall-node.yml/publish": { "id-token": "write" },
  };
  let jobs = 0;
  for (const [name, text] of Object.entries(workflows)) {
    const doc = parse(text);
    for (const [id, job] of Object.entries(doc.jobs)) {
      jobs++;
      const where = `${name}/${id}`;
      assert.equal(typeof job.permissions, "object", `${where} states its own permissions (not "write-all", not inherited)`);
      assert.ok(job.permissions && Object.keys(job.permissions).length > 0, `${where}: at least contents: read`);
      for (const [scope, level] of Object.entries(job.permissions)) {
        if (level === "write") assert.equal(mayWrite[where]?.[scope], "write", `${where} may not write ${scope}`);
        else assert.ok(level === "read" || level === "none", `${where}: ${scope}: ${level}`);
      }
      assert.ok(Number.isInteger(job["timeout-minutes"]) && job["timeout-minutes"] > 0 && job["timeout-minutes"] <= 350, `${where} has a time limit under GitHub's six hours (${job["timeout-minutes"]})`);
    }
  }
  assert.equal(jobs, 10, "every job of the eight workflows was looked at");
  // The contract check must end well inside what a release can wait out, but not so early that a slow runner fails it.
  const check = parse(workflows["mcp-contract.yml"]).jobs.check["timeout-minutes"];
  assert.ok(check >= 30 && check <= 60, `mcp-contract check: ${check} minutes`);
});

test("workflows: a push starts a run on main or on a tag only, never on another branch", async () => {
  const { parse } = await import("yaml");
  for (const [name, text] of Object.entries(workflows)) {
    // YAML 1.1 readers turn the key `on` into true; this parser keeps it, both are accepted.
    const doc = parse(text);
    const on = doc.on ?? doc.true;
    assert.equal(typeof on, "object", `${name} has triggers`);
    if (!Object.hasOwn(on, "push")) continue;
    const push = on.push;
    assert.ok(push && typeof push === "object", `${name}: push has a filter (a bare "push:" runs on every branch)`);
    assert.ok(push.branches || push.tags, `${name}: push is limited to branches or tags`);
    assert.ok(!push["branches-ignore"] && !push["tags-ignore"], `${name}: an allow list, not an ignore list`);
    if (push.branches) assert.deepEqual(push.branches, ["main"], `${name}: main only`);
    // With tags and no branches, GitHub runs for tags only; with neither there would be no filter (refused above).
    for (const tag of push.tags ?? []) assert.match(tag, /^(v\*|n8n-(glyphcall-)?node-\*\.\*\.\*)$/, `${name}: tag pattern ${tag}`);
  }
  const contract = parse(workflows["mcp-contract.yml"]);
  const on = contract.on ?? contract.true;
  assert.deepEqual(on.push, { branches: ["main"], tags: ["v*"] });
  assert.ok(Object.hasOwn(on, "pull_request"), "a feature branch is still checked through its pull request (the release waits for those checks)");
  assert.ok(Object.hasOwn(on, "workflow_dispatch"), "the release can still start it by hand on main");
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

// ---- 21 Nov 2026, second round: the functions the first round added to release.ps1, run for real ---------------------
// The text checks above cannot see a PowerShell scope mistake (a function or variable that a `Step { … }` block cannot
// reach, or a parameter named $Args: inside a scriptblock that name is PowerShell's own, empty variable, which ran the
// payment proofs without arguments on an earlier release). So the script is parsed by PowerShell itself, and the
// staging function is run inside the real `Step` function, in a throw-away repository in the temporary folder.
// Needs `pwsh` and `git`; skipped where either is missing. release.ps1 itself is never run.
const has = (cmd, args) => { try { return spawnSync(cmd, args, { encoding: "utf8", timeout: 60_000 }).status === 0; } catch { return false; } };
const hasPwsh = has("pwsh", ["-NoProfile", "-Command", "exit 0"]);
const hasGit = has("git", ["--version"]);
const pwsh = (file, args = [], options = {}) => spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-File", file, ...args], { encoding: "utf8", timeout: 180_000, ...options });
const releaseText = () => read("scripts/release.ps1");
const cut = (text, from, to) => { const a = text.indexOf(from); const b = text.indexOf(to, a); assert.ok(a >= 0 && b > a, `release.ps1 holds ${from.slice(0, 40)} … ${to.slice(0, 40)}`); return text.slice(a, b); };
// The real `Step` runner, with the run log switched off.
const stepFunction = () => "$state = [ordered]@{ steps = @() }; $done = @{}\nfunction Save { }\n" + cut(releaseText(), "function Step(", "function RevertGenerated");

test("release.ps1 parses, and no scriptblock or parameter uses the name $args", { skip: !hasPwsh && "pwsh is not installed" }, async () => {
  const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "release-parse-test-"));
  try {
    const probe = join(dir, "parse.ps1");
    writeFileSync(probe, `param([string]$Path)
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$errors)
$argsUses = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.VariableExpressionAst] -and $n.VariablePath.UserPath -eq 'args' }, $true) | ForEach-Object { $_.Extent.StartLineNumber })
$functions = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true) | ForEach-Object { $_.Name })
$commands = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true) | ForEach-Object { $_.GetCommandName() } | Where-Object { $_ } | Sort-Object -Unique)
@{ errors = @($errors | ForEach-Object { "$($_.Extent.StartLineNumber): $($_.Message)" }); argsUses = $argsUses; functions = $functions; commands = $commands } | ConvertTo-Json -Depth 4
`);
    const run = pwsh(probe, [fileURLToPath(new URL("scripts/release.ps1", root))]);
    assert.equal(run.status, 0, run.stderr);
    const parsed = JSON.parse(run.stdout);
    assert.deepEqual(parsed.errors, [], "no parse error");
    assert.deepEqual(parsed.argsUses, [], "no $args / $Args anywhere (lines listed)");
    // Every function the script calls by name is defined in the script (a call from inside a Step block finds a
    // script-level function; a function defined inside another function would not be found).
    for (const name of ["Save", "Step", "RevertGenerated", "WaitFor", "SelectNewFiles", "StageRelease", "FindDiscoveryDist", "PackageVersionOf", "SmokeExamples", "Proof", "Once"]) {
      assert.ok(parsed.functions.includes(name), `function ${name} is defined`);
      assert.ok(parsed.commands.includes(name), `function ${name} is called`);
    }
    assert.equal(new Set(parsed.functions).size, parsed.functions.length, "no function is defined twice");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("StageRelease inside a Step block: tracked changes, a new test file, nothing new, and files that must stay out", { skip: (!hasPwsh || !hasGit) && "pwsh and git are needed" }, async () => {
  const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "release-stage-test-"));
  const repo = join(dir, "repo");
  const git = (...args) => { const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" }); assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`); return r.stdout.trim(); };
  const put = (path, text = "x\n") => { mkdirSync(join(repo, path, ".."), { recursive: true }); writeFileSync(join(repo, path), text); };
  try {
    mkdirSync(repo);
    git("init", "-q", "-b", "main");
    git("config", "user.name", "release test"); git("config", "user.email", "release-test@example.invalid");
    git("config", "commit.gpgsign", "false"); git("config", "core.autocrlf", "false");
    put(".gitignore", "node_modules/\n.dev.vars\n");
    put("src/index.ts"); put("tests/old.test.cjs"); put("scripts/release.ps1"); put("README.md");
    git("add", "-A"); git("commit", "-q", "-m", "first");
    writeFileSync(join(dir, "message.txt"), "Release test\n\nbody\n");

    // The commit step exactly as release.ps1 has it, without the push (there is no remote here).
    const release = releaseText();
    const commitStep = /^ +(Step 'commit\+push' \{ StageRelease; .*\} 'pushed')$/m.exec(release)?.[1];
    assert.ok(commitStep, "the commit step is in the script");
    assert.ok(commitStep.includes("git push -q -u origin $branch; "), "and it pushes");
    const harness = join(dir, "stage.ps1");
    writeFileSync(harness, [
      "param([string]$RepoDir, [string]$MessageFile)",
      "$ErrorActionPreference = 'Stop'", "$PSNativeCommandUseErrorActionPreference = $false",
      stepFunction(),
      cut(release, "$SecretLikeFile = ", "# The @agentcash/discovery entry point"),
      "Set-Location $RepoDir", "$branch = 'feature'",
      "$null = " + commitStep.replace("git push -q -u origin $branch; ", ""),
      "Write-Host 'STEP-OK'",
    ].join("\n"));
    const stage = () => { const r = pwsh(harness, [repo, join(dir, "message.txt")]); return { status: r.status, out: r.stdout + r.stderr }; };
    const committed = () => git("show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean).sort();
    const head = () => git("rev-parse", "HEAD");

    // 1. Nothing changed and nothing new: the step passes and makes no commit.
    const first = head();
    let run = stage();
    assert.match(run.out, /STEP-OK/, run.out);
    assert.equal(head(), first, "no empty commit");
    assert.ok(!run.out.includes("[warn]"), run.out);

    // 2. Only a tracked file changed, no untracked file at all (the empty-list case of SelectNewFiles).
    put("src/index.ts", "changed\n");
    run = stage();
    assert.match(run.out, /STEP-OK/, run.out);
    assert.deepEqual(committed(), ["src/index.ts"]);
    assert.ok(!run.out.includes("[warn]"), run.out);
    assert.equal(git("log", "-1", "--format=%s"), "Release test", "the commit message comes from the message file");

    // 3. New files: a new test file and a new source file in a new sub-folder are committed; a top-level file, a file
    //    in a folder the repository does not track, and files named like secrets are left out and listed.
    put("tests/new-check.test.cjs"); put("tests/with space.test.cjs"); put("src/lib/deep/new.ts"); put("tests/old.test.cjs", "edited\n");
    put("stray.txt"); put("notes/plan.md"); put("tests/.env"); put("tests/fixtures/wallet-backup.json"); put("src/deploy.pem");
    put(".dev.vars", "SECRET=1\n"); put("node_modules/pkg/index.js");
    run = stage();
    assert.match(run.out, /STEP-OK/, run.out);
    assert.deepEqual(committed(), ["src/lib/deep/new.ts", "tests/new-check.test.cjs", "tests/old.test.cjs", "tests/with space.test.cjs"]);
    assert.match(run.out, /\[warn\] 5 new file\(s\) were NOT added to the release commit/);
    for (const left of ["stray.txt", "notes/plan.md", "tests/.env", "tests/fixtures/wallet-backup.json", "src/deploy.pem"]) assert.ok(run.out.includes(`         ${left}`), `${left} is listed as left out`);
    assert.deepEqual(git("ls-files", "--others", "--exclude-standard").split("\n").sort(), ["notes/plan.md", "src/deploy.pem", "stray.txt", "tests/.env", "tests/fixtures/wallet-backup.json"], "left on disk, untracked");
    assert.ok(!run.out.includes(".dev.vars") && !run.out.includes("node_modules"), "ignored files are not even looked at");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a new file that cannot be staged stops the commit step", () => {
  assert.match(releaseText(), /foreach \(\$f in \$picked\.add\) \{ git add -- \$f; if \(\$LASTEXITCODE -ne 0\) \{ throw "could not stage the new file \$f" \} \}/);
});

test("FindDiscoveryDist: the argument, the environment, an install, the cache by highest version, and nothing found", { skip: (!hasPwsh || process.platform !== "win32") && "needs pwsh on Windows (the function builds Windows paths)" }, async () => {
  const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "release-discovery-test-"));
  try {
    const install = (base, version) => { const pkg = join(base, "node_modules", "@agentcash", "discovery"); mkdirSync(join(pkg, "dist"), { recursive: true }); writeFileSync(join(pkg, "package.json"), JSON.stringify({ version })); writeFileSync(join(pkg, "dist", "index.js"), ""); return join(pkg, "dist", "index.js"); };
    const local = join(dir, "local"); const repo = join(dir, "repo"); mkdirSync(repo, { recursive: true });
    const older = install(join(local, "npm-cache", "_npx", "aaaa1111"), "1.7.2");
    const newer = install(join(local, "npm-cache", "_npx", "bbbb2222"), "1.10.0");
    install(join(local, "npm-cache", "_npx", "cccc3333"), "not-a-version");
    const harness = join(dir, "find.ps1");
    writeFileSync(harness, [
      "param([string]$Repo, [string]$DiscoveryDist = '')", "$ErrorActionPreference = 'Stop'",
      cut(releaseText(), "function FindDiscoveryDist", "# ---- 0. preconditions"),
      "$found = FindDiscoveryDist", "if ($null -eq $found) { 'FOUND=<none>' } else { \"FOUND=$found|$(PackageVersionOf $found)|$(@($found).Count)\" }",
    ].join("\n"));
    const find = (args = [], env = {}) => { const r = pwsh(harness, [repo, ...args], { env: { ...process.env, LOCALAPPDATA: local, AGENTCASH_DISCOVERY_DIST: "", ...env } }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
    const same = (out, path, version) => assert.ok(out.toLowerCase().includes(`found=${path}|${version}|1`.toLowerCase()), out);
    // Only the cache holds it: the highest version wins (1.10.0 over 1.7.2, by number, not by text), with a warning.
    let out = find();
    same(out, newer, "1.10.0");
    assert.match(out, /\[warn\] discovery check uses a copy from the npx cache/);
    // The operator's own install beside the release data comes before the cache; this checkout's node_modules before both.
    const own = install(join(local, "agent-data-tools", "agentcash-discovery"), "1.8.0");
    out = find(); same(out, own, "1.8.0"); assert.ok(!out.includes("[warn]"), out);
    const inRepo = install(repo, "1.9.0");
    same(find(), inRepo, "1.9.0");
    // The environment variable and the argument come first; one that does not exist skips the check, loudly.
    same(find([], { AGENTCASH_DISCOVERY_DIST: older }), older, "1.7.2");
    same(find(["-DiscoveryDist", newer], { AGENTCASH_DISCOVERY_DIST: older }), newer, "1.10.0");
    out = find(["-DiscoveryDist", join(dir, "missing.js")]);
    assert.match(out, /FOUND=<none>/); assert.match(out, /discovery check skipped: -DiscoveryDist/);
    out = find([], { AGENTCASH_DISCOVERY_DIST: join(dir, "missing.js") });
    assert.match(out, /FOUND=<none>/); assert.match(out, /discovery check skipped: AGENTCASH_DISCOVERY_DIST/);
    // Nothing anywhere: skipped, with where it looked.
    const empty = join(dir, "empty"); mkdirSync(empty);
    const none = pwsh(harness, [join(dir, "no-repo")], { env: { ...process.env, LOCALAPPDATA: empty, AGENTCASH_DISCOVERY_DIST: "" } });
    assert.match(none.stdout, /FOUND=<none>/);
    assert.match(none.stdout, /discovery check skipped: @agentcash\/discovery was not found\. Looked at:/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the agentcash version option: an exact version only, and a local copy that overrides it is announced", () => {
  const release = releaseText();
  assert.match(release, /if \(\$AgentcashVersion -and \$AgentcashVersion -notmatch '\^\\d\+\\\.\\d\+\\\.\\d\+\$'\) \{ throw/, "a range or a tag such as latest is refused");
  assert.match(release, /\$agentcashSpec = if \(\$AgentcashVersion\) \{ "agentcash@\$AgentcashVersion" \} else \{ 'agentcash' \}/);
  assert.match(release, /if \(\(Test-Path \$agentcashLong\) -and \$AgentcashVersion\) \{\n.*\n  Write-Host "\[warn\] -AgentcashVersion \$AgentcashVersion is not used: the local long-timeout copy/);
  // The variables the registration block reads are set at script level, before the block that uses them.
  for (const name of ["$agentcashLong = ", "$agentcashSpec = "]) assert.ok(release.indexOf(name) > 0 && release.indexOf(name) < release.indexOf("Once 'x402scan'"), `${name.trim()} is set before the registration`);
});
