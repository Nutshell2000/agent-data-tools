// All table-generated endpoint families, in catalog order.
import { PRICE, type Entry } from "./family";
import { AI_TEXT, BASICS } from "./routes/ai-text";
import { CHAIN_READS } from "./routes/chain-reads";
import { CHECKS } from "./routes/checks";
import { COMPANY } from "./routes/company";
import { COUNTERPARTY } from "./routes/counterparty";
import { EXTRACT_RENDERED } from "./routes/extract-rendered";
import { FEEDS } from "./routes/feeds";
import { FUN } from "./routes/fun";
import { CALC } from "./routes/calc";
import { ECON } from "./routes/econ";
import { GOV_DATA } from "./routes/gov-data";
import { HYPERLIQUID } from "./routes/hyperliquid";
import { LOOKUPS } from "./routes/lookups";
import { GEO_IP } from "./routes/geo-ip";
import { EVM_TOOLS } from "./routes/evm-tools";
import { FEAR_GREED } from "./routes/fear-greed";
import { SOLANA } from "./routes/solana";
import { BIC } from "./routes/bic";
import { WEB_CHECKS } from "./routes/web-checks";
import { MATH_DATE } from "./routes/math-date";
import { GENERATORS } from "./routes/generators";
import { PACKS } from "./routes/packs";
import { TOOLBOXES } from "./routes/toolboxes";
import { PACKS_MORE } from "./routes/packs-more";
import { TOOLBOXES2 } from "./routes/toolboxes2";
import { GEO_MORE } from "./routes/geo-more";
import { AGENT_INFRA } from "./routes/agent-infra";
import { MEDIA_TEXT } from "./routes/media-text";
import { PACKS_INTEL } from "./routes/packs-intel";
import { PACKS_RESEARCH } from "./routes/packs-research";
import { SAFETY } from "./routes/safety";
import { RETRIEVAL } from "./routes/retrieval";
import { WHALE } from "./routes/whale";
import { MEMORY } from "./routes/memory";
import { RECOMMEND } from "./routes/recommend";
import { GOV_MORE } from "./routes/gov-more";
import { CHAIN_MORE } from "./routes/chain-more";
import { PAGES } from "./routes/pages";
import { PDF } from "./routes/pdf";
import { PRICES } from "./routes/prices";
import { PUBLIC_DATA } from "./routes/public-data";
import { SANCTIONS } from "./routes/sanctions";
import { SEARCH } from "./routes/search";
import { UTILS } from "./routes/utils";
import { X402_CHECK } from "./routes/x402-check";

const CATALOG: Entry[] = [...CHAIN_READS, ...SOLANA, ...PRICES, ...SEARCH, ...PDF, ...EXTRACT_RENDERED, ...FEEDS, ...COMPANY, ...SANCTIONS, ...CHECKS, ...COUNTERPARTY, ...X402_CHECK, ...UTILS, ...CALC, ...LOOKUPS, ...GEO_IP, ...EVM_TOOLS, ...BIC, ...WEB_CHECKS, ...MATH_DATE, ...GENERATORS, ...PACKS, ...TOOLBOXES, ...PACKS_MORE, ...TOOLBOXES2, ...GEO_MORE, ...AGENT_INFRA, ...MEDIA_TEXT, ...PACKS_INTEL, ...PACKS_RESEARCH, ...SAFETY, ...RETRIEVAL, ...PAGES, ...WHALE, ...MEMORY, ...RECOMMEND, ...GOV_MORE, ...CHAIN_MORE, ...PUBLIC_DATA, ...GOV_DATA, ...ECON, ...HYPERLIQUID, ...FEAR_GREED, ...FUN, ...BASICS, ...AI_TEXT];

/**
 * Price test, part 2 (26 Oct to 2 Nov 2026, the owner's go-ahead): pure-computation tools (no outside data source, no
 * AI, nothing to pay upstream) go from $0.01 to $0.002. The shopper bots that repeat-buy across hundreds of sellers
 * (wallets 0x2465, 0x38b6, 0xb83b, 0xe827: about 3,000 payments each a week, median $0.0013-0.002) bought identical
 * hash, JSON, encoding, UUID and IP tools elsewhere at $0.001-0.002 hundreds of times and ours once. $0.002, not
 * $0.001: CDP charges $0.001 a settlement above 1,000 a month, so $0.001 would net nothing. Revert to PRICE if they
 * do not come (business/agentic/base-bots/payments-to-us.mjs).
 * Ended 27 Oct 2026 with the chain-read test (READ_TEST_PRICE in routes/chain-reads.ts): back at PRICE.
 */
export const LOCAL_TEST_PRICE = PRICE;
const LOCAL_FAMILIES: Entry[][] = [UTILS, CALC, EVM_TOOLS, BIC, MATH_DATE, GENERATORS, TOOLBOXES, TOOLBOXES2, FUN];
export const LOCAL_PATHS: ReadonlySet<string> = new Set([
  ...LOCAL_FAMILIES.flatMap((family) => family.map((e) => e.endpoint.path)),
  "/yaml/to-json", "/json/to-yaml", "/phone/validate", "/geo/distance", "/useragent/parse", "/text/language", "/keccak",
  // Health-probe tools: x402 settlement checkers repeat-buy ping endpoints (api-xpay /x402/ping: 254 payers, 7,283 calls).
  "/ping", "/echo", "/network",
  // Computed or read from data bundled with the code (World Bank snapshot, holiday rules, local checks): no upstream cost.
  "/sun", "/moon", "/holidays", "/econ/gdp", "/econ/inflation", "/econ/population", "/econ/unemployment",
  "/text/prompt-injection", "/text/pii", "/dockerfile/lint",
]);
export const FAMILIES: Entry[] = CATALOG.map((e) =>
  LOCAL_PATHS.has(e.endpoint.path) && e.endpoint.price === PRICE ? { ...e, endpoint: { ...e.endpoint, price: LOCAL_TEST_PRICE } } : e);
