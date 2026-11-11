const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'clients', 'agent-data-tools', 'cli.mjs');
const KEY = 'adt_test_SECRETsecret_9876';

/** A local stand-in for the remote MCP server and /credits/balance; records every request it gets. */
async function remote() {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url === '/credits/balance') {
        seen.push({ url: req.url, headers: req.headers });
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ balanceCredits: 940, calls: 6 }));
      }
      const body = JSON.parse(raw);
      seen.push({ url: req.url, method: req.method, headers: req.headers, body });
      if ((req.url !== '/mcp/compact' && req.url !== '/mcp') || req.method !== 'POST') { res.writeHead(404); return res.end('not found'); }
      if (body.method === 'initialize') {
        res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' });
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'fake', version: '1' } } }));
      }
      if (body.method === 'notifications/initialized') { res.writeHead(202); return res.end(); }
      if (body.method === 'tools/list') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(': keep-alive\n\n');
        return res.end(`event: message\r\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'weather' }] } })}\r\n\r\n`);
      }
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('boom');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { seen, origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

function tempHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'adt-cli-'));
  const appData = path.join(home, 'AppData', 'Roaming');
  return { home, appData, env: { HOME: home, USERPROFILE: home, APPDATA: appData, AGENT_DATA_TOOLS_KEY: '', ADT_API_KEY: '' } };
}

/** Run the CLI; `stdin` lines are written and stdin is closed, so `mcp` ends when it has answered. */
function run(args, { env = {}, stdin, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: cwd ?? ROOT, env: { ...process.env, ...env } });
    let stdout = '', stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin ? stdin.map((m) => (typeof m === 'string' ? m : JSON.stringify(m))).join('\n') + '\n' : '');
  });
}

const SESSION = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  { jsonrpc: '2.0', id: 'x-3', method: 'tools/call', params: { name: 'weather', arguments: {} } },
];

test('npm client mcp: stdio proxy forwards JSON and SSE answers, keeps the session, turns HTTP 500 into a JSON-RPC error', async () => {
  const server = await remote();
  const t = tempHome();
  try {
    const { code, stdout, stderr } = await run(['mcp'], { env: { ...t.env, AGENT_DATA_TOOLS_ORIGIN: server.origin }, stdin: SESSION });
    assert.equal(code, 0, stderr);
    const lines = stdout.split('\n').filter(Boolean);
    const messages = lines.map((l) => JSON.parse(l)); // throws if anything but JSON reached stdout
    assert.equal(messages.length, 3, stdout);
    for (const m of messages) assert.equal(m.jsonrpc, '2.0');
    const byId = new Map(messages.map((m) => [m.id, m]));
    assert.equal(byId.get(1).result.serverInfo.name, 'fake');
    assert.deepEqual(byId.get(2).result.tools, [{ name: 'weather' }]);
    assert.equal(byId.get('x-3').error.code, -32000);
    assert.match(byId.get('x-3').error.message, /HTTP 500/);
    assert.equal(byId.get('x-3').result, undefined);

    assert.equal(server.seen.length, 4);
    const [init, ...later] = server.seen;
    assert.equal(init.body.method, 'initialize');
    assert.equal(init.headers['mcp-session-id'], undefined);
    assert.equal(init.headers['content-type'], 'application/json');
    assert.equal(init.headers.accept, 'application/json, text/event-stream');
    assert.equal(init.headers.authorization, undefined);
    for (const r of later) {
      assert.equal(r.headers['mcp-session-id'], 'sess-1');
      assert.equal(r.headers['mcp-protocol-version'], '2025-06-18');
    }
    assert.ok(later.some((r) => r.body.method === 'notifications/initialized'));
  } finally { await server.close(); fs.rmSync(t.home, { recursive: true, force: true }); }
});

