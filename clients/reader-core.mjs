import { x402Client } from "@x402/core/client";
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { parseTarget } from "../src/lib/fetch.ts";
import { createHash } from "node:crypto";

export const READER_ORIGIN = "https://agent-data-tools.revmesh2074.workers.dev";
export const READER_RECIPIENT = "0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5";
export const READER_ASSET = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const NETWORK = "eip155:8453";
const fail = (code) => {
  throw new Error(code);
};

export function parseReaderArgs(args) {
  if (!args.length || args[0] === "--help") return { command: "help" };
  const [command, target, ...rest] = args;
  if (!["quote", "buy"].includes(command) || !target) fail("usage_error");
  const url = parseTarget(target).href;
  const flags = new Map();
  for (let i = 0; i < rest.length; i += 2) {
    if (
      !["--max-usdc", "--format", "--max-chars"].includes(rest[i]) ||
      flags.has(rest[i]) ||
      rest[i + 1] === undefined
    )
      fail("usage_error");
    flags.set(rest[i], rest[i + 1]);
  }
  const format = flags.get("--format") ?? "text";
  const limit = flags.get("--max-chars") ?? "20000";
  if (
    !["text", "markdown", "both"].includes(format) ||
    !/^\d+$/.test(limit) ||
    !Number.isInteger(Number(limit)) ||
    +limit < 500 ||
    +limit > 100000
  )
    fail("invalid_format_or_limit");
  const cap = flags.get("--max-usdc");
  let capAtomic = 2000n;
  if (command === "buy" || cap !== undefined) {
    if (!cap || !/^0(?:\.\d{1,6})?$/.test(cap))
      fail("explicit_cap_required_at_most_0.002");
    capAtomic = BigInt((cap.split(".")[1] ?? "").padEnd(6, "0") || "0");
    if (capAtomic <= 0n || capAtomic > 2000n)
      fail("explicit_cap_required_at_most_0.002");
  }
  return { command, url, format, maxChars: Number(limit), capAtomic };
}

export function allowedRequirement(r, cap) {
  return (
    r?.scheme === "exact" &&
    r.network === NETWORK &&
    typeof r.payTo === "string" &&
    r.payTo.toLowerCase() === READER_RECIPIENT &&
    typeof r.asset === "string" &&
    r.asset.toLowerCase() === READER_ASSET &&
    typeof r.amount === "string" &&
    /^\d+$/.test(r.amount) &&
    BigInt(r.amount) > 0n &&
    BigInt(r.amount) <= cap &&
    (!r.extra?.assetTransferMethod ||
      r.extra.assetTransferMethod === "eip3009") &&
    (!r.extra?.name || r.extra.name === "USD Coin") &&
    (!r.extra?.version || r.extra.version === "2")
  );
}

async function authorize(required, key) {
  const account = privateKeyToAccount(key);
  const client = new x402Client()
    .register(NETWORK, new ExactEvmScheme(account))
    .setSpendControls({ maxAmountPerPayment: "$0.002" })
    .registerPolicy((_version, entries) =>
      entries.filter((r) => allowedRequirement(r, 2000n)),
    );
  return client.createPaymentPayload(required);
}

function receiptFrom(response) {
  const encoded = response.headers.get("PAYMENT-RESPONSE");
  if (!encoded || encoded.length > 16000) return null;
  try {
    const r = decodePaymentResponseHeader(encoded);
    if (typeof r.success !== "boolean" || r.network !== NETWORK) return null;
    if (r.success && !/^0x[0-9a-f]{64}$/i.test(r.transaction ?? ""))
      return null;
    return {
      success: r.success,
      network: r.network,
      transaction: r.transaction ?? null,
      ...(typeof r.payer === "string" && /^0x[0-9a-f]{40}$/i.test(r.payer)
        ? { payer: r.payer }
        : {}),
    };
  } catch {
    return null;
  }
}

