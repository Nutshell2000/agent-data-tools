// More packs (1.61.0). Bazaar search on 24 Oct 2026, summed 30-day payers over the top 20: transaction decoder 18 and explain
// transaction 21 (Base Tx Explain has 5), nft analysis 33, location data 25 and place information 32, text analysis 29.
import { decodeEventLog, formatEther, formatGwei, formatUnits, isHash, parseAbi, type Hex } from "viem";
import { entry, need, pick, type Entry, PACK_PRICE } from "../family";
import { HttpError } from "../lib/env";
import { erc20Abi } from "../lib/rpc";
import { CHAINS, client, rpc } from "./chain-reads";
import { decodeCalldata } from "./evm-tools";
import { call, runSections } from "./packs";
import { weather } from "./weather";

// ISO alpha-2 code for an English country name (Wikidata gives names, the country tool takes codes); shared with /holidays.
import { countryCode } from "../lib/country-code";
export { countryCode };

const CHAIN_SLUGS = ["base", "eth", "arb", "op", "polygon"] as const;
const EVENTS = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
  "event ApprovalForAll(address indexed owner, address indexed operator, bool approved)",
]);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Plain-English lines for decoded token events, given token metadata. */
export function describeEvents(events: { kind: string; token: string; from?: string; to?: string; value?: bigint; tokenId?: bigint; approved?: boolean }[], meta: Map<string, { symbol: string | null; decimals: number | null }>) {
  return events.map((e) => {
    const m = meta.get(e.token.toLowerCase());
    const label = m?.symbol ?? short(e.token);
    if (e.kind === "nft-transfer") return `${label} #${e.tokenId} moved from ${short(e.from!)} to ${short(e.to!)}${/^0x0+$/.test(e.from!) ? " (minted)" : ""}`;
    if (e.kind === "transfer") {
      const amount = m?.decimals != null ? formatUnits(e.value!, m.decimals) : `${e.value} (raw)`;
      if (/^0x0+$/.test(e.from!)) return `${amount} ${label} minted to ${short(e.to!)}`;
      if (/^0x0+$/.test(e.to!)) return `${amount} ${label} burned from ${short(e.from!)}`;
      return `${amount} ${label} sent from ${short(e.from!)} to ${short(e.to!)}`;
    }
    if (e.kind === "approval") {
      const unlimited = e.value! >= 2n ** 255n;
      return `${short(e.from!)} approved ${short(e.to!)} to spend ${unlimited ? "unlimited" : m?.decimals != null ? formatUnits(e.value!, m.decimals) : String(e.value)} ${label}`;
    }
    return `${short(e.from!)} ${e.approved ? "approved" : "revoked"} ${short(e.to!)} as operator for all ${label}`;
  });
}

