import { x402Client } from "@x402/core/client";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { formatUnits } from "viem";
import packageInfo from "./package.json" with { type: "json" };

export const VERSION = packageInfo.version;
export const ORIGIN = "https://agent-data-tools.revmesh2074.workers.dev";
export const RECIPIENT = "0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5";
export const ASSET = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const NETWORK = "eip155:8453";
export const OPERATIONS = Object.freeze({
  tx: { path: "/base-tx", maxAtomic: 3000n, inputs: ["hash"] },
  wallet: { path: "/wallet", maxAtomic: 5000n, inputs: ["address"] },
  gas: { path: "/base-gas", maxAtomic: 2000n, inputs: [] },
  allowance: { path: "/base-allowance", maxAtomic: 2000n, inputs: ["token", "owner", "spender"] },
});
const address = v => typeof v === "string" && /^0x[\da-f]{40}$/i.test(v);
const hash = v => typeof v === "string" && /^0x[\da-f]{64}$/i.test(v);
const same = (a, b) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();
const uint = v => typeof v === "string" && /^(?:0|[1-9]\d{0,77})$/.test(v) && BigInt(v) < 2n ** 256n;
const decimal = v => typeof v === "string" && /^\d{1,100}(?:\.\d{1,255})?$/.test(v);
const integer = v => Number.isSafeInteger(v) && v >= 0;
const date = v => typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v));
const nullable = (v, check) => v === null || check(v);
const symbol = v => v === null || (typeof v === "string" && v.length <= 64 && !/[\u0000-\u001f\u007f]/.test(v));
const fail = code => { throw Error(code); };
const money = atomic => (Number(atomic) / 1e6).toFixed(6);

export function parseChainArgs(args) {
  if (!args.length || (args.length === 1 && args[0] === "--help")) return { command: "help" };
  const [command, operation, ...tail] = args;
  if (!["quote", "buy"].includes(command) || !Object.hasOwn(OPERATIONS, operation) || tail.length % 2) fail("usage_error");
  const spec = OPERATIONS[operation], flags = new Map();
  for (let i = 0; i < tail.length; i += 2) {
    const name = tail[i].slice(2);
    if (!tail[i].startsWith("--") || ![...spec.inputs, "max-usdc"].includes(name) || flags.has(name)) fail("usage_error");
    flags.set(name, tail[i + 1]);
  }
  const query = {};
  for (const name of spec.inputs) {
    const value = flags.get(name)?.trim();
    if (!(name === "hash" ? hash(value) : address(value))) fail("invalid_chain_input");
    query[name] = value;
  }
  let capAtomic = spec.maxAtomic;
  const cap = flags.get("max-usdc");
  if (command === "buy" || cap !== undefined) {
    if (typeof cap !== "string" || !/^0(?:\.\d{1,6})?$/.test(cap)) fail("explicit_bounded_cap_required");
    capAtomic = BigInt((cap.split(".")[1] ?? "").padEnd(6, "0") || "0");
    if (capAtomic < 1n || capAtomic > spec.maxAtomic) fail("explicit_bounded_cap_required");
  }
  const url = new URL(spec.path, ORIGIN);
  url.search = new URLSearchParams(query).toString();
  return { command, operation, query, capAtomic, url, spec };
}

export function allowedRequirement(r, cap) {
  return r?.scheme === "exact" && r.network === NETWORK && same(r.payTo, RECIPIENT) && same(r.asset, ASSET) &&
    typeof r.amount === "string" && /^\d{1,16}$/.test(r.amount) && BigInt(r.amount) > 0n && BigInt(r.amount) <= cap &&
    integer(r.maxTimeoutSeconds) && r.maxTimeoutSeconds > 0 && r.maxTimeoutSeconds <= 3600 &&
    (!r.extra?.assetTransferMethod || r.extra.assetTransferMethod === "eip3009") &&
    (!r.extra?.name || r.extra.name === "USD Coin") && (!r.extra?.version || r.extra.version === "2");
}

