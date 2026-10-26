// Solana reads (1.56.0). Bazaar search on 24 Oct 2026, summed 30-day payers over the top 20: "solana token" 36,
// "solana balance" 26, no listing of ours. Keyless public JSON-RPC: the Solana Foundation's mainnet endpoint answers
// every method; publicnode refuses the token methods (403), so it is only a fallback for balances. Node failures and
// rate limits are an uncharged 502.
import { entry, need, num, type Entry } from "../family";
import { HttpError } from "../lib/env";

const RPCS = ["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"];
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const LAMPORTS = 1e9;
/** Symbols for well-known mints (checked against their mint accounts, 24 Oct 2026); others show the mint only. */
export const KNOWN_MINTS: Record<string, string> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC", Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT",
  So11111111111111111111111111111111111111112: "wSOL", JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: "JUP",
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: "BONK", EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm: "WIF",
  HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3: "PYTH", mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: "mSOL",
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: "JitoSOL", "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R": "RAY",
};

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** Decoded byte length of a base58 string, or -1 when it holds characters outside the alphabet. */
export function base58Length(s: string): number {
  let bytes: number[] = [];
  for (const ch of s) {
    let carry = B58.indexOf(ch);
    if (carry < 0) return -1;
    for (let i = 0; i < bytes.length; i++) { carry += bytes[i] * 58; bytes[i] = carry & 0xff; carry >>= 8; }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (const ch of s) { if (ch === "1") bytes.push(0); else break; }
  return bytes.length;
}
const pubkey = (v: string | undefined, name: string) => {
  const s = v?.trim() ?? "";
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s) || base58Length(s) !== 32) throw new HttpError(400, `${name} must be a Solana address (base58, 32 bytes)`);
  return s;
};

export async function solRpc<T>(method: string, params: unknown[], methods: "all" | "basic" = "all"): Promise<T> {
  const urls = methods === "basic" ? RPCS : RPCS.slice(0, 1);
  let last = "";
  for (const url of urls) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(7000) });
      if (!res.ok) { last = `HTTP ${res.status}`; continue; }
      // Lamport balances can exceed 2^53 (exchange wallets), so large integers are kept as strings before JSON.parse.
      const body = JSON.parse((await res.text()).replace(/("value":)(\d{16,})/g, '$1"$2"')) as { result?: T; error?: { code: number; message: string } };
      if (body.error) {
        if (/invalid param|WrongSize|not a valid|could not find/i.test(body.error.message)) throw new HttpError(400, body.error.message.slice(0, 160));
        last = body.error.message; continue;
      }
      return body.result as T;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      last = "timeout";
    }
  }
  throw new HttpError(502, `Solana's public nodes did not answer (${last.slice(0, 80)}); try again`);
}

type ParsedAccount = { pubkey: string; account: { data: { parsed: { info: { mint: string; tokenAmount: { amount: string; decimals: number; uiAmountString: string } } } }; owner: string } };