test('npm client mcp: the key goes out as a Bearer header from --key, the environment or the saved config, never to stdout', async () => {
  const server = await remote();
  const t = tempHome();
  const env = { ...t.env, AGENT_DATA_TOOLS_ORIGIN: server.origin };
  try {
    const flagged = await run(['mcp', '--key', KEY], { env, stdin: SESSION.slice(0, 1) });
    assert.equal(server.seen[0].headers.authorization, `Bearer ${KEY}`);
    assert.ok(!flagged.stdout.includes(KEY) && !flagged.stderr.includes(KEY));
    assert.equal(JSON.parse(flagged.stdout.trim()).id, 1);

    await run(['mcp'], { env: { ...env, AGENT_DATA_TOOLS_KEY: 'adt_from_env' }, stdin: SESSION.slice(0, 1) });
    assert.equal(server.seen[1].headers.authorization, 'Bearer adt_from_env');

    const saved = await run(['key', KEY], { env });
    assert.equal(saved.code, 0, saved.stderr);
    assert.ok(!saved.stdout.includes(KEY) && !saved.stderr.includes(KEY));
    const file = path.join(t.home, '.agent-data-tools', 'config.json');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).key, KEY);
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    await run(['mcp'], { env, stdin: SESSION.slice(0, 1) });
    assert.equal(server.seen[2].headers.authorization, `Bearer ${KEY}`);

    const shown = await run(['key'], { env });
    assert.equal(shown.code, 0, shown.stderr);
    assert.ok(!shown.stdout.includes(KEY) && !shown.stderr.includes(KEY));
    assert.match(shown.stdout, /ends in …9876/);
    assert.match(shown.stdout, /Balance: 940 credits/);
    assert.equal(server.seen[3].url, '/credits/balance');
    assert.equal(server.seen[3].headers['x-api-key'], KEY);
  } finally { await server.close(); fs.rmSync(t.home, { recursive: true, force: true }); }
});

test('npm client mcp: an unreachable server answers each request with a JSON-RPC error and no crash', async () => {
  const t = tempHome();
  try {
    const { code, stdout } = await run(['mcp'], { env: { ...t.env, AGENT_DATA_TOOLS_ORIGIN: 'http://127.0.0.1:9' }, stdin: [SESSION[0], SESSION[1], 'not json'] });
    assert.equal(code, 0);
    const messages = stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(messages.length, 2);
    const failed = messages.find((m) => m.id === 1);
    assert.equal(failed.error.code, -32000);
    assert.match(failed.error.message, /could not reach the server/);
    assert.equal(messages.find((m) => m.id === null).error.code, -32700);
  } finally { fs.rmSync(t.home, { recursive: true, force: true }); }
});

test('npm client setup: --print shows each client its documented shape and writes nothing', async () => {
  const t = tempHome();
  try {
    const cursor = await run(['setup', 'cursor', '--print', '--key', KEY], { env: t.env });
    assert.equal(cursor.code, 0, cursor.stderr);
    const [file, ...json] = cursor.stdout.split('\n');
    assert.equal(file, path.join(t.home, '.cursor', 'mcp.json'));
    assert.deepEqual(JSON.parse(json.join('\n')), { mcpServers: { 'agent-data-tools': { url: 'https://agent-data-tools.revmesh2074.workers.dev/mcp/compact', headers: { Authorization: `Bearer ${KEY}` } } } });
    assert.ok(!fs.existsSync(path.join(t.home, '.cursor')));

    const desktop = await run(['setup', 'claude-desktop', '--print'], { env: t.env });
    assert.equal(desktop.code, 0, desktop.stderr);
    assert.match(desktop.stdout.split('\n')[0], /claude_desktop_config\.json$/);
    assert.deepEqual(JSON.parse(desktop.stdout.split('\n').slice(1).join('\n')), { mcpServers: { 'agent-data-tools': { command: 'npx', args: ['-y', 'agent-data-tools', 'mcp'] } } });
    assert.deepEqual(fs.readdirSync(t.home), []);

    const code = await run(['setup', 'claude-code', '--key', KEY], { env: t.env });
    assert.equal(code.stdout.trim(), `claude mcp add --transport http agent-data-tools https://agent-data-tools.revmesh2074.workers.dev/mcp/compact --header "Authorization: Bearer ${KEY}"`);
    const plain = await run(['setup', 'claude-code'], { env: t.env });
    assert.equal(plain.stdout.trim(), 'claude mcp add --transport http agent-data-tools https://agent-data-tools.revmesh2074.workers.dev/mcp/compact');

    const menu = await run(['setup'], { env: t.env });
    for (const target of ['claude-code', 'claude-desktop', 'cursor', 'vscode']) assert.ok(menu.stdout.includes(`setup ${target}`));
    const unknown = await run(['setup', 'emacs'], { env: t.env });
    assert.equal(unknown.code, 1);
  } finally { fs.rmSync(t.home, { recursive: true, force: true }); }
});

