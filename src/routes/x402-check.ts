// Inspect any x402 endpoint without paying: decode its 402 payment requirements and check
// what directories and buying agents look for. Buyers vet a seller before signing; sellers
// debug why a listing is not discovered. Fetches go through the public-fetch guard.
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { getAddress } from "viem";
import { entry, type Entry } from "../family";
import { HttpError, isAddress } from "../lib/env";
import { CHAINS, client, rpc } from "./chain-reads";
import { domainReport } from "./domain-report";
import { screen, sdnIndex } from "./sanctions";
import { capBytes, fetchPublic, parseTarget } from "../lib/fetch";
import { USDC_BY_NETWORK } from "../lib/networks";

/** Native USDC contracts (6 decimals), lower-cased, by CAIP-2 network. */
const USDC: Record<string, string> = {
  "eip155:8453": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  "eip155:84532": "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  "eip155:1": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  "eip155:42161": "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
  "eip155:10": "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
  "eip155:137": "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
  // Every network this service itself accepts (Monad, World Chain…), so our own quotes read as native USDC.
  ...Object.fromEntries(Object.entries(USDC_BY_NETWORK).map(([network, asset]) => [network, asset.toLowerCase()])),
};
/** v1 used network names instead of CAIP-2 ids. */
const V1_NETWORKS: Record<string, string> = { base: "eip155:8453", "base-sepolia": "eip155:84532", ethereum: "eip155:1", arbitrum: "eip155:42161", optimism: "eip155:10", polygon: "eip155:137" };
/** This service's public host; requests to it go through the SELF binding instead of the network. */
const SELF_HOST = "agent-data-tools.revmesh2074.workers.dev";
/** Coinbase's facilitator rejects payments below 0.001 USDC. */
const FACILITATOR_MIN_ATOMIC = 1000n;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/** Decodes a 402 answer (v2 header, or v1 JSON body) and scores its listing quality. */
export function analyze(url: string, status: number, header: string | null, body: string) {
  if (status !== 402) return { url, status, paywalled: false, x402Version: null, accepts: [], resource: null, checks: [], score: null };
  let required: Obj | null = null;
  if (header) {
    try {
      required = decodePaymentRequiredHeader(header) as unknown as Obj;
    } catch {
      throw new HttpError(422, "the PAYMENT-REQUIRED header is not valid base64 JSON");
    }
  } else {
    try {
      const parsed = obj(JSON.parse(body));
      if (Array.isArray(parsed.accepts)) required = parsed;
    } catch { /* not JSON */ }
  }
  if (!required) return { url, status, paywalled: true, x402Version: null, accepts: [], resource: null, checks: [{ check: "x402 payment requirements present", pass: false }], score: 0 };

  const version = Number(required.x402Version) || null;
  const resource = obj(required.resource);
  const accepts = (required.accepts as unknown[]).map((raw) => {
    const a = obj(raw);
    const network = str(a.network) ?? "";
    const caip = V1_NETWORKS[network] ?? network;
    const atomic = str(a.amount) ?? str(a.maxAmountRequired);
    const asset = (str(a.asset) ?? "").toLowerCase();
    const isUsdc = Boolean(asset) && USDC[caip] === asset;
    return {
      scheme: str(a.scheme), network: caip || null, asset: str(a.asset), payTo: str(a.payTo), amountAtomic: atomic,
      priceUsd: isUsdc && atomic && /^\d+$/.test(atomic) ? Number(atomic) / 1e6 : null, assetIsNativeUsdc: isUsdc,
      maxTimeoutSeconds: typeof a.maxTimeoutSeconds === "number" ? a.maxTimeoutSeconds : null,
      // v1 kept the description and resource on each requirement.
      description: str(a.description), resource: str(a.resource),
    };
  });
  const description = str(resource.description) ?? accepts[0]?.description ?? null;
  const resourceUrl = str(resource.url) ?? accepts[0]?.resource ?? null;
  const bazaar = obj(obj(required.extensions).bazaar);
  const bazaarV1 = obj(obj((required.accepts as unknown[])[0]).outputSchema);
  const outputSchema = obj(obj(obj(obj(bazaar.schema).properties).output).properties).example;
  const checks = [
    { check: "x402 payment requirements present", pass: true },
    { check: "resource URL is absolute https", pass: Boolean(resourceUrl && resourceUrl.startsWith("https://")) },
    { check: "amount is an integer in atomic units", pass: accepts.length > 0 && accepts.every((a) => a.amountAtomic !== null && /^\d+$/.test(a.amountAtomic)) },
    { check: "USDC amount meets the Coinbase facilitator minimum (0.001)", pass: accepts.some((a) => a.assetIsNativeUsdc && /^\d+$/.test(a.amountAtomic ?? "") && BigInt(a.amountAtomic!) >= FACILITATOR_MIN_ATOMIC) },
    { check: "description present", pass: Boolean(description && description.length >= 20) },
    { check: "description says when to use it", pass: Boolean(description && /\bUse (when|to|for|before)\b/i.test(description)) },
    { check: "Bazaar discovery metadata present", pass: Object.keys(bazaar).length > 0 || Object.keys(bazaarV1).length > 0 },
    { check: "output example published", pass: Boolean(obj(obj(bazaar.info).output).example ?? bazaarV1.output) },
    { check: "output schema describes fields", pass: Boolean(obj(outputSchema).properties) },
  ];
  return {
    url, status, paywalled: true, x402Version: version,
    resource: { url: resourceUrl, description, mimeType: str(resource.mimeType) },
    accepts: accepts.map(({ description: _d, resource: _r, ...a }) => a),
    checks, score: Math.round((checks.filter((c) => c.pass).length / checks.length) * 100) / 100,
  };
}