export const SOLANA: Entry[] = [
  entry("/solana/balance", "Solana balance: SOL balance of a wallet",
    "SOL balance of a Solana wallet, read live from mainnet in lamports and SOL, plus its SPL token accounts (mint, symbol for well-known tokens, decimals, amount) when the public node serves them; otherwise tokens is null with a note. Use to check a Solana wallet before a payment. An address that is not 32-byte base58 is 400, uncharged.",
    ["solana-balance", "solana", "spl-token", "wallet", "balance", "data"], { address: { type: "string", description: "Solana wallet address (base58)", required: true, example: "vines1vzrYbzLMRdu58ou5XTby4qAqVRLmqo36NKPTg" } },
    { address: "vines1vzrYbzLMRdu58ou5XTby4qAqVRLmqo36NKPTg", sol: "0.039869364", lamports: "39869364", tokenCount: 6, tokens: [{ mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6, amount: "12.5", raw: "12500000", program: "token" }], slot: 460750950 },
    async (_e, q) => {
      const address = pubkey(q("address"), "address");
      const [bal, classic, t22] = await Promise.all([
        solRpc<{ context: { slot: number }; value: number | string }>("getBalance", [address], "basic"),
        // Token accounts need the Foundation node, which refuses Cloudflare (26 Oct 2026); the SOL balance never waits on them.
        solRpc<{ value: ParsedAccount[] }>("getTokenAccountsByOwner", [address, { programId: TOKEN_PROGRAM }, { encoding: "jsonParsed" }]).catch(() => null),
        solRpc<{ value: ParsedAccount[] }>("getTokenAccountsByOwner", [address, { programId: TOKEN_2022 }, { encoding: "jsonParsed" }]).catch(() => ({ value: [] as ParsedAccount[] })),
      ]);
      const rows = classic === null ? null : [...classic.value.map((a) => ({ a, program: "token" })), ...t22.value.map((a) => ({ a, program: "token-2022" }))]
        .map(({ a, program }) => { const i = a.account.data.parsed.info; return { mint: i.mint, symbol: KNOWN_MINTS[i.mint] ?? null, decimals: i.tokenAmount.decimals, amount: i.tokenAmount.uiAmountString, raw: i.tokenAmount.amount, program }; })
        .filter((t) => t.raw !== "0")
        // Well-known tokens first (wallets collect spam airdrops with huge amounts), then by amount.
        .sort((x, y) => Number(!!y.symbol) - Number(!!x.symbol) || Number(y.amount) - Number(x.amount));
      const lamports = BigInt(bal.value);
      const frac = (lamports % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
      return { address, sol: `${lamports / 1_000_000_000n}${frac ? `.${frac}` : ""}`, lamports: lamports.toString(), tokenCount: rows?.length ?? null, tokens: rows?.slice(0, 50) ?? null, ...(rows === null ? { tokensNote: "token balances could not be read from the public Solana node this time; the SOL balance is exact" } : {}), slot: bal.context.slot };
    }),

  entry("/solana/token", "Solana token info: supply, decimals, mint and freeze authority",
    "Look up a Solana SPL token by its mint address, live from mainnet: decimals, total supply, whether a mint authority can still create more and whether a freeze authority can freeze holders (two common rug-pull risks), the token program, and, on request, the largest holder accounts with their share of supply. Use before buying or accepting an unknown Solana token. A mint that does not exist is 404, uncharged.",
    ["solana-token", "solana", "spl-token", "token-security", "crypto", "data"], {
      mint: { type: "string", description: "SPL token mint address (base58)", required: true, example: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
      holders: { type: "integer", description: "Largest holder accounts to list, 0-20 (default 0; best effort, the public node rate-limits this lookup)", example: 0 },
    },
    { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", program: "token", decimals: 6, supply: "7719383272.039", mintAuthority: "BJE5MMbqXjVwjAF7oxwPYXnTXDyspzZyt4vwenNw5ruG", freezeAuthority: "7dGbd2QZcCKcTndnHcTL8q7SMVXAkp688NTQYwrRCrar", mintable: true, freezable: true, topHolders: [], slot: 460750968 },
    async (_e, q) => {
      const mint = pubkey(q("mint"), "mint");
      const holders = num(q, "holders", { min: 0, max: 20, fallback: 0, integer: true });
      const info = await solRpc<{ context: { slot: number }; value: null | { owner: string; data: { parsed?: { type: string; info: { decimals: number; supply: string; mintAuthority: string | null; freezeAuthority: string | null } } } } }>("getAccountInfo", [mint, { encoding: "jsonParsed" }], "basic");
      if (!info.value) throw new HttpError(404, "no account at this address on Solana mainnet");
      const parsed = info.value.data.parsed;
      if (!parsed || parsed.type !== "mint") throw new HttpError(422, "this address is not an SPL token mint");
      const { decimals, supply, mintAuthority, freezeAuthority } = parsed.info;
      const ui = (raw: string) => { const s = raw.padStart(decimals + 1, "0"); const whole = s.slice(0, s.length - decimals), frac = s.slice(s.length - decimals).replace(/0+$/, ""); return frac ? `${whole}.${frac}` : whole; };
      let top: { account: string; amount: string; sharePct: number | null }[] | null = [];
      if (holders > 0) {
        const largest = await solRpc<{ value: { address: string; amount: string }[] }>("getTokenLargestAccounts", [mint]).catch(() => null);
        top = largest === null ? null : largest.value.slice(0, holders).map((h) => ({ account: h.address, amount: ui(h.amount), sharePct: supply !== "0" ? Math.round(Number((BigInt(h.amount) * 1_000_000n) / BigInt(supply)) / 100) / 100 : null }));
      }
      return { mint, symbol: KNOWN_MINTS[mint] ?? null, program: info.value.owner === TOKEN_2022 ? "token-2022" : "token", decimals, supply: ui(supply), mintAuthority, freezeAuthority, mintable: mintAuthority !== null, freezable: freezeAuthority !== null, topHolders: top, slot: info.context.slot };
    }),

  entry("/solana/tx", "Solana transaction lookup: status, fee and signers",
    "Look up a Solana transaction by signature, live from mainnet: success or the error, slot and block time, fee in SOL, compute units used, signers, the programs it called and SOL balance changes per account. Use to confirm a Solana payment landed or see what a transaction did. A signature that is not base58 is 400; an unknown or too old signature is 404, both uncharged.",
    ["solana-transaction", "solana", "transaction", "confirmation", "data"], { signature: { type: "string", description: "Transaction signature (base58, 64 bytes)", required: true, example: "3vsCBRhEzKZ5gkQ59x9qkzVFddwVNFtz5HUW7G1JvMqEaYABtJH1Parn84FAUF2dct2viSXHVVDDRKSbytSSdMU" } },
    { signature: "5UfDuX…", status: "success", error: null, slot: 460000000, blockTime: "2026-10-24T08:00:00.000Z", feeSol: 0.000005, computeUnits: 450, signers: ["…"], programs: ["11111111111111111111111111111111"], solChanges: [{ account: "…", changeSol: -0.010005 }] },
    async (_e, q) => {
      const sig = need(q, "signature", 100).trim();
      if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(sig) || base58Length(sig) !== 64) throw new HttpError(400, "signature must be a base58 Solana transaction signature (64 bytes)");
      type Tx = { slot: number; blockTime: number | null; meta: { err: unknown; fee: number; computeUnitsConsumed?: number; preBalances: number[]; postBalances: number[] } | null; transaction: { message: { accountKeys: { pubkey: string; signer: boolean }[]; instructions: { programId: string }[] } } };
      const tx = await solRpc<Tx | null>("getTransaction", [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }], "basic");
      if (!tx) throw new HttpError(404, "no such transaction on Solana mainnet (or it is older than the node keeps)");
      const keys = tx.transaction.message.accountKeys;
      const changes = keys.map((k, i) => ({ account: k.pubkey, changeSol: tx.meta ? (tx.meta.postBalances[i] - tx.meta.preBalances[i]) / LAMPORTS : 0 })).filter((c) => c.changeSol !== 0).slice(0, 20);
      return {
        signature: sig, status: tx.meta?.err ? "failed" : "success", error: tx.meta?.err ?? null, slot: tx.slot,
        blockTime: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null, feeSol: tx.meta ? tx.meta.fee / LAMPORTS : null,
        computeUnits: tx.meta?.computeUnitsConsumed ?? null, signers: keys.filter((k) => k.signer).map((k) => k.pubkey),
        programs: [...new Set(tx.transaction.message.instructions.map((i) => i.programId))], solChanges: changes,
      };
    }),
];
