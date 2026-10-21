// Inspect any x402 endpoint without paying: decode its 402 payment requirements and check
// what directories and buying agents look for. Buyers vet a seller before signing; sellers
// debug why a listing is not discovered. Fetches go through the public-fetch guard.
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { entry, type Entry } from "../family";
import { HttpError } from "../lib/env";
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
    }, "$0.003"),
];
