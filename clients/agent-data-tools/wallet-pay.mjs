// Wallet mode for `agent-data-tools mcp`: pay each tool call over x402 from the user's own wallet, with no account and no
// prepaid key. The private key is read from the environment only (AGENT_DATA_TOOLS_WALLET_KEY), is never written, logged
// or sent anywhere, and signs nothing but EIP-3009 USDC transfer authorizations for the exact amount the server quoted.
// The three signing packages are optional dependencies and are loaded only in this mode.

/** USDC on Base mainnet: the only asset and network this client pays with. */
export const BASE = "eip155:8453";
export const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
/** Base Sepolia and its faucet USDC, for testing against a staging server only (AGENT_DATA_TOOLS_TESTNET=1). */
export const TESTNET = { network: "eip155:84532", asset: "0x036cbd53842c5426634e7929541ec2318f3dcf7e" };
export const MAINNET = { network: BASE, asset: BASE_USDC };

const today = () => new Date().toISOString().slice(0, 10);

/** The payment request inside a tool result, as the x402 MCP transport carries it, or null. */
export function paymentRequiredOf(result) {
  if (!result || typeof result !== "object" || !result.isError) return null;
  const ok = (o) => (o && typeof o === "object" && Array.isArray(o.accepts) && o.accepts.length && o.x402Version !== undefined ? o : null);
  const direct = ok(result.structuredContent);
  if (direct) return direct;
  const first = Array.isArray(result.content) ? result.content[0] : undefined;
  if (first?.type !== "text" || typeof first.text !== "string") return null;
  try { return ok(JSON.parse(first.text)); } catch { return null; }
}

/** The one offer this client may pay: exact scheme, USDC on Base. */
export function baseOffer(paymentRequired, chain = MAINNET) {
  return paymentRequired.accepts.find((a) => a?.scheme === "exact" && a.network === chain.network && String(a.asset).toLowerCase() === chain.asset) ?? null;
}

/**
 * Spending rules, kept apart from signing so they can be tested without the signing packages.
 * @param {{ maxUsd: number, dailyUsd: number, payTo?: string, chain?: { network: string, asset: string } }} limits
 */
export function spendGuard({ maxUsd, dailyUsd, payTo, chain = MAINNET }) {
  let day = today(), spent = 0;
  return {
    /** Returns the offer to pay, or throws an Error whose message says why not. Reserves the amount. */
    take(paymentRequired) {
      const offer = baseOffer(paymentRequired, chain);
      if (!offer) throw new Error("the server offered no USDC-on-Base payment");
      if (!/^\d+$/.test(String(offer.amount))) throw new Error("the quoted amount is not a whole number of USDC units");
      const usd = Number(offer.amount) / 1e6;
      if (payTo && String(offer.payTo).toLowerCase() !== payTo.toLowerCase()) throw new Error("the quote pays an address other than the one this client was started for");
      if (usd > maxUsd) throw new Error(`the call costs $${usd} and the per-call limit is $${maxUsd} (AGENT_DATA_TOOLS_MAX_USD)`);
      if (day !== today()) { day = today(); spent = 0; }
      if (spent + usd > dailyUsd + 1e-9) throw new Error(`the daily limit of $${dailyUsd} is used up (AGENT_DATA_TOOLS_DAILY_USD)`);
      spent += usd;
      return { offer, usd };
    },
    /** Gives a reserved amount back when the payment was not used (the call failed, so nothing settled). */
    refund(usd) { spent = Math.max(0, spent - usd); },
    get spentToday() { return day === today() ? spent : 0; },
  };
}

const limit = (raw, fallback, name) => {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 100) throw new Error(`${name} must be a dollar amount above 0 and at most 100`);
  return n;
};

/** Limits from the environment: $0.10 a call and $1 a day unless the user sets others. */
export function limitsFromEnv(env = process.env) {
  return {
    maxUsd: limit(env.AGENT_DATA_TOOLS_MAX_USD, 0.1, "AGENT_DATA_TOOLS_MAX_USD"),
    dailyUsd: limit(env.AGENT_DATA_TOOLS_DAILY_USD, 1, "AGENT_DATA_TOOLS_DAILY_USD"),
    chain: env.AGENT_DATA_TOOLS_TESTNET === "1" ? TESTNET : MAINNET,
  };
}

/**
 * A payer for the proxy. Loads the signing packages, derives the address and returns `{ address, guard, sign }`.
 * @param {{ key: string, maxUsd: number, dailyUsd: number, chain?: { network: string, asset: string } }} options
 */
export async function walletPayer({ key, maxUsd, dailyUsd, chain = MAINNET }) {
  const hex = /^0x/i.test(key) ? key : `0x${key}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new Error("AGENT_DATA_TOOLS_WALLET_KEY must be a 32-byte hex private key");
  let core, evm, accounts;
  try {
    [core, evm, accounts] = await Promise.all([import("@x402/core/client"), import("@x402/evm/exact/client"), import("viem/accounts")]);
  } catch {
    throw new Error("wallet mode needs the packages @x402/core, @x402/evm and viem; install them next to agent-data-tools (npm i @x402/core @x402/evm viem)");
  }
  const account = accounts.privateKeyToAccount(hex);
  const client = new core.x402Client();
  evm.registerExactEvmScheme(client, { signer: account });
  const guard = spendGuard({ maxUsd, dailyUsd, chain });
  return {
    address: account.address,
    guard,
    /** Signs the Base USDC offer of one payment request; the caller has already passed the guard. */
    sign: (paymentRequired, offer) => client.createPaymentPayload({ ...paymentRequired, accepts: [offer] }),
  };
}
