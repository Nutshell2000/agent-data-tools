#!/usr/bin/env node
// npx agent-data-tools setup [client]          put the tools into Claude Code, Claude Desktop, Cursor or VS Code
// npx agent-data-tools mcp                     stdio MCP server that forwards to the remote one
// npx agent-data-tools key [adt_...]           save a prepaid key, or show whether one is set and its balance
// npx agent-data-tools credits                 where to get a key
// npx agent-data-tools list [words]            tools and prices
// npx agent-data-tools <tool> key=value …      call a tool (name or /path); prints its JSON
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { AgentDataTools, ORIGIN, PaymentRequired, ToolError } from "./index.mjs";

const NAME = "agent-data-tools";
// The server a client is connected to. The default is the compact one: three tools (find_tool, tool_details, call_tool)
// that reach the whole catalog, so the assistant does not carry several hundred tool definitions. --full picks the
// server that lists every tool as its own definition.
const serverPath = (full) => (full ? "/mcp/all" : "/mcp/compact");
const stdio = (full) => ({ command: "npx", args: full ? ["-y", NAME, "mcp", "--full"] : ["-y", NAME, "mcp"] });
const TARGETS = ["claude-code", "claude-desktop", "cursor", "vscode", "windsurf"];

const origin = () => (process.env.AGENT_DATA_TOOLS_ORIGIN || ORIGIN).replace(/\/$/, "");
const configFile = () => join(homedir(), ".agent-data-tools", "config.json");
const tail = (key) => `…${key.slice(-4)}`;
const validKey = (key) => typeof key === "string" && /^adt_\S+$/.test(key);

function readConfig() {
  try { const c = JSON.parse(readFileSync(configFile(), "utf8").replace(/^﻿/, "")); return c && typeof c === "object" && !Array.isArray(c) ? c : {}; } catch { return {}; }
}

/** The key and where it came from: --key, AGENT_DATA_TOOLS_KEY, the config file, then ADT_API_KEY (the library's variable). */
function resolveKey(flag) {
  if (flag) return { key: flag, source: "--key" };
  if (process.env.AGENT_DATA_TOOLS_KEY) return { key: process.env.AGENT_DATA_TOOLS_KEY, source: "AGENT_DATA_TOOLS_KEY" };
  const saved = readConfig().key;
  if (typeof saved === "string" && saved) return { key: saved, source: configFile() };
  if (process.env.ADT_API_KEY) return { key: process.env.ADT_API_KEY, source: "ADT_API_KEY" };
  return { key: undefined, source: undefined };
}

/**
 * With no prepaid key and a wallet key in the environment, return the paying fetch for direct/read calls. Wallet mode
 * used to be MCP-only (cli.mjs mcp), so `read` and direct tool calls silently fell back to the 3-call free trial and
 * stopped after a few URLs. The key is read from the environment only and never appears in arguments or output.
 */
async function payingFetchFromEnv(key) {
  if (key || !process.env.AGENT_DATA_TOOLS_WALLET_KEY) return undefined;
  const { walletPayer, payingFetch, limitsFromEnv } = await import("./wallet-pay.mjs");
  const payer = await walletPayer({ key: process.env.AGENT_DATA_TOOLS_WALLET_KEY.trim(), ...limitsFromEnv() });
  process.stderr.write(`wallet mode: paying per call from ${payer.address} (USDC on Base)\n`);
  return payingFetch(payer);
}

/** Split `--key <value>`, `--key=<value>`, `--print` and `--full` from the other arguments. */
function parseArgs(args) {
  const rest = [];
  let key, print = false, full = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--print") print = true;
    else if (a === "--full") full = true;
    else if (a === "--key") { key = args[++i]; if (!key) throw new ToolError("--key needs a value (adt_...)", 400, null); }
    else if (a.startsWith("--key=")) key = a.slice(6);
    else rest.push(a);
  }
  if (key !== undefined && !validKey(key)) throw new ToolError("the key must start with adt_", 400, null);
  return { rest, key, print, full };
}

