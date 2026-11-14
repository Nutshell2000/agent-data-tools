// `agent-data-tools mcp`: a stdio MCP server that forwards every JSON-RPC message to the remote server at <origin>/mcp
// (streamable HTTP) and writes the answers back, one JSON message per line. No dependencies.
// Only JSON-RPC lines go to stdout; everything else goes to stderr.
// Wallet mode (ctx.payer, see wallet-pay.mjs): a tools/call that comes back as an x402 payment request is paid from the
// user's wallet and sent once more with the payment in params._meta["x402/payment"]; the client sees only the answer.
import { paymentRequiredOf } from "./wallet-pay.mjs";

const log = (...a) => { try { process.stderr.write(`agent-data-tools mcp: ${a.join(" ")}\n`); } catch { /* stderr closed */ } };
const isRequest = (m) => m && typeof m === "object" && typeof m.method === "string" && m.id !== undefined && m.id !== null;

/** Parse an SSE body as it arrives and hand each `data:` payload (joined across lines of one event) to `onData`. */
async function readSse(body, onData) {
  const decoder = new TextDecoder();
  let buffer = "";
  const flush = (block) => {
    const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
    if (data) onData(data);
  };
  for await (const chunk of body) {
    buffer = (buffer + decoder.decode(chunk, { stream: true })).replace(/\r\n?/g, "\n");
    let cut;
    while ((cut = buffer.indexOf("\n\n")) >= 0) { flush(buffer.slice(0, cut)); buffer = buffer.slice(cut + 2); }
  }
  buffer = (buffer + decoder.decode()).replace(/\r\n?/g, "\n");
  if (buffer.trim()) flush(buffer);
}

/**
 * Forward one client message (or batch) and write whatever comes back.
 * @param {{ url: string, key?: string, session: { id?: string, protocol?: string }, write: (m: unknown) => void, fetch?: typeof fetch }} ctx
 */
export async function forward(ctx, message) {
  const unpaid = [];
  await forwardOnce(ctx, message, ctx.payer ? unpaid : null);
  for (const { request, response, paymentRequired } of unpaid) {
    let reserved;
    try {
      reserved = ctx.payer.guard.take(paymentRequired);
      const payment = await ctx.payer.sign(paymentRequired, reserved.offer);
      const paid = { ...request, params: { ...request.params, _meta: { ...(request.params?._meta ?? {}), "x402/payment": payment } } };
      let failed = false;
      const write = (m) => { if (m?.id === request.id && (m.error || m.result?.isError)) failed = true; ctx.write(m); };
      await forwardOnce({ ...ctx, write }, paid, null);
      if (failed) ctx.payer.guard.refund(reserved.usd); // a failed call is never settled by the server
      else log(`paid $${reserved.usd} for ${request.params?.name ?? "a tool"}; $${ctx.payer.guard.spentToday.toFixed(4)} today`);
    } catch (e) {
      if (reserved) ctx.payer.guard.refund(reserved.usd);
      log(`not paid: ${e?.message ?? e}`);
      ctx.write(response); // the assistant sees the server's own payment request
    }
  }
}

async function forwardOnce(ctx, message, unpaid) {
  const requests = (Array.isArray(message) ? message : [message]).filter(isRequest);
  const answered = new Set();
  const out = (m) => {
    for (const one of Array.isArray(m) ? m : [m]) {
      if (!one || typeof one !== "object") continue;
      if (one.id !== undefined && one.id !== null && !one.method) answered.add(one.id);
      const protocol = one.result?.protocolVersion;
      if (typeof protocol === "string" && requests.some((r) => r.method === "initialize" && r.id === one.id)) ctx.session.protocol = protocol;
      if (unpaid) {
        const request = requests.find((r) => r.id === one.id && r.method === "tools/call");
        const paymentRequired = request ? paymentRequiredOf(one.result) : null;
        if (paymentRequired) { unpaid.push({ request, response: one, paymentRequired }); continue; }
      }
      ctx.write(one);
    }
  };
  const fail = (text) => { for (const r of requests) if (!answered.has(r.id)) ctx.write({ jsonrpc: "2.0", id: r.id, error: { code: -32000, message: text } }); };
  try {
    const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
    if (ctx.key) headers.authorization = `Bearer ${ctx.key}`;
    if (ctx.session.id) headers["mcp-session-id"] = ctx.session.id;
    if (ctx.session.protocol) headers["mcp-protocol-version"] = ctx.session.protocol;
    const res = await (ctx.fetch ?? globalThis.fetch)(ctx.url, { method: "POST", headers, body: JSON.stringify(message) });
    const session = res.headers.get("mcp-session-id");
    if (session) ctx.session.id = session;
    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    if (res.ok && type.includes("text/event-stream") && res.body) {
      await readSse(res.body, (data) => { try { out(JSON.parse(data)); } catch { log("ignored an event that is not JSON"); } });
      if (requests.some((r) => !answered.has(r.id))) fail("the server closed the stream without an answer");
      return;
    }
    const text = await res.text();
    let body;
    try { body = text ? JSON.parse(text) : undefined; } catch { body = undefined; }
    const rpc = (Array.isArray(body) ? body : [body]).every((m) => m && typeof m === "object" && m.jsonrpc === "2.0");
    if (body !== undefined && rpc) { out(body); if (res.ok) return; }
    if (res.ok) { if (requests.length) fail("the server answered without a JSON-RPC message"); return; }
    const detail = typeof body?.error === "string" ? body.error : text.replace(/\s+/g, " ").trim().slice(0, 200);
    log(`HTTP ${res.status}`);
    fail(`the server answered HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
  } catch (e) {
    log(`request failed: ${e?.message ?? e}`);
    fail(`could not reach the server: ${e?.cause?.code ?? e?.message ?? "network error"}`);
  }
}

/** Run the proxy on stdin/stdout until stdin closes. */
export async function runStdioProxy({ origin, key, payer, path = "/mcp/compact", input = process.stdin, output = process.stdout }) {
  const ctx = { url: `${origin.replace(/\/$/, "")}${path}`, key, payer, session: {}, write: (m) => output.write(`${JSON.stringify(m)}\n`) };
  log(`forwarding to ${ctx.url}${key ? " with a key" : payer ? ` paying per call from wallet ${payer.address} (USDC on Base)` : " without a key (free calls)"}`);
  const pending = new Set();
  let gate = Promise.resolve(); // initialize finishes before anything after it is sent, so the session id is known
  const handle = (line) => {
    if (!line.trim()) return;
    let message;
    try { message = JSON.parse(line); } catch { ctx.write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }); return; }
    const first = Array.isArray(message) ? message.some((m) => m?.method === "initialize") : message?.method === "initialize";
    const run = gate.then(() => forward(ctx, message)).catch((e) => log(`unexpected: ${e?.message ?? e}`));
    if (first) gate = run;
    pending.add(run);
    run.finally(() => pending.delete(run));
  };
  let buffer = "";
  input.setEncoding("utf8");
  input.on("data", (chunk) => {
    buffer += chunk;
    let cut;
    while ((cut = buffer.indexOf("\n")) >= 0) { handle(buffer.slice(0, cut)); buffer = buffer.slice(cut + 1); }
  });
  await new Promise((done) => { input.on("end", done); input.on("close", done); input.on("error", done); });
  if (buffer.trim()) handle(buffer);
  while (pending.size) await Promise.allSettled([...pending]);
}