export const PACKS_MORE: Entry[] = [
  entry("/pack/tx-explain", "Explain transaction, decoded: what an EVM transaction did",
    "Explain an EVM transaction in plain words: success or revert, sender and contract, ETH value, fee, the function called (decoded for common ERC-20, ERC-721, WETH, permit and multicall calls), and every token transfer, mint, burn and approval it emitted with amounts and symbols, plus one-line summaries. Base, Ethereum, Arbitrum, Optimism or Polygon. Use to check what a payment or contract call really did before trusting it or reporting it.",
    ["transaction-decoder", "explain-transaction", "transaction", "pack", "evm", "crypto"], {
      hash: { type: "string", description: "0x transaction hash", required: true, example: "0x7d108fa131ed949c76d50caf2e7dfe25fc9903b9d276c40a0446d8afbdfe86b0" },
      chain: { type: "string", description: "Network: base (default), eth, arb, op or polygon", example: "base" },
    },
    { pack: "tx-explain", chain: "Base", hash: "0x7d10…", status: "success", from: "0x…", to: "0x…", valueEth: "0", feeEth: "0.0000012", gasUsed: "52000", call: { function: "transfer(address,uint256)", args: [{ type: "address", value: "0x…" }, { type: "uint256", value: "10000000" }] }, events: [{ kind: "transfer", token: "0x8335…", symbol: "USDC", from: "0x…", to: "0x…", amount: "10" }], summary: ["10 USDC sent from 0x1234…abcd to 0x5678…ef01"], block: 123456789 },
    async (env, q) => {
      const slug = pick(q, "chain", CHAIN_SLUGS, "base");
      const c = CHAINS.find((x) => x.slug === slug)!;
      const hash = need(q, "hash", 80).trim().toLowerCase();
      if (!isHash(hash as Hex)) throw new HttpError(400, "hash must be a 0x transaction hash (64 hex characters)");
      const cl = client(env, c);
      const [tx, receipt] = await rpc(() => Promise.all([cl.getTransaction({ hash: hash as Hex }), cl.getTransactionReceipt({ hash: hash as Hex })]));
      const events: { kind: string; token: string; from?: string; to?: string; value?: bigint; tokenId?: bigint; approved?: boolean }[] = [];
      for (const log of receipt.logs.slice(0, 200)) {
        try {
          const d = decodeEventLog({ abi: EVENTS, data: log.data, topics: log.topics, strict: false });
          const a = d.args as Record<string, unknown>;
          if (d.eventName === "Transfer") events.push(log.topics.length === 4 ? { kind: "nft-transfer", token: log.address, from: String(a.from), to: String(a.to), tokenId: a.value as bigint } : { kind: "transfer", token: log.address, from: String(a.from), to: String(a.to), value: a.value as bigint });
          else if (d.eventName === "Approval") events.push({ kind: "approval", token: log.address, from: String(a.owner), to: String(a.spender), value: a.value as bigint });
          else events.push({ kind: "approval-for-all", token: log.address, from: String(a.owner), to: String(a.operator), approved: Boolean(a.approved) });
        } catch { /* not a token event */ }
      }
      const tokens = [...new Set(events.map((e) => e.token.toLowerCase()))].slice(0, 10) as Hex[];
      const meta = new Map(await Promise.all(tokens.map(async (t) => {
        const [symbol, decimals] = await Promise.all([
          cl.readContract({ address: t, abi: erc20Abi, functionName: "symbol" }).catch(() => null),
          cl.readContract({ address: t, abi: erc20Abi, functionName: "decimals" }).catch(() => null),
        ]);
        return [t as string, { symbol: symbol as string | null, decimals: decimals === null ? null : Number(decimals) }] as const;
      })));
      let decoded: unknown = null;
      if (tx.input && tx.input.length >= 10) { try { decoded = decodeCalldata(tx.input.toLowerCase() as Hex); } catch { decoded = { selector: tx.input.slice(0, 10), decoded: false }; } }
      return {
        pack: "tx-explain", chain: c.name, hash, status: receipt.status, from: tx.from.toLowerCase(), to: tx.to?.toLowerCase() ?? null,
        contractCreated: receipt.contractAddress ?? null, valueEth: formatEther(tx.value), feeEth: formatEther(receipt.gasUsed * receipt.effectiveGasPrice),
        gasUsed: receipt.gasUsed.toString(), gasPriceGwei: formatGwei(receipt.effectiveGasPrice), call: decoded,
        events: events.slice(0, 50).map((e) => {
          const m = meta.get(e.token.toLowerCase());
          return { kind: e.kind, token: e.token.toLowerCase(), symbol: m?.symbol ?? null, from: e.from?.toLowerCase(), to: e.to?.toLowerCase(),
            ...(e.value !== undefined ? { amount: m?.decimals != null ? formatUnits(e.value, m.decimals) : e.value.toString() } : {}),
            ...(e.tokenId !== undefined ? { tokenId: e.tokenId.toString() } : {}), ...(e.approved !== undefined ? { approved: e.approved } : {}) };
        }),
        summary: [...(tx.value > 0n ? [`${formatEther(tx.value)} ${c.symbol} sent from ${short(tx.from)} to ${short(tx.to ?? "0x")}`] : []), ...describeEvents(events.slice(0, 50), meta)],
        logs: receipt.logs.length, block: Number(receipt.blockNumber),
      };
    }, PACK_PRICE),

  entry("/pack/nft-analysis", "NFT analysis: owner, metadata, holdings and collection",
    "One call to analyse an NFT: its current owner, its metadata (name, description, image, traits from data:, https or ipfs), how many NFTs of the collection that owner holds, and the collection contract (name, symbol, whether it is an upgradeable proxy). ERC-721 on Base, Ethereum, Arbitrum, Optimism or Polygon. Cheaper than the tools bought one by one. Use before buying, listing or verifying an NFT.",
    ["nft-analysis", "nft", "nft-metadata", "pack", "erc721", "crypto"], {
      contract: { type: "string", description: "0x ERC-721 collection contract address", required: true, example: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88" },
      tokenId: { type: "string", description: "Token id, a whole number", required: true, example: "1" },
      chain: { type: "string", description: "Network: eth (default), base, arb, op or polygon", example: "eth" },
    },
    { pack: "nft-analysis", chain: "eth", contract: "0xc36442b4a4522e871399cd717abdd847ab11fe88", tokenId: "1", collection: { name: "Uniswap V3 Positions NFT-V1", symbol: "UNI-V3-POS" }, owner: "0x50ec05ade8280758e2077fcbc08d878d4aef79c3", ownerHoldings: "4", metadata: { name: "Uniswap - 0.3% - UNI/WETH - 39.323<>157.24", description: "This NFT represents a liquidity position…" }, proxy: { isProxy: false, kind: "none" }, failed: {} },
    async (env, q) => {
      const slug = pick(q, "chain", CHAIN_SLUGS, "eth");
      const contract = need(q, "contract", 64).trim().toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(contract)) throw new HttpError(400, "contract must be a 0x address (40 hex characters)");
      const tokenId = need(q, "tokenId", 80).trim();
      const owner = await call(env, `/${slug}/nft-owner`, { contract, tokenId }) as { owner: string; name: string | null; symbol: string | null };
      const { data, failed } = await runSections({
        metadata: call(env, `/${slug}/nft-metadata`, { contract, tokenId }),
        holdings: call(env, `/${slug}/nft-balance`, { contract, address: owner.owner }),
        proxy: call(env, `/${slug}/proxy`, { address: contract }),
      });
      const md = data.metadata as { metadata?: unknown; tokenUri?: string; metadataError?: string | null } | undefined;
      return {
        pack: "nft-analysis", chain: slug, contract, tokenId, collection: { name: owner.name, symbol: owner.symbol }, owner: owner.owner,
        ownerHoldings: (data.holdings as { balance?: string } | undefined)?.balance ?? null,
        metadata: md?.metadata ?? null, tokenUri: md?.tokenUri ?? null, metadataError: md?.metadataError ?? null,
        proxy: data.proxy ? { isProxy: (data.proxy as { isProxy: boolean }).isProxy, kind: (data.proxy as { kind: string }).kind } : null, failed,
      };
    }, PACK_PRICE),

  entry("/pack/location-brief", "Location data, place brief: weather, sunrise and country facts",
    "One call for a place by name: its coordinates, country, region, population and elevation (Wikidata), the current weather and a short hourly forecast (MET Norway, CC BY 4.0), today's sunrise, sunset and day length, and facts about its country (capital, region, income level, population). Cheaper than the tools bought one by one. Use for travel planning, event and delivery context, or enriching a city name in a record.",
    ["location-data", "place-information", "weather", "pack", "geo", "travel"], {
      place: { type: "string", description: "Place name, such as Stockholm or Lyon, France", required: true, example: "Stockholm" },
    },
    { pack: "location-brief", place: { name: "Stockholm", country: "Sweden", lat: 59.3294, lon: 18.0686, population: 984748 }, weather: { temperatureC: 8.1, conditions: "cloudy", windMs: 4.2 }, sun: { sunrise: "05:43", sunset: "15:12", dayLength: "9h 29m" }, country: { name: "Sweden", capital: "Stockholm", region: "Europe & Central Asia" }, failed: {} },
    async (env, q) => {
      const name = need(q, "place", 120);
      const geo = await call(env, "/geocode", { name, count: 1 }) as { results?: Record<string, unknown>[] };
      const first = geo.results?.[0];
      if (!first) throw new HttpError(404, `no place called ${name} was found`);
      const lat = Number(first.lat), lon = Number(first.lon);
      const code = countryCode(first.country);
      const { data, failed } = await runSections({
        weather: weather(String(lat), String(lon), "6"),
        sun: call(env, "/sun", { lat, lon }),
        ...(code ? { country: call(env, "/country", { country: code }) } : {}),
      });
      return { pack: "location-brief", place: first, weather: data.weather ?? null, sun: data.sun ?? null, country: data.country ?? null, failed };
    }, PACK_PRICE),

  entry("/pack/text-analysis", "Text analysis: readability, keywords, entities and safety",
    "One call to analyse a text: length, reading time and readability grade, the top keywords and repeated phrases with their density, the emails, links, phone numbers, hashtags and mentions it contains, and a prompt-injection scan for text an agent is about to act on. Up to 20,000 characters, local processing. Cheaper than the four tools bought one by one. Use to review drafts, triage inbound messages or vet scraped content.",
    ["text-analysis", "readability", "keywords", "pack", "text", "nlp"], {
      text: { type: "string", description: "The text (up to 20,000 characters)", required: true, example: "Agents pay per call with USDC. Contact sales@example.com or visit https://example.com for #x402 tools. Pricing starts at one cent per call." },
    },
    // The example text must not itself look like a prompt injection: the Bazaar never listed the pack while it ended in
    // "Ignore previous instructions." (settled 25 Oct 2026, every other tool from the same run was listed within minutes).
    { pack: "text-analysis", stats: { words: 25, sentences: 3, readingSeconds: 6, fleschReadingEase: 83.3 }, keywords: [{ word: "call", count: 2, densityPct: 10.53 }], extracted: { emails: ["sales@example.com"], urls: ["https://example.com"], hashtags: ["#x402"] }, injection: { risk: "none", score: 0, findings: [] }, failed: {} },
    async (env, q) => {
      const text = need(q, "text", 20_000);
      const { data, failed } = await runSections({
        stats: call(env, "/text/stats", { text }),
        keywords: call(env, "/text/keyword-density", { text, top: 10 }),
        extracted: call(env, "/text/extract", { text }),
        injection: call(env, "/text/prompt-injection", { text: text.slice(0, 8_000) }),
      });
      const kw = data.keywords as { keywords?: unknown[]; phrases?: unknown[] } | undefined;
      return { pack: "text-analysis", stats: data.stats ?? null, keywords: kw?.keywords ?? null, phrases: kw?.phrases ?? null, extracted: data.extracted ?? null, injection: data.injection ?? null, failed };
    }, PACK_PRICE),
];