const HELP = `Usage:
  agent-data-tools setup [claude-code|claude-desktop|cursor|vscode|windsurf] [--key adt_...] [--print] [--full]
                                         add the tools to that client (--print shows the change without writing)
  agent-data-tools mcp [--key adt_...] [--full]
                                         stdio MCP server that forwards to ${ORIGIN}/mcp/compact
  The client gets three tools that find, describe and run any tool in the catalog.
  --full connects ${ORIGIN}/mcp/all instead: every tool as its own definition (several hundred).
  agent-data-tools key [adt_...]         save a prepaid key; without a key, show whether one is set and its balance
  agent-data-tools credits               where to get a prepaid key (card or USDC)
  agent-data-tools list [words]          tools and prices
  agent-data-tools read [urls.txt|-] [--concurrency 8] [--format markdown|text|both] [--max-chars N] [--key adt_...]
                                         read a list of web pages (one URL per line); one JSON line per page on stdout;
                                         failed pages are reported and not charged
  agent-data-tools <tool> key=value ...  call a tool by name or /path; prints its JSON

3 free calls over HTTP (25 over MCP) without any setup. A prepaid key is read from --key, then AGENT_DATA_TOOLS_KEY,
then ~/.agent-data-tools/config.json, then ADT_API_KEY.

Wallet mode for \`mcp\`, \`read\` and direct tool calls (no account, no key): set AGENT_DATA_TOOLS_WALLET_KEY to the private key of a wallet holding
USDC on Base. After the free calls each call is paid over x402 at its listed price, at most $0.10 a call and $1 a day
unless AGENT_DATA_TOOLS_MAX_USD and AGENT_DATA_TOOLS_DAILY_USD say otherwise. Failed calls are not charged.`;

function menu() {
  return `Add the tools to a client:
  agent-data-tools setup claude-code      prints the \`claude mcp add\` command to run
  agent-data-tools setup claude-desktop   writes claude_desktop_config.json
  agent-data-tools setup cursor           writes ~/.cursor/mcp.json
  agent-data-tools setup vscode           writes .vscode/mcp.json in the current folder
  agent-data-tools setup windsurf         writes ~/.codeium/windsurf/mcp_config.json

Add --print to see the change without writing, and --key adt_... to connect with a prepaid key.
The client gets three tools that reach the whole catalog; add --full for every tool as its own definition.
Without a key the server gives 3 free calls over HTTP (25 over MCP). Keys: agent-data-tools credits`;
}

function desktopConfigPath() {
  if (process.platform === "win32") return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  return join(homedir(), ".config", "Claude", "claude_desktop_config.json");
}

/** Add one server entry to a JSON config file, keeping everything else; a copy of the old file stays next to it as .bak. */
function mergeInto(file, section, entry, print) {
  const snippet = JSON.stringify({ [section]: { [NAME]: entry } }, null, 2);
  if (print) { console.log(`${file}\n${snippet}`); return false; }
  let json = {};
  const exists = existsSync(file);
  if (exists) {
    try { json = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")); } catch { json = null; }
    const usable = json && typeof json === "object" && !Array.isArray(json) && (json[section] === undefined || (json[section] && typeof json[section] === "object" && !Array.isArray(json[section])));
    if (!usable) {
      console.error(`${file} is not JSON this command can edit, so it was left unchanged. Add this to it yourself:\n${snippet}`);
      process.exitCode = 1;
      return false;
    }
    copyFileSync(file, `${file}.bak`);
  } else mkdirSync(dirname(file), { recursive: true });
  json[section] = { ...(json[section] ?? {}), [NAME]: entry };
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`${exists ? "Updated" : "Created"} ${file}${exists ? ` (previous version: ${file}.bak)` : ""}`);
  return true;
}