test('npm client setup: writing merges with existing servers, leaves a .bak, refuses unparseable JSON and keeps keys out of project files', async () => {
  const t = tempHome();
  try {
    // Cursor: an existing server and an unrelated setting survive.
    const cursorFile = path.join(t.home, '.cursor', 'mcp.json');
    fs.mkdirSync(path.dirname(cursorFile), { recursive: true });
    const before = JSON.stringify({ mcpServers: { other: { url: 'https://other.example/mcp' } }, keep: 1 });
    fs.writeFileSync(cursorFile, before);
    const cursor = await run(['setup', 'cursor'], { env: t.env });
    assert.equal(cursor.code, 0, cursor.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(cursorFile, 'utf8')), { mcpServers: { other: { url: 'https://other.example/mcp' }, 'agent-data-tools': { url: 'https://agent-data-tools.revmesh2074.workers.dev/mcp/compact' } }, keep: 1 });
    assert.equal(fs.readFileSync(`${cursorFile}.bak`, 'utf8'), before);

    // Claude Desktop: created where the platform keeps it, with the key in the server's env and not on the terminal.
    const desktopFile = process.platform === 'win32' ? path.join(t.appData, 'Claude', 'claude_desktop_config.json')
      : process.platform === 'darwin' ? path.join(t.home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
        : path.join(t.home, '.config', 'Claude', 'claude_desktop_config.json');
    const desktop = await run(['setup', 'claude-desktop', '--key', KEY], { env: t.env });
    assert.equal(desktop.code, 0, desktop.stderr);
    assert.ok(!desktop.stdout.includes(KEY) && !desktop.stderr.includes(KEY));
    assert.deepEqual(JSON.parse(fs.readFileSync(desktopFile, 'utf8')), { mcpServers: { 'agent-data-tools': { command: 'npx', args: ['-y', 'agent-data-tools', 'mcp'], env: { AGENT_DATA_TOOLS_KEY: KEY } } } });
    assert.ok(!fs.existsSync(`${desktopFile}.bak`));

    // Unparseable JSON is left alone and the user is told what to add.
    fs.writeFileSync(cursorFile, '{ "mcpServers": { // comment\n');
    const broken = await run(['setup', 'cursor'], { env: t.env });
    assert.equal(broken.code, 1);
    assert.match(broken.stderr, /left unchanged/);
    assert.match(broken.stderr, /"agent-data-tools"/);
    assert.equal(fs.readFileSync(cursorFile, 'utf8'), '{ "mcpServers": { // comment\n');

    // VS Code: a project file. Without a key it is the remote URL; with one it is the stdio command and the key stays out.
    const project = path.join(t.home, 'project');
    fs.mkdirSync(path.join(project, '.vscode'), { recursive: true });
    const vsFile = path.join(project, '.vscode', 'mcp.json');
    fs.writeFileSync(vsFile, JSON.stringify({ servers: { mine: { type: 'stdio', command: 'node' } } }));
    const vs = await run(['setup', 'vscode'], { env: t.env, cwd: project });
    assert.equal(vs.code, 0, vs.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(vsFile, 'utf8')).servers, { mine: { type: 'stdio', command: 'node' }, 'agent-data-tools': { type: 'http', url: 'https://agent-data-tools.revmesh2074.workers.dev/mcp/compact' } });
    assert.ok(fs.existsSync(`${vsFile}.bak`));
    const vsKey = await run(['setup', 'vscode', '--key', KEY], { env: t.env, cwd: project });
    assert.equal(vsKey.code, 0, vsKey.stderr);
    assert.ok(!fs.readFileSync(vsFile, 'utf8').includes(KEY));
    assert.ok(!vsKey.stdout.includes(KEY) && !vsKey.stderr.includes(KEY));
    assert.deepEqual(JSON.parse(fs.readFileSync(vsFile, 'utf8')).servers['agent-data-tools'], { type: 'stdio', command: 'npx', args: ['-y', 'agent-data-tools', 'mcp'] });
    assert.match(vsKey.stderr, /not written to the project file/);
  } finally { fs.rmSync(t.home, { recursive: true, force: true }); }
});