async function resultJson(response) {
  if (!response.body) fail("missing_result_body");
  const reader = response.body.getReader(),
    chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 2 * 1024 * 1024) {
        await reader.cancel();
        fail("result_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Dependency injection is for offline tests; CLI flags cannot override the origin or policy. */
export async function runReader(
  args,
  {
    fetcher = globalThis.fetch,
    getKey = () => process.env.X402_PRIVATE_KEY,
    createPayload = authorize,
  } = {},
) {
  let authorizationAttempted = false,
    receipt = null,
    requestId = null;
  try {
    const options = parseReaderArgs(args);
    if (options.command === "help")
      return {
        ok: true,
        help: "Node >=20.19. quote <public-url> [--format text|markdown|both] [--max-chars 500..100000]; buy <public-url> --max-usdc 0.002 [same options]. Buy uses X402_PRIVATE_KEY locally. Each invocation may pay once. No automatic purchase retries. A cap is per invocation, not a monthly budget.",
      };
    const url = new URL("/extract", READER_ORIGIN);
    url.search = new URLSearchParams({
      url: options.url,
      format: options.format,
      maxChars: String(options.maxChars),
    }).toString();
    const response = await fetcher(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: { Accept: "application/json", "X402-Source": "reader_cli" },
    });
    requestId = response.headers.get("X-Request-ID");
    await response.body?.cancel();
    if (response.status !== 402) fail("expected_unpaid_402_quote");
    const header = response.headers.get("PAYMENT-REQUIRED");
    if (!header || header.length > 64000) fail("invalid_payment_quote");
    const required = decodePaymentRequiredHeader(header);
    if (required.x402Version !== 2 || !Array.isArray(required.accepts))
      fail("invalid_payment_quote");
    const resource = new URL(required.resource?.url ?? "");
    if (resource.origin !== READER_ORIGIN || resource.pathname !== "/extract")
      fail("unexpected_payment_resource");
    const selected = required.accepts.find((r) =>
      allowedRequirement(r, options.capAtomic),
    );
    if (!selected) fail("payment_terms_rejected");
    const quote = {
      scheme: selected.scheme,
      network: selected.network,
      asset: selected.asset,
      payTo: selected.payTo,
      amountAtomic: selected.amount,
      usdc: (Number(selected.amount) / 1e6).toFixed(6),
    };
    if (options.command === "quote")
      return { ok: true, paymentStatus: "not_signed", quote, requestId };
    const key = getKey();
    if (
      typeof key !== "string" ||
      !/^0x[0-9a-f]{64}$/i.test(key) ||
      /^0x0+$/.test(key)
    )
      fail("missing_or_invalid_local_key");
    authorizationAttempted = true;
    // Exactly one SDK authorization, then exactly one submission. No recovery or fresh nonce retry.
    const payload = await createPayload(
      { ...required, accepts: [selected], extensions: undefined },
      key,
    );
    const paid = await fetcher(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(60000),
      headers: {
        Accept: "application/json",
        "X402-Source": "reader_cli",
        "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(payload),
      },
    });
    requestId = paid.headers.get("X-Request-ID") ?? requestId;
    receipt = receiptFrom(paid);
    const paymentStatus = receipt?.success
      ? "settled"
      : receipt
        ? "reported_not_settled"
        : "unknown";
    if (!paid.ok) {
      await paid.body?.cancel();
      return {
        ok: false,
        error: "paid_request_failed",
        httpStatus: paid.status,
        paymentStatus,
        receipt,
        requestId,
        retryAutomatically: false,
      };
    }
    const result = await resultJson(paid);
    if (!receipt?.success)
      return {
        ok: false,
        error: "settlement_receipt_unconfirmed",
        paymentStatus,
        receipt,
        requestId,
        retryAutomatically: false,
      };
    const representation = options.format === "markdown" ? "markdown" : "text";
    if (
      result?.format !== options.format ||
      result.hashFormat !== representation ||
      typeof result[representation] !== "string" ||
      !result[representation].trim() ||
      result.contentHash !==
        "sha256:" +
          createHash("sha256").update(result[representation]).digest("hex")
    )
      fail("invalid_result");
    return { ok: true, paymentStatus, result, receipt, requestId };
  } catch (error) {
    // Never echo arbitrary SDK/network exceptions: they may contain sensitive signing context.
    const safe = new Set([
      "usage_error",
      "invalid_format_or_limit",
      "explicit_cap_required_at_most_0.002",
      "expected_unpaid_402_quote",
      "invalid_payment_quote",
      "unexpected_payment_resource",
      "payment_terms_rejected",
      "missing_or_invalid_local_key",
      "result_too_large",
      "missing_result_body",
      "invalid_result",
    ]);
    return {
      ok: false,
      error: safe.has(error?.message)
        ? error.message
        : authorizationAttempted
          ? "purchase_outcome_uncertain"
          : "quote_or_input_failed",
      paymentStatus: receipt?.success
        ? "settled"
        : authorizationAttempted
          ? "unknown"
          : "not_signed",
      receipt,
      requestId,
      retryAutomatically: false,
    };
  }
}