function setup(target, { key, print, full }) {
  if (!target) { console.log(menu()); return; }
  if (!TARGETS.includes(target)) throw new ToolError(`unknown client "${target}"; use one of: ${TARGETS.join(", ")}`, 400, null);
  const url = `${origin()}${serverPath(full)}`;
  const STDIO = stdio(full);
  const saved = key ? undefined : resolveKey().key;
  const savedNote = `A key is already saved for this computer; pass it with --key to connect ${target} with it.`;
  if (target === "claude-code") {
    console.log(`claude mcp add --transport http ${NAME} ${url}${key ? ` --header "Authorization: Bearer ${key}"` : ""}`);
    console.error(`Run the command above in a terminal; it registers the server with Claude Code.${saved ? `\n${savedNote}` : ""}`);
  } else if (target === "claude-desktop") {
    // Claude Desktop starts local commands; the stdio server reads the key from its environment or the config file.
    const entry = key ? { ...STDIO, env: { AGENT_DATA_TOOLS_KEY: key } } : STDIO;
    if (mergeInto(desktopConfigPath(), "mcpServers", entry, print)) console.error(`Restart Claude Desktop to load it.${key ? ` The key (${tail(key)}) is in the server's env.` : saved ? " The saved key is used." : ""}`);
  } else if (target === "cursor") {
    const entry = key ? { url, headers: { Authorization: `Bearer ${key}` } } : { url };
    if (mergeInto(join(homedir(), ".cursor", "mcp.json"), "mcpServers", entry, print)) console.error(`Cursor reads it for every project.${key ? ` The key (${tail(key)}) is sent as a header.` : saved ? `\n${savedNote}` : ""}`);
  } else if (target === "windsurf") {
    // Windsurf (21 Nov 2026) reads remote servers from ~/.codeium/windsurf/mcp_config.json as mcpServers.<name>.serverUrl.
    const entry = key ? { serverUrl: url, headers: { Authorization: `Bearer ${key}` } } : { serverUrl: url };
    if (mergeInto(join(homedir(), ".codeium", "windsurf", "mcp_config.json"), "mcpServers", entry, print)) console.error(`Open Windsurf's MCP settings and press Refresh to load it.${key ? ` The key (${tail(key)}) is sent as a header.` : saved ? `
${savedNote}` : ""}`);
  } else {
    // A project file may be committed, so a key never goes into it: with a key, the entry is the stdio command, which reads the key itself.
    const entry = key || saved ? { type: "stdio", ...STDIO } : { type: "http", url };
    const done = mergeInto(resolve(".vscode", "mcp.json"), "servers", entry, print);
    if (key) console.error(`The key is not written to the project file. Save it once with \`${NAME} key <your key>\` (or set AGENT_DATA_TOOLS_KEY); the command in the file reads it from there.`);
    else if (saved && done) console.error("The command in the file reads your saved key; nothing secret is in the project file.");
  }
}

async function keyCommand(value) {
  if (value !== undefined) {
    if (!validKey(value)) throw new ToolError("the key must start with adt_", 400, null);
    const file = configFile();
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, `${JSON.stringify({ ...readConfig(), key: value }, null, 2)}\n`, { mode: 0o600 });
    try { chmodSync(file, 0o600); } catch { /* not supported on this file system */ }
    console.log(`Saved the key ending in ${tail(value)} to ${file}`);
    return;
  }
  const { key, source } = resolveKey();
  if (!key) { console.log(`No key is set. The server gives 3 free calls over HTTP (25 over MCP) without one. Get a key: ${NAME} credits`); return; }
  console.log(`A key is set (ends in ${tail(key)}), from ${source}.`);
  try {
    const res = await fetch(`${origin()}/credits/balance`, { headers: { accept: "application/json", "x-api-key": key } });
    const body = await res.json().catch(() => null);
    if (res.ok && body && typeof body.balanceCredits === "number") console.log(`Balance: ${body.balanceCredits} credits (${body.calls ?? 0} calls so far).`);
    else console.log(`Balance not available: ${typeof body?.error === "string" ? body.error : `HTTP ${res.status}`}`);
  } catch (e) {
    console.log(`Balance not available: ${e?.cause?.code ?? e?.message ?? "network error"}`);
  }
}

/**
 * Bulk web reading (1.4.0, 18 Nov 2026): one URL per line from a file or stdin, read through /extract with a worker pool,
 * one JSON line per page on stdout ({url, ok, status, markdown|text, chars, error}). A failed page is reported and not
 * charged; the run goes on. It stops only when payment is needed (no key and the free calls are used up).
 */
