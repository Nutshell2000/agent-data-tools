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
const STDIO = { command: "npx", args: ["-y", NAME, "mcp"] };
const TARGETS = ["claude-code", "claude-desktop", "cursor", "vscode"];

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

/** Split `--key <value>`, `--key=<value>` and `--print` from the other arguments. */
function parseArgs(args) {
  const rest = [];
  let key, print = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--print") print = true;
    else if (a === "--key") { key = args[++i]; if (!key) throw new ToolError("--key needs a value (adt_...)", 400, null); }
    else if (a.startsWith("--key=")) key = a.slice(6);
    else rest.push(a);
  }
  if (key !== undefined && !validKey(key)) throw new ToolError("the key must start with adt_", 400, null);
  return { rest, key, print };
}

const HELP = `Usage:
  agent-data-tools setup [claude-code|claude-desktop|cursor|vscode] [--key adt_...] [--print]
                                         add the tools to that client (--print shows the change without writing)
  agent-data-tools mcp [--key adt_...]   stdio MCP server that forwards to ${ORIGIN}/mcp
  agent-data-tools key [adt_...]         save a prepaid key; without a key, show whether one is set and its balance
  agent-data-tools credits               where to get a prepaid key (card or USDC)
  agent-data-tools list [words]          tools and prices
  agent-data-tools <tool> key=value ...  call a tool by name or /path; prints its JSON

25 free calls without any setup. A prepaid key is read from --key, then AGENT_DATA_TOOLS_KEY,
then ~/.agent-data-tools/config.json, then ADT_API_KEY.`;

function menu() {
  return `Add the tools to a client:
  agent-data-tools setup claude-code      prints the \`claude mcp add\` command to run
  agent-data-tools setup claude-desktop   writes claude_desktop_config.json
  agent-data-tools setup cursor           writes ~/.cursor/mcp.json
  agent-data-tools setup vscode           writes .vscode/mcp.json in the current folder

Add --print to see the change without writing, and --key adt_... to connect with a prepaid key.
Without a key the server gives 25 free calls. Keys: agent-data-tools credits`;
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

function setup(target, { key, print }) {
  if (!target) { console.log(menu()); return; }
  if (!TARGETS.includes(target)) throw new ToolError(`unknown client "${target}"; use one of: ${TARGETS.join(", ")}`, 400, null);
  const url = `${origin()}/mcp`;
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
  if (!key) { console.log(`No key is set. The server gives 25 free calls without one. Get a key: ${NAME} credits`); return; }
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
    const { key } = parseArgs(rest);
    const { runStdioProxy } = await import("./mcp-stdio.mjs");
    await runStdioProxy({ origin: origin(), key: resolveKey(key).key });
  } else if (command === "setup") {
    const args = parseArgs(rest);
    setup(args.rest[0], args);
  } else if (command === "key") {
    await keyCommand(rest[0]);
  } else if (command === "credits") {
    credits();
  } else {
    const adt = new AgentDataTools({ apiKey: resolveKey().key, origin: origin() });
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