async function authorize(required, key, cap) {
  const client = new x402Client().register(NETWORK, new ExactEvmScheme(privateKeyToAccount(key)))
    .setSpendControls({ maxAmountPerPayment: "$" + money(cap) })
    .registerPolicy((_version, entries) => entries.filter(r => allowedRequirement(r, cap)));
  return client.createPaymentPayload(required);
}

export const LIMITATIONS = Object.freeze({
  tx: ["Execution status does not prove the intended token, recipient or amount was paid.", "Pending is inconclusive; upstream receipt availability may be incomplete. No automatic paid polling."],
  wallet: ["Missing token rows are not proof of zero balance. This is a partial snapshot, not full transaction or token history.", "Concurrent reads need not represent one atomic block snapshot."],
  gas: ["Estimates cover Base execution only and exclude Ethereum posting costs. They are not a transaction-specific simulation."],
  allowance: ["Positive allowance does not prove it covers the intended amount. This result does not authorize or execute an approval or transfer."],
});

/** Validate and project documented fields only; never echo arbitrary service/error fields. */
export function checkedResult(operation, r, q) {
  if (!r || r.chain !== "base") fail("invalid_result");
  let keys;
  if (operation === "tx") {
    if (!same(r.hash, q.hash) || !["pending", "success", "reverted"].includes(r.status) || !address(r.from) ||
      !nullable(r.to, address) || !nullable(r.contractCreated, address) || !decimal(r.valueEth) || !integer(r.nonce) ||
      !nullable(r.methodId, v => typeof v === "string" && /^0x[\da-f]{8}$/i.test(v)) || !nullable(r.blockNumber, integer) ||
      !nullable(r.blockTime, date) || !integer(r.confirmations) || !nullable(r.gasUsed, integer) ||
      !nullable(r.gasPriceGwei, decimal) || !nullable(r.executionFeeEth, decimal) || !nullable(r.logCount, integer) || !date(r.checkedAt)) fail("invalid_result");
    if (r.status === "pending" ? (r.blockNumber !== null || r.confirmations !== 0 || r.gasUsed !== null) : (r.blockNumber === null || r.confirmations < 1 || r.gasUsed === null)) fail("invalid_result");
    keys = ["chain", "hash", "status", "from", "to", "contractCreated", "valueEth", "nonce", "methodId", "blockNumber", "blockTime", "confirmations", "gasUsed", "gasPriceGwei", "executionFeeEth", "logCount", "checkedAt"];
  } else if (operation === "wallet") {
    if (r.chainId !== 8453 || !same(r.address, q.address) || !["eoa", "eoa-delegated", "contract"].includes(r.type) ||
      !nullable(r.delegatedTo, address) || !uint(r.eth?.wei) || !decimal(r.eth?.formatted) || !integer(r.accountNonce) ||
      !integer(r.blockNumber) || !integer(r.tokensChecked) || r.tokensChecked > 28 || !Array.isArray(r.tokens) || r.tokens.length > r.tokensChecked ||
      !r.tokens.every(t => address(t?.address) && symbol(t.symbol) && integer(t.decimals) && t.decimals <= 255 && uint(t.balance) && decimal(t.balanceFormatted) && t.balanceFormatted === formatUnits(BigInt(t.balance), t.decimals)) ||
      r.eth.formatted !== formatUnits(BigInt(r.eth.wei), 18) || (r.type === "eoa-delegated" ? r.delegatedTo === null : r.delegatedTo !== null) ||
      new Set(r.tokens.map(t => t.address.toLowerCase())).size !== r.tokens.length) fail("invalid_result");
    const tokens = r.tokens.map(t => ({ address: t.address, symbol: t.symbol, decimals: t.decimals, balance: t.balance, balanceFormatted: t.balanceFormatted }));
    return { chain: r.chain, chainId: r.chainId, address: r.address, type: r.type, delegatedTo: r.delegatedTo,
      eth: { wei: r.eth.wei, formatted: r.eth.formatted }, accountNonce: r.accountNonce, tokens, tokensChecked: r.tokensChecked, blockNumber: r.blockNumber };
  } else if (operation === "gas") {
    if (r.chainId !== 8453 || !integer(r.blockNumber) || !date(r.blockTime) || !date(r.checkedAt) ||
      ![r.baseFeeGwei, r.priorityFeeGwei, r.gasPriceGwei, r.estimatedExecutionFeeEth?.ethTransfer, r.estimatedExecutionFeeEth?.erc20Transfer].every(decimal) ||
      !uint(r.suggested?.maxFeePerGasWei) || !uint(r.suggested?.maxPriorityFeePerGasWei) ||
      typeof r.blockUsedPercent !== "number" || !Number.isFinite(r.blockUsedPercent) || r.blockUsedPercent < 0 || r.blockUsedPercent > 100) fail("invalid_result");
    return { chain: r.chain, chainId: r.chainId, blockNumber: r.blockNumber, blockTime: r.blockTime, checkedAt: r.checkedAt,
      baseFeeGwei: r.baseFeeGwei, priorityFeeGwei: r.priorityFeeGwei, gasPriceGwei: r.gasPriceGwei, blockUsedPercent: r.blockUsedPercent,
      suggested: { maxFeePerGasWei: r.suggested.maxFeePerGasWei, maxPriorityFeePerGasWei: r.suggested.maxPriorityFeePerGasWei },
      estimatedExecutionFeeEth: { ethTransfer: r.estimatedExecutionFeeEth.ethTransfer, erc20Transfer: r.estimatedExecutionFeeEth.erc20Transfer } };
  } else if (operation === "allowance") {
    if (!["token", "owner", "spender"].every(k => same(r[k], q[k])) || !symbol(r.symbol) || !integer(r.decimals) || r.decimals > 255 ||
      !uint(r.allowance) || !decimal(r.allowanceFormatted) || r.allowanceFormatted !== formatUnits(BigInt(r.allowance), r.decimals) || r.approved !== (BigInt(r.allowance) > 0n) ||
      r.unlimited !== (BigInt(r.allowance) >= 2n ** 255n) || !date(r.checkedAt)) fail("invalid_result");
    keys = ["chain", "token", "owner", "spender", "symbol", "decimals", "allowance", "allowanceFormatted", "approved", "unlimited", "checkedAt"];
  } else fail("invalid_result");
  return Object.fromEntries(keys.map(k => [k, r[k]]));
}