test('npm client: the compact server is the default; --full names the server with every tool', async () => {
  const t = tempHome();
  const server = await remote();
  try {
    const init = [SESSION[0]];
    await run(['mcp'], { env: { ...t.env, AGENT_DATA_TOOLS_ORIGIN: server.origin }, stdin: init });
    await run(['mcp', '--full'], { env: { ...t.env, AGENT_DATA_TOOLS_ORIGIN: server.origin }, stdin: init });
    assert.deepEqual(server.seen.map((s) => s.url), ['/mcp/compact', '/mcp']);
    const cursor = await run(['setup', 'cursor', '--print', '--full'], { env: t.env });
    assert.deepEqual(JSON.parse(cursor.stdout.split('\n').slice(1).join('\n')), { mcpServers: { 'agent-data-tools': { url: 'https://agent-data-tools.revmesh2074.workers.dev/mcp' } } });
    const desktop = await run(['setup', 'claude-desktop', '--print', '--full'], { env: t.env });
    assert.deepEqual(JSON.parse(desktop.stdout.split('\n').slice(1).join('\n')).mcpServers['agent-data-tools'].args, ['-y', 'agent-data-tools', 'mcp', '--full']);
    const code = await run(['setup', 'claude-code', '--full'], { env: t.env });
    assert.equal(code.stdout.trim(), 'claude mcp add --transport http agent-data-tools https://agent-data-tools.revmesh2074.workers.dev/mcp');
  } finally { await server.close(); fs.rmSync(t.home, { recursive: true, force: true }); }
});

test('npm client: key reports no key without printing one; credits lists the card and USDC places; help names the new commands', async () => {
  const t = tempHome();
  try {
    const none = await run(['key'], { env: t.env });
    assert.match(none.stdout, /No key is set/);
    const bad = await run(['key', 'sk_wrong'], { env: t.env });
    assert.equal(bad.code, 1);
    assert.ok(!fs.existsSync(path.join(t.home, '.agent-data-tools')));
    const credits = await run(['credits'], { env: t.env });
    for (const p of ['/credits\n', '/credits/usdc/1', '/credits/usdc/5', '/credits/usdc/20']) assert.ok(credits.stdout.includes(p), p);
    const help = await run(['--help'], { env: t.env });
    for (const word of ['setup', 'mcp', 'key', 'credits', 'list']) assert.ok(help.stdout.includes(`agent-data-tools ${word}`));
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'clients', 'agent-data-tools', 'package.json'), 'utf8'));
    assert.ok(pkg.files.includes('mcp-stdio.mjs'));
    assert.equal(pkg.dependencies, undefined);
  } finally { fs.rmSync(t.home, { recursive: true, force: true }); }
});