async function readCommand(args) {
  let file, concurrency = 8, format = "markdown", maxChars;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--concurrency" || a === "-c") concurrency = Number(args[++i]);
    else if (a.startsWith("--concurrency=")) concurrency = Number(a.slice(14));
    else if (a === "--format") format = args[++i];
    else if (a.startsWith("--format=")) format = a.slice(9);
    else if (a === "--max-chars") maxChars = args[++i];
    else if (a.startsWith("--max-chars=")) maxChars = a.slice(12);
    else if (!file) file = a;
    else throw new ToolError(`unexpected argument "${a}"`, 400, null);
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 64) throw new ToolError("--concurrency must be 1-64", 400, null);
  if (!["markdown", "text", "both"].includes(format)) throw new ToolError("--format must be markdown, text or both", 400, null);
  const source = !file || file === "-" ? readFileSync(0, "utf8") : readFileSync(file, "utf8");
  const urls = [...new Set(source.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^https?:\/\//i.test(l)))];
  if (!urls.length) throw new ToolError("no http(s) URLs found (one per line)", 400, null);
  const { key } = resolveKey(globalThis.__adtKeyFlag);
  const paying = await payingFetchFromEnv(key);
  const adt = new AgentDataTools({ apiKey: key, fetch: paying, origin: origin() });
  let next = 0, ok = 0, stopped = null;
  const started = Date.now();
  const worker = async () => {
    while (next < urls.length && !stopped) {
      const url = urls[next++];
      try {
        const r = await adt.call("/extract", { url, format, ...(maxChars ? { maxChars } : {}) });
        const body = format === "text" ? { text: r.text } : format === "both" ? { markdown: r.markdown, text: r.text } : { markdown: r.markdown };
        ok++;
        process.stdout.write(`${JSON.stringify({ url, ok: true, status: 200, title: r.title ?? null, ...body, chars: (r.markdown ?? r.text ?? "").length })}\n`);
      } catch (e) {
        if (e instanceof PaymentRequired) { stopped = e; return; }
        process.stdout.write(`${JSON.stringify({ url, ok: false, status: e?.status ?? null, error: e?.body?.error ?? e?.message ?? String(e) })}\n`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  console.error(`read ${ok} of ${urls.length} pages in ${((Date.now() - started) / 1000).toFixed(1)} s; failed pages are not charged.`);
  if (stopped) { console.error(`Stopped: ${stopped.message}. Save a key with \`${NAME} key adt_...\` (${NAME} credits).`); process.exitCode = 2; }
}

function credits() {
  const o = origin();
  console.log(`Card: ${o}/credits
  Open it in a browser to buy a prepaid key with a card.
USDC, $1:  ${o}/credits/usdc/1
USDC, $5:  ${o}/credits/usdc/5
USDC, $20: ${o}/credits/usdc/20
  Each is an x402 route: an x402 client that pays it gets a key back. This command does not pay.

Then: ${NAME} key adt_...   saves the key for \`${NAME} mcp\` and for tool calls.
Balance: ${NAME} key`);
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
  } else if (command === "mcp") {
    // Nothing but JSON-RPC may reach stdout here.
    const { key, full } = parseArgs(rest);
    const { runStdioProxy } = await import("./mcp-stdio.mjs");
    const prepaid = resolveKey(key).key;
    // Wallet mode: no prepaid key, and a private key in the environment. The key never appears in arguments or output.
    let payer;
    if (!prepaid && process.env.AGENT_DATA_TOOLS_WALLET_KEY) {
      const { walletPayer, limitsFromEnv } = await import("./wallet-pay.mjs");
      payer = await walletPayer({ key: process.env.AGENT_DATA_TOOLS_WALLET_KEY.trim(), ...limitsFromEnv() });
    }
    await runStdioProxy({ origin: origin(), key: prepaid, payer, path: serverPath(full) });
  } else if (command === "setup") {
    const args = parseArgs(rest);
    setup(args.rest[0], args);
  } else if (command === "key") {
    await keyCommand(rest[0]);
  } else if (command === "credits") {
    credits();
  } else if (command === "read") {
    const { rest: readArgs, key } = parseArgs(rest);
    globalThis.__adtKeyFlag = key;
    await readCommand(readArgs);
  } else {
    const { key } = resolveKey();
    const paying = await payingFetchFromEnv(key);
    const adt = new AgentDataTools({ apiKey: key, fetch: paying, origin: origin() });
    if (command === "list") {
      for (const t of await adt.tools({ search: rest.join(" ") })) console.log(`${t.name.padEnd(30)} ${t.price.padEnd(8)} ${t.summary}`);
    } else {
      const inputs = {};
      for (const arg of rest) {
        const eq = arg.indexOf("=");
        if (eq < 1) throw new ToolError(`expected key=value, got "${arg}"`, 400, null);
        inputs[arg.slice(0, eq)] = arg.slice(eq + 1);
      }
      console.log(JSON.stringify(await adt.call(command, inputs), null, 2));
    }
  }
} catch (e) {
  console.error(e instanceof PaymentRequired || e instanceof ToolError ? e.message : e);
  process.exitCode = 1;
}