export const X402_CHECK: Entry[] = [
  entry("/x402/check", "x402 seller check: decode an endpoint's payment terms and listing quality without paying",
    "Check an x402 seller before you pay it: decode any public endpoint's 402 payment requirements without paying (v1 body or v2 header) into USD price for native USDC, network, asset, recipient, scheme and timeout, plus a listing-quality score for https resource URL, atomic amount, facilitator minimum, description, Bazaar metadata and output schema. Never signs. Use before buying from an unfamiliar seller or to audit your own x402 listing.",
    ["x402", "payments", "developer", "validation", "agents"], {
      url: { type: "string", description: "Absolute public https URL of the paid endpoint, with any query it needs", required: true, example: "https://agent-data-tools.revmesh2074.workers.dev/btc-fees" },
    },
    {
      url: "https://agent-data-tools.revmesh2074.workers.dev/btc-fees", status: 402, paywalled: true, x402Version: 2,
      resource: { url: "https://agent-data-tools.revmesh2074.workers.dev/btc-fees", description: "Current Bitcoin network fee rates… Use before sending a Bitcoin transaction…", mimeType: "application/json" },
      accepts: [{ scheme: "exact", network: "eip155:8453", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", payTo: "0x…", amountAtomic: "2000", priceUsd: 0.002, assetIsNativeUsdc: true, maxTimeoutSeconds: 300 }],
      checks: [{ check: "x402 payment requirements present", pass: true }], score: 1,
    },
    async (env, q) => {
      const target = parseTarget(q("url"));
      const res = target.hostname === SELF_HOST && env.SELF
        ? await env.SELF.fetch(target.href, { headers: { accept: "application/json" } })
        : await fetchPublic(target, "application/json", [402]);
      const body = res.body ? await new Response(capBytes(res.body, 262_144, () => {})).text() : "";
      return analyze(target.href, res.status, res.headers.get("payment-required"), body);
    }, "$0.01"),
  // The audit paying agents buy before trusting a new seller (21 Oct: our buyer pays for x402 audits elsewhere):
  // the decoded terms plus who gets the money (OFAC, account type on the payment chain) and how old the domain is.
  entry("/check/x402-seller", "x402 audit of a seller: vet a paid endpoint's terms, payTo and domain before buying",
    "Audit an x402 seller before an agent buys from it: decodes the endpoint's 402 terms without paying, OFAC-screens each payTo address, reads its account type and nonce on the payment network, checks the seller domain's age and trust flags, and flags non-USDC assets and high prices. One block, review or pass verdict with reasons. Never signs. Screening aid, not legal advice. Use before the first payment to an unfamiliar x402 seller.",
    ["x402", "payee-screening", "sanctions", "payments", "agents", "compliance"], {
      url: { type: "string", description: "Absolute public https URL of the paid endpoint, with any query it needs", required: true, example: "https://agent-data-tools.revmesh2074.workers.dev/btc-fees" },
    },
    {
      url: "https://agent-data-tools.revmesh2074.workers.dev/btc-fees", verdict: "pass", reasons: [],
      terms: { paywalled: true, x402Version: 2, score: 1, accepts: [{ network: "eip155:8453", payTo: "0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5", priceUsd: 0.002, assetIsNativeUsdc: true }] },
      payees: [{ payTo: "0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5", network: "eip155:8453", sanctioned: false, sanctionMatches: [], accountType: "eoa-delegated", accountNonce: 1 }],
      domain: { name: "agent-data-tools.revmesh2074.workers.dev", trust: "medium", ageDays: 2812, registeredAt: "2019-02-08T20:36:47.904Z", flags: [{ level: "medium", code: "few_nameservers", message: "Fewer than two nameservers." }] },
      sanctionsListDate: "2026-10-17T20:15:00.000Z",
      limitations: [],
      note: "Screening aid only: confirm any sanctions match against the official OFAC record; a pass is not a guarantee the seller delivers.",
    },
    async (env, q) => {
      const target = parseTarget(q("url"));
      const res = target.hostname === SELF_HOST && env.SELF
        ? await env.SELF.fetch(target.href, { headers: { accept: "application/json" } })
        : await fetchPublic(target, "application/json", [402]);
      const body = res.body ? await new Response(capBytes(res.body, 262_144, () => {})).text() : "";
      const terms = analyze(target.href, res.status, res.headers.get("payment-required"), body);
      const limitations: string[] = [];
      // One account read per distinct payTo (at most 4), on its first network we can read; every payTo is screened.
      const byPayee = new Map<string, (typeof terms.accepts)[number]>();
      for (const a of terms.accepts) {
        const key = a.payTo?.toLowerCase();
        if (!key) continue;
        const known = byPayee.get(key);
        if (!known || (!CHAIN_BY_NETWORK[known.network ?? ""] && CHAIN_BY_NETWORK[a.network ?? ""])) byPayee.set(key, a);
      }
      const targets = [...byPayee.values()].slice(0, 4);
      const [index, domain, payees] = await Promise.all([
        sdnIndex(),
        domainReport(env, target.hostname.replace(/^www\./, "")).then(
          (r) => ({ name: r.domain, trust: r.trust, ageDays: r.facts.ageDays, registeredAt: r.facts.registeredAt, flags: r.flags }),
          () => { limitations.push("domain registration data was unavailable, so domain age is not assessed"); return null; },
        ),
        Promise.all(targets.map(async (a) => {
          const chain = CHAINS.find((c) => c.slug === CHAIN_BY_NETWORK[a.network ?? ""]);
          if (!chain || !isAddress(a.payTo!)) {
            limitations.push(`payTo ${a.payTo} on ${a.network}: account type not read (network not supported here)`);
            return { payTo: a.payTo!, network: a.network, accountType: null, accountNonce: null };
          }
          const cl = client(env, chain);
          const owner = getAddress(a.payTo!);
          const [code, nonce] = await Promise.all([rpc(() => cl.getCode({ address: owner })), rpc(() => cl.getTransactionCount({ address: owner }))]);
          return { payTo: a.payTo!, network: a.network, accountType: !code || code === "0x" ? "eoa" : code.startsWith("0xef0100") ? "eoa-delegated" : "contract", accountNonce: nonce };
        })),
      ]);
      const screened = payees.map((p) => { const m = screen(index, p.payTo, undefined); return { ...p, sanctioned: m.length > 0, sanctionMatches: m }; });
      return {
        url: target.href,
        ...sellerVerdict(terms, screened, domain?.flags ?? []),
        terms: { paywalled: terms.paywalled, x402Version: terms.x402Version, score: terms.score, accepts: terms.accepts.map((a) => ({ network: a.network, payTo: a.payTo, priceUsd: a.priceUsd, assetIsNativeUsdc: a.assetIsNativeUsdc })) },
        payees: screened.map(({ payTo, network, sanctioned, sanctionMatches, accountType, accountNonce }) => ({ payTo, network, sanctioned, sanctionMatches, accountType, accountNonce })),
        domain,
        sanctionsListDate: index.listDate,
        limitations,
        note: "Screening aid only: confirm any sanctions match against the official OFAC record; a pass is not a guarantee the seller delivers.",
      };
    }, "$0.01"),
];

/** CAIP-2 network to the chain-reads slug. */
const CHAIN_BY_NETWORK: Record<string, string> = { "eip155:8453": "base", "eip155:1": "eth", "eip155:42161": "arb", "eip155:10": "op", "eip155:137": "polygon" };
/** Above this a single call is unusual for an agent tool, so it is worth a second look (not a block). */
const HIGH_PRICE_USD = 1;

/** block on a sanctioned payTo; review on missing terms, a non-USDC asset, a high price or a high domain flag; else pass. */
export function sellerVerdict(
  terms: { paywalled: boolean; accepts: { priceUsd: number | null; assetIsNativeUsdc: boolean }[] },
  payees: { payTo: string; sanctioned: boolean; sanctionMatches: Record<string, unknown>[] }[],
  domainFlags: { level: string; message: string }[],
) {
  const reasons: string[] = [];
  for (const p of payees.filter((p) => p.sanctioned)) reasons.push(`payTo ${p.payTo} is on the OFAC SDN list (${[...new Set(p.sanctionMatches.map((m) => m.name))].join(", ")})`);
  const blocked = reasons.length > 0;
  if (!terms.paywalled || !terms.accepts.length) reasons.push("the endpoint did not answer 402 with x402 payment terms");
  if (terms.accepts.length && !terms.accepts.some((a) => a.assetIsNativeUsdc)) reasons.push("no payment option uses native USDC; check the asset before signing");
  const price = Math.min(...terms.accepts.map((a) => a.priceUsd ?? Infinity));
  if (Number.isFinite(price) && price > HIGH_PRICE_USD) reasons.push(`the cheapest option costs $${price} per call`);
  const domainHigh = domainFlags.filter((f) => f.level === "high");
  if (domainHigh.length) reasons.push(`seller domain: ${domainHigh.map((f) => f.message).join(" ")}`);
  return { verdict: blocked ? "block" : reasons.length ? "review" : "pass", reasons };
}
