import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { BUILDER_CODE, declareBuilderCodeExtension } from "@x402/extensions/builder-code";
import type { Endpoint } from "../endpoints";

/**
 * Our Base Builder Code (ERC-8021, registered on base.dev). Every x402 v2 and MPP evm payment declares it as the app
 * code; a facilitator that supports the builder-code extension appends it to the settlement transaction, which
 * attributes our onchain volume to us on Base (a prerequisite of the Base Builder Grants). It changes no price or term.
 */
export const BUILDER_APP_CODE = "bc_09e30bdm";

export function builderCodeExtension() {
  return { [BUILDER_CODE]: declareBuilderCodeExtension(BUILDER_APP_CODE) };
}
import { exampleParams } from "../endpoints";
import { schemaFromExample } from "./output-schema";

/**
 * The Coinbase Bazaar discovery metadata for one tool: what the facilitator indexes after the first settled
 * payment. Shared by the x402 paywall (every 402 carries it) and the MPP evm settlement (lib/mpp-evm.ts), which
 * sends it with the payment payload so an MPP settlement can index the tool too.
 */
/** A pattern for inputs that only take a 0x address or a 32-byte hash, so agents can validate before paying. */
function formatOf(p: Endpoint["params"][string]): { pattern?: string } {
  if (typeof p.example !== "string" || /\bens\b|name/i.test(p.description)) return {};
  if (/^0x[0-9a-fA-F]{40}$/.test(p.example)) return { pattern: "^0x[0-9a-fA-F]{40}$" };
  if (/^0x[0-9a-fA-F]{64}$/.test(p.example)) return { pattern: "^0x[0-9a-fA-F]{64}$" };
  return {};
}

export function bazaarExtensionFor(e: Endpoint) {
  return declareDiscoveryExtension({
    input: Object.fromEntries(exampleParams(e).map(([k, p]) => [k, p.example])),
    inputSchema: {
      properties: Object.fromEntries(
        Object.entries(e.params).map(([k, p]) => [k, { type: p.type, description: p.description, ...(p.enum ? { enum: p.enum } : {}), ...formatOf(p), examples: [p.example] }]),
      ),
      required: Object.entries(e.params)
        .filter(([, p]) => p.required)
        .map(([k]) => k),
    },
    output: { example: e.outputExample, schema: e.outputSchema ?? schemaFromExample(e.outputExample) },
  });
}

/** Tags that most tools share; they say little to a search, so they go after the specific ones. */
const GENERIC_TAGS = new Set(["blockchain", "evm", "utility", "chain-data", "data"]);

/**
 * The tags a directory listing carries. The Bazaar keeps the first 5 and drops the rest without a warning, so the
 * specific ones (usdc, payments, sanctions…) go first and the shared ones last.
 */
export function listingTags(tags: readonly string[]): string[] {
  return [...tags.filter((t) => !GENERIC_TAGS.has(t)), ...tags.filter((t) => GENERIC_TAGS.has(t))].slice(0, 5);
}

const TRAILING_FILLER = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "its", "of", "on", "or", "the", "to", "under", "up", "via", "with", "without"]);

/**
 * The per-tool `serviceName` in the 402 resource. Zero.xyz names a crawled capability after it and its search
 * is lexical on that name, so one shared "Agent Data Tools" matched no buyer query. The x402 schema allows
 * 32 printable ASCII characters: the summary's lead phrase (before a colon), cut at a word within 32 characters,
 * without trailing filler words. Example: "Weather forecast: current weather…" -> "Weather forecast".
 */
export function listingName(summary: string): string {
  const head = summary.split(":")[0].replace(/[^\x20-\x7e]/g, "").replace(/\s+/g, " ").trim();
  if (head.length <= 32) return head || "Agent Data Tools";
  let words = head.slice(0, 33).split(" ");
  if (words.length > 1) words.pop(); // the last word may be cut
  // A connecting word near the end starts a phrase that no longer fits ("…filings for a US"): cut before it.
  const late = words.map((w) => TRAILING_FILLER.has(w.toLowerCase())).lastIndexOf(true);
  if (late >= 3 && late >= words.length - 3) words = words.slice(0, late);
  while (words.length > 1 && TRAILING_FILLER.has(words[words.length - 1].toLowerCase())) words.pop();
  let name = words.join(" ");
  if (name.lastIndexOf("(") > name.lastIndexOf(")")) name = name.slice(0, name.lastIndexOf("(")); // no open bracket
  return name.slice(0, 32).replace(/[\s,(]+$/, "");
}