async function jsonBody(response) {
  if (!/^application\/json(?:;|$)/i.test(response.headers.get("Content-Type") ?? "")) {
    await response.body?.cancel(); fail("invalid_result");
  }
  if (!response.body) fail("invalid_result");
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if ((size += value.length) > 512 * 1024) { await reader.cancel(); fail("result_too_large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { fail("invalid_result"); }
}

function receiptFrom(response) {
  const h = response.headers.get("PAYMENT-RESPONSE");
  if (!h || h.length > 16000) return null;
  try {
    const r = decodePaymentResponseHeader(h);
    if (typeof r.success !== "boolean" || r.network !== NETWORK || (r.success && !hash(r.transaction))) return null;
    return { success: r.success, network: r.network, transaction: hash(r.transaction) ? r.transaction : null,
      ...(address(r.payer) ? { payer: r.payer } : {}) };
  } catch { return null; }
}
const requestIdFrom = r => /^[a-z\d_-]{1,80}$/i.test(r.headers.get("X-Request-ID") ?? "") ? r.headers.get("X-Request-ID") : null;
const statusOf = (signed, receipt) => receipt?.success ? "settled" : receipt ? "reported_not_settled" : signed ? "unknown" : "not_signed";
const safeErrors = new Set(["usage_error", "invalid_chain_input", "explicit_bounded_cap_required", "invalid_payment_quote", "unexpected_payment_resource", "payment_terms_rejected", "missing_or_invalid_local_key", "invalid_result", "result_too_large"]);

/** Test injection cannot be selected by executable flags or environment origin overrides. */
export async function runChain(args, { fetcher = globalThis.fetch, getKey = () => process.env.X402_PRIVATE_KEY, createPayload = authorize } = {}) {
  let signed = false, receipt = null, requestId = null;
  const finish = value => ({ clientVersion: VERSION, retryAutomatically: false, ...value,
    ...(signed && !value.ok ? { guidance: "Stop and reconcile using the request ID, UTC time and available receipt. Do not start a fresh purchase to recover this outcome. Receipts are server-reported, not independent chain proof." } : {}) });
  try {
    const o = parseChainArgs(args);
    if (o.command === "help") return finish({ ok: true, paymentStatus: "not_signed", help: "Node >=20.19. quote|buy tx --hash <0xhash>; wallet --address <0xaddress>; gas; allowance --token <0xaddress> --owner <0xaddress> --spender <0xaddress>. Every buy also requires --max-usdc: tx <=0.003, wallet <=0.005, gas/allowance <=0.002. Quotes never read keys or pay. Buy uses existing local X402_PRIVATE_KEY and authorizes at most once. No automatic retries or polling; caps apply per invocation, not per session/month. Checks never send transactions, approvals or transfers other than the explicit x402 tool payment." });
    const request = headers => ({ method: "GET", redirect: "error", signal: AbortSignal.timeout(signed ? 60000 : 20000), headers: { Accept: "application/json", "X402-Source": "chain_cli_100", ...headers } });
    const response = await fetcher(o.url, request({})); requestId = requestIdFrom(response);
    if (response.status !== 402) { await response.body?.cancel(); return finish({ ok: false, error: "expected_unpaid_402_quote", httpStatus: response.status, paymentStatus: "not_signed", requestId }); }
    await response.body?.cancel();
    const h = response.headers.get("PAYMENT-REQUIRED");
    if (!h || h.length > 64000) fail("invalid_payment_quote");
    let required; try { required = decodePaymentRequiredHeader(h); } catch { fail("invalid_payment_quote"); }
    if (required.x402Version !== 2 || !Array.isArray(required.accepts)) fail("invalid_payment_quote");
    if (required.resource?.url !== o.url.href) fail("unexpected_payment_resource");
    const selected = required.accepts.find(r => allowedRequirement(r, o.capAtomic));
    if (!selected) fail("payment_terms_rejected");
    const quote = { scheme: selected.scheme, network: selected.network, asset: selected.asset, payTo: selected.payTo, amountAtomic: selected.amount, usdc: money(selected.amount) };
    if (o.command === "quote") return finish({ ok: true, operation: o.operation, paymentStatus: "not_signed", quote, requestId });
    const key = getKey();
    if (typeof key !== "string" || !/^0x[\da-f]{64}$/i.test(key) || /^0x0+$/i.test(key)) fail("missing_or_invalid_local_key");
    signed = true; // Conservative even if signing throws before a payload is returned.
    const payload = await createPayload({ ...required, accepts: [selected], extensions: undefined }, key, o.capAtomic);
    const paid = await fetcher(o.url, request({ "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(payload) }));
    requestId = requestIdFrom(paid) ?? requestId; receipt = receiptFrom(paid);
    const paymentStatus = statusOf(signed, receipt);
    if (!paid.ok) { await paid.body?.cancel(); return finish({ ok: false, error: "paid_request_failed", httpStatus: paid.status, operation: o.operation, paymentStatus, receipt, requestId }); }
    if (!receipt?.success) { await paid.body?.cancel(); return finish({ ok: false, error: "settlement_receipt_unconfirmed", operation: o.operation, paymentStatus, receipt, requestId }); }
    const result = checkedResult(o.operation, await jsonBody(paid), o.query);
    return finish({ ok: true, operation: o.operation, paymentStatus, result, limitations: LIMITATIONS[o.operation], receipt, requestId });
  } catch (error) {
    return finish({ ok: false, error: safeErrors.has(error?.message) ? error.message : signed ? "purchase_outcome_uncertain" : "quote_or_input_failed",
      paymentStatus: statusOf(signed, receipt), receipt, requestId });
  }
}
