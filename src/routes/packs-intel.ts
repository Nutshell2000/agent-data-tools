// Tech stack detection and four more packs (1.66.0). Bazaar search on 24 Oct 2026, summed 30-day payers over the top 20,
// nothing of ours: developer utilities 173 (EVM developer utilities listings among them), seo analysis 37 and seo toolkit 24,
// multichain gas 34 and gas tracker 29, company research 30, lead enrichment 21 and domain intelligence 17, tech stack 28.
// The detection rules below are our own list of public fingerprints (script hosts, headers, generator tags, cookies).
import { formatUnits, getAddress, hexToBigInt, isHex, keccak256, parseUnits, toBytes, toFunctionSelector, toHex, type Hex } from "viem";
import { entry, need, num, opt, type Entry, type Input, PACK_PRICE } from "../family";
import { HttpError, type Env } from "../lib/env";
import { fetchPublic, parseTarget } from "../lib/fetch";
import { bitcoinFees } from "./bitcoin";
import { domainInfo } from "./domain";
import { decodeCalldata } from "./evm-tools";
import { FEEDS } from "./feeds";
import { MEDIA_TEXT } from "./media-text";
import { call, runSections } from "./packs";

const pick2 = (o: unknown, keys: string[]) => (o && typeof o === "object" ? Object.fromEntries(keys.filter((k) => k in (o as object)).map((k) => [k, (o as Record<string, unknown>)[k]])) : null);
/** Tools outside packs.ts's list (feeds, media and this module), run in-process the same way. */
function local(env: Env, path: string, inputs: Record<string, string>) {
  const e = [...FEEDS, ...MEDIA_TEXT, ...TECH].find((x) => x.endpoint.path === path);
  if (!e) throw new Error(`unknown tool ${path}`);
  const q: Input = (n) => inputs[n];
  return Promise.resolve().then(() => e.run(env, q));
}

// ---------- tech stack ----------
type Rule = { name: string; category: string; html?: RegExp; header?: [string, RegExp]; cookie?: RegExp; generator?: RegExp };
const R = (category: string, list: Omit<Rule, "category">[]): Rule[] => list.map((r) => ({ ...r, category }));
export const TECH_RULES: Rule[] = [
  ...R("CMS and site builders", [
    { name: "WordPress", html: /\/wp-(content|includes)\//i, generator: /wordpress/i, cookie: /^wp-settings|^wordpress_/i },
    { name: "Drupal", html: /drupal-settings-json|\/sites\/default\/files\//i, generator: /drupal/i, header: ["x-generator", /drupal/i] },
    { name: "Joomla", html: /\/media\/jui\/|\/components\/com_/i, generator: /joomla/i },
    { name: "Ghost", generator: /ghost/i, html: /ghost-(portal|sdk)|\/ghost\/api\//i },
    { name: "Wix", html: /static\.wixstatic\.com|wix-bolt|_wixCssImports/i, header: ["x-wix-request-id", /./] },
    { name: "Squarespace", html: /static1\.squarespace\.com|squarespace-cdn/i, generator: /squarespace/i },
    { name: "Webflow", html: /data-wf-page|webflow\.js|assets\.website-files\.com/i, generator: /webflow/i },
    { name: "Framer", html: /framerusercontent\.com|data-framer-/i, generator: /framer/i },
    { name: "HubSpot CMS", html: /hs-sites\.com|\/hs-fs\/hubfs\//i, generator: /hubspot/i },
    { name: "Hugo", generator: /hugo/i },
    { name: "Jekyll", generator: /jekyll/i },
    { name: "Docusaurus", generator: /docusaurus/i, html: /docusaurus/i },
    { name: "GitBook", html: /gitbook\.(io|com)\/|__GITBOOK/i },
  ]),
  ...R("E-commerce", [
    { name: "Shopify", html: /cdn\.shopify\.com|Shopify\.theme/i, header: ["x-shopid", /./], cookie: /^_shopify_/ },
    { name: "WooCommerce", html: /woocommerce/i },
    { name: "Magento", html: /Mage\.Cookies|\/static\/version\d+\/frontend\//i, cookie: /^mage-/ },
    { name: "BigCommerce", html: /cdn\d*\.bigcommerce\.com/i },
    { name: "PrestaShop", html: /var prestashop\s*=/i, generator: /prestashop/i },
  ]),
  ...R("JavaScript frameworks", [
    { name: "Next.js", html: /__NEXT_DATA__|\/_next\/static\//, header: ["x-powered-by", /next\.js/i] },
    { name: "Nuxt", html: /__NUXT__|\/_nuxt\//, generator: /nuxt/i },
    { name: "Gatsby", html: /___gatsby|gatsby-/, generator: /gatsby/i },
    { name: "Remix", html: /__remixContext|__remixManifest/ },
    { name: "SvelteKit", html: /__sveltekit|data-sveltekit/ },
    { name: "Astro", html: /<astro-island|astro-[a-z0-9]{6,}/i, generator: /astro/i },
    { name: "Angular", html: /\bng-version=|ng-app=/ },
    { name: "Vue.js", html: /\bdata-v-[0-9a-f]{8}\b|vue(\.runtime)?(\.global)?(\.prod)?(\.min)?\.js/i },
    { name: "React", html: /data-reactroot|react-dom(\.production)?(\.min)?\.js|__REACT_DEVTOOLS/i },
    { name: "jQuery", html: /jquery[.-]?(\d[\d.]*)?(\.min)?\.js/i },
    { name: "Alpine.js", html: /alpinejs|\bx-data=/ },
    { name: "htmx", html: /htmx(\.org)?(\.min)?\.js|\bhx-(get|post)=/ },
  ]),
  ...R("CSS and fonts", [
    { name: "Bootstrap", html: /bootstrap(\.bundle)?(\.min)?\.(css|js)/i },
    { name: "Tailwind CSS", html: /tailwind(css)?(\.min)?\.css|cdn\.tailwindcss\.com/i },
    { name: "Google Fonts", html: /fonts\.googleapis\.com|fonts\.gstatic\.com/i },
    { name: "Adobe Fonts", html: /use\.typekit\.net/i },
    { name: "Font Awesome", html: /font-?awesome/i },
  ]),
  ...R("Analytics", [
    { name: "Google Analytics", html: /googletagmanager\.com\/gtag\/js|google-analytics\.com\/(analytics|ga)\.js/i },
    { name: "Google Tag Manager", html: /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,}/ },
    { name: "Plausible", html: /plausible\.io\/js/i },
    { name: "Fathom", html: /cdn\.usefathom\.com/i },
    { name: "Matomo", html: /matomo\.js|piwik\.js/i },
    { name: "Hotjar", html: /static\.hotjar\.com/i },
    { name: "Microsoft Clarity", html: /clarity\.ms\/tag/i },
    { name: "Segment", html: /cdn\.segment\.com/i },
    { name: "Mixpanel", html: /cdn\.mxpnl\.com|mixpanel-[\d.]+(\.min)?\.js/i },
    { name: "Amplitude", html: /cdn\.amplitude\.com/i },
    { name: "Heap", html: /cdn\.heapanalytics\.com/i },
    { name: "PostHog", html: /(us|eu|app)\.i\.posthog\.com|posthog\.init\(/i },
    { name: "Vercel Analytics", html: /\/_vercel\/insights/i },
    { name: "Cloudflare Web Analytics", html: /static\.cloudflareinsights\.com/i },
  ]),
  ...R("Advertising", [
    { name: "Meta Pixel", html: /connect\.facebook\.net\/[^"']*fbevents\.js/i },
    { name: "LinkedIn Insight", html: /snap\.licdn\.com/i },
    { name: "Google Ads", html: /googleadservices\.com|googlesyndication\.com/i },
    { name: "TikTok Pixel", html: /analytics\.tiktok\.com/i },
  ]),
  ...R("Customer support and marketing", [
    { name: "Intercom", html: /widget\.intercom\.io|js\.intercomcdn\.com/i },
    { name: "Zendesk", html: /static\.zdassets\.com|zendesk\.com\/embeddable/i },
    { name: "HubSpot", html: /js\.hs-scripts\.com|js\.hsforms\.net/i },
    { name: "Drift", html: /js\.driftt\.com/i },
    { name: "Crisp", html: /client\.crisp\.chat/i },
    { name: "Tawk.to", html: /embed\.tawk\.to/i },
    { name: "Mailchimp", html: /chimpstatic\.com|list-manage\.com/i },
    { name: "Klaviyo", html: /static\.klaviyo\.com/i },
  ]),
  ...R("Payments", [
    { name: "Stripe", html: /js\.stripe\.com/i },
    { name: "PayPal", html: /paypal\.com\/sdk\/js|paypalobjects\.com/i },
    { name: "Klarna", html: /x\.klarnacdn\.net|js\.klarna\.com|klarnaservices\.com/i },
  ]),
  ...R("Security", [
    { name: "reCAPTCHA", html: /google\.com\/recaptcha|recaptcha\/api\.js/i },
    { name: "hCaptcha", html: /hcaptcha\.com/i },
    { name: "Cloudflare Turnstile", html: /challenges\.cloudflare\.com\/turnstile/i },
  ]),
  ...R("CDN and hosting", [
    { name: "Cloudflare", header: ["cf-ray", /./] },
    { name: "Fastly", header: ["x-served-by", /cache-/i] },
    { name: "Amazon CloudFront", header: ["x-amz-cf-id", /./] },
    { name: "Akamai", header: ["server", /akamai/i] },
    { name: "Vercel", header: ["x-vercel-id", /./] },
    { name: "Netlify", header: ["x-nf-request-id", /./] },
    { name: "GitHub Pages", header: ["server", /^github\.com$/i] },
    { name: "Heroku", header: ["via", /vegur/i] },
    { name: "Fly.io", header: ["fly-request-id", /./] },
    { name: "Render", header: ["x-render-origin-server", /./] },
    { name: "Google Cloud", header: ["server", /google frontend/i] },
    { name: "Microsoft Azure", header: ["x-azure-ref", /./] },
    { name: "Amazon S3", header: ["server", /amazons3/i] },
  ]),
  ...R("Web servers", [
    { name: "Nginx", header: ["server", /nginx/i] },
    { name: "OpenResty", header: ["server", /openresty/i] },
    { name: "Apache", header: ["server", /apache/i] },
    { name: "Microsoft IIS", header: ["server", /microsoft-iis/i] },
    { name: "LiteSpeed", header: ["server", /litespeed/i] },
    { name: "Caddy", header: ["server", /caddy/i] },
  ]),
  ...R("Languages and backends", [
    { name: "PHP", header: ["x-powered-by", /php/i], cookie: /^PHPSESSID$/ },
    { name: "ASP.NET", header: ["x-powered-by", /asp\.net/i], cookie: /^ASP\.NET_SessionId$|^\.AspNetCore\./ },
    { name: "Express", header: ["x-powered-by", /express/i] },
    { name: "Laravel", cookie: /^laravel_session$|^XSRF-TOKEN$/ },
    { name: "Django", cookie: /^csrftoken$|^django_language$/ },
    { name: "Ruby on Rails", cookie: /^_[a-z0-9_]+_session$/, html: /csrf-param" content="authenticity_token/ },
    { name: "Java", cookie: /^JSESSIONID$/ },
  ]),
];
/** Matches the rules against a page; each technology is reported once, with the first evidence that matched. */
export function detectTech(html: string, headers: Headers) {
  const generator = /<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)/i.exec(html)?.[1] ?? /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']generator["']/i.exec(html)?.[1] ?? null;
  const cookies = (headers.get("set-cookie") ?? "").split(/,(?=\s*[^;,=\s]+=)/).map((c) => c.trim().split("=")[0]).filter(Boolean);
  const found: { name: string; category: string; evidence: string }[] = [];
  for (const r of TECH_RULES) {
    let evidence: string | null = null;
    if (r.header) { const v = headers.get(r.header[0]); if (v !== null && r.header[1].test(v)) evidence = `header ${r.header[0]}`; }
    if (!evidence && r.generator && generator && r.generator.test(generator)) evidence = `generator ${generator.slice(0, 60)}`;
    if (!evidence && r.cookie) { const c = cookies.find((n) => r.cookie!.test(n)); if (c) evidence = `cookie ${c}`; }
    if (!evidence && r.html) { const m = r.html.exec(html); if (m) evidence = `page ${m[0].slice(0, 60)}`; }
    if (evidence) found.push({ name: r.name, category: r.category, evidence });
  }
  const byCategory: Record<string, string[]> = {};
  for (const f of found) (byCategory[f.category] ??= []).push(f.name);
  return { technologies: found, byCategory, generator, server: headers.get("server"), poweredBy: headers.get("x-powered-by") };
}

const TECH: Entry[] = [
  entry("/tech/stack", "Tech stack detection: CMS, frameworks, analytics and hosting",
    "Detect the technologies behind a website from its home page HTML and response headers: CMS or site builder (WordPress, Shopify, Webflow…), JavaScript framework (Next.js, Nuxt, React…), analytics and ad pixels, support widgets, payments, captcha, CDN and hosting, web server and backend language, each with the evidence that matched. About 110 public fingerprints, server HTML only. Use for lead research, competitor analysis or sales prospecting.",
    ["tech-stack", "technology-detection", "website-technology", "competitor-analysis", "web", "utility"],
    { url: { type: "string", description: "Website or page URL", required: true, example: "https://vercel.com/" } },
    { url: "https://vercel.com/", technologies: [{ name: "Next.js", category: "JavaScript frameworks", evidence: "page /_next/static/" }, { name: "Vercel", category: "CDN and hosting", evidence: "header x-vercel-id" }], byCategory: { "JavaScript frameworks": ["Next.js"], "CDN and hosting": ["Vercel"] }, generator: null, server: "Vercel", poweredBy: null, count: 2 },
    async (_e, q) => {
      const target = parseTarget(need(q, "url", 2_000));
      const res = await fetchPublic(target, "text/html,*/*;q=0.5", [], { cacheSeconds: 600 });
      const html = (await new Response(res.body).text()).slice(0, 1_000_000);
      const out = detectTech(html, res.headers);
      return { url: res.url || target.href, ...out, count: out.technologies.length };
    }),
];

// ---------- EVM developer toolbox ----------
const MAX_UINT = (1n << 256n) - 1n;
/** Works out what an EVM value is and returns every useful conversion of it. */
export function evmToolbox(raw: string, decimals = 18) {
  const input = raw.trim();
  const out: Record<string, unknown> = { input };
  if (/^0x[0-9a-fA-F]{40}$/.test(input)) {
    const checksummed = getAddress(input.toLowerCase());
    const body = input.slice(2);
    // An all-lowercase or all-uppercase address carries no checksum to validate.
    const checksumValid = body === body.toLowerCase() || body === body.toUpperCase() ? null : input === checksummed;
    return { ...out, kind: "address", checksummed, lowercase: input.toLowerCase(), checksumValid, isZero: /^0x0{40}$/.test(input), asBytes32: `0x${body.toLowerCase().padStart(64, "0")}` };
  }
  if (isHex(input, { strict: true }) && input.length > 2) {
    const hex = input.toLowerCase() as Hex;
    const bytes = (hex.length - 2) / 2;
    if (hex.length === 66) {
      const n = hexToBigInt(hex);
      return { ...out, kind: "bytes32", bytes: 32, asUint256: n.toString(), asAddress: /^0x0{24}/.test(hex) ? getAddress(`0x${hex.slice(26)}`) : null, asUnits: formatUnits(n, decimals), keccak256: keccak256(hex) };
    }
    if (hex.length >= 10 && (hex.length - 10) % 64 === 0 && hex.length % 2 === 0) {
      return { ...out, kind: "calldata", bytes, selector: hex.slice(0, 10), decode: decodeCalldata(hex), keccak256: keccak256(hex) };
    }
    if (hex.length <= 66) {
      const n = hexToBigInt(hex);
      return { ...out, kind: "hex number", bytes, decimal: n.toString(), asUnits: formatUnits(n, decimals), wei: { gwei: formatUnits(n, 9), ether: formatUnits(n, 18) }, keccak256: keccak256(hex) };
    }
    return { ...out, kind: "bytes", bytes, keccak256: keccak256(hex) };
  }
  const sig = input.replace(/^(function|event)\s+/, "");
  if (/^[A-Za-z_$][\w$]*\((\s*[a-z0-9\[\](),\s]*)\)$/.test(sig)) {
    const canonical = sig.replace(/\s+/g, "");
    const hash = keccak256(toBytes(canonical));
    let selector: string | null = null;
    try { selector = toFunctionSelector(`function ${canonical}`); } catch { selector = hash.slice(0, 10); }
    return { ...out, kind: "signature", canonical, functionSelector: selector, eventTopic: hash };
  }
  if (/^\d[\d_,]*(\.\d+)?$/.test(input)) {
    const clean = input.replace(/[_,]/g, "");
    if (clean.includes(".")) {
      const units = parseUnits(clean, decimals);
      if (units > MAX_UINT) throw new HttpError(400, "number is larger than uint256");
      return { ...out, kind: "decimal amount", decimals, baseUnits: units.toString(), hex: toHex(units), wei: decimals === 18 ? { wei: units.toString(), gwei: formatUnits(units, 9) } : null };
    }
    const n = BigInt(clean);
    if (n > MAX_UINT) throw new HttpError(400, "number is larger than uint256");
    return { ...out, kind: "integer", hex: toHex(n), asBytes32: `0x${n.toString(16).padStart(64, "0")}`, fromBaseUnits: formatUnits(n, decimals), toBaseUnits: (n * 10n ** BigInt(decimals)).toString(), wei: { gwei: formatUnits(n, 9), ether: formatUnits(n, 18) } };
  }
  const utf8 = toHex(toBytes(input));
  return { ...out, kind: "text", keccak256: keccak256(toBytes(input)), hex: utf8, bytes: (utf8.length - 2) / 2 };
}

// ---------- gas tracker ----------
const GAS_CHAINS = [["base", "Base", "ETH"], ["eth", "Ethereum", "ETH"], ["arb", "Arbitrum", "ETH"], ["op", "Optimism", "ETH"], ["polygon", "Polygon", "POL"]] as const;

// ---------- mail provider by MX host ----------
const MAIL_PROVIDERS: [RegExp, string][] = [[/google\.com$|googlemail\.com$/i, "Google Workspace"], [/outlook\.com$|protection\.outlook/i, "Microsoft 365"], [/zoho\./i, "Zoho Mail"], [/protonmail\.ch$|proton\.me$/i, "Proton Mail"], [/mimecast/i, "Mimecast"], [/pphosted\.com$|ppe-hosted/i, "Proofpoint"], [/messagingengine\.com$/i, "Fastmail"], [/mailgun\.org$/i, "Mailgun"], [/amazonaws\.com$|amazonses/i, "Amazon SES"], [/yandex\./i, "Yandex Mail"], [/icloud\.com$/i, "iCloud Mail"], [/secureserver\.net$/i, "GoDaddy"], [/ovh\.net$/i, "OVH"], [/one\.com$/i, "one.com"], [/mx\.cloudflare\.net$/i, "Cloudflare Email Routing"], [/barracudanetworks\.com$/i, "Barracuda"]];
export const mailProvider = (hosts: string[]) => { for (const h of hosts) for (const [re, name] of MAIL_PROVIDERS) if (re.test(h)) return name; return hosts.length ? "self-hosted or other" : null; };

/** The company name when the page has no og:site_name: the title segment that contains the domain's own label. */
export function nameFromTitle(title: unknown, domain: string) {
  if (typeof title !== "string") return null;
  const label = domain.split(".")[0].toLowerCase().replace(/-/g, "");
  if (label.length < 2) return null;
  const segments = title.split(/\s+[|·•–—-]\s+|:\s+/).map((s) => s.trim()).filter(Boolean);
  const hit = segments.filter((s) => s.toLowerCase().replace(/[\s-]/g, "").includes(label) && s.length <= 40).sort((a, b) => a.length - b.length)[0];
  return hit ?? null;
}

const hostOf = (raw: string) => {
  let v = raw.trim().toLowerCase();
  if (/^https?:\/\//.test(v)) { try { v = new URL(v).hostname; } catch { throw new HttpError(400, "domain must be a domain such as example.com or a URL"); } }
  return v.replace(/^www\./, "").replace(/\.$/, "").split("/")[0];
};

export const PACKS_INTEL: Entry[] = [
  ...TECH,

  entry("/pack/evm-toolbox", "EVM developer utilities toolbox: checksum, keccak, selectors, units",
    "One call that works out what an EVM value is and converts it every useful way: an address gets its EIP-55 checksum and bytes32 form; a signature its 4-byte selector and event topic; calldata is decoded (ERC-20, NFT, permit, EIP-3009); a bytes32 becomes uint256, address and units; a number converts between wei, gwei, ether (or any decimals) and hex; text gets keccak256. Local, no network. Use for building or debugging contracts and agents.",
    ["evm-developer-utilities", "developer-utilities", "keccak256", "function-selector", "pack", "dev"],
    {
      input: { type: "string", description: "An address, signature, calldata, hex value, number or text", required: true, example: "transfer(address,uint256)" },
      decimals: { type: "string", description: "Token decimals for unit conversions (default 18)", example: "6" },
    },
    { pack: "evm-toolbox", input: "transfer(address,uint256)", kind: "signature", canonical: "transfer(address,uint256)", functionSelector: "0xa9059cbb", eventTopic: "0xa9059cbb2ab09eb219583f4a59a5d0623ade346d962bcd4e46b11da047c9049b" },
    (_e, q) => ({ pack: "evm-toolbox", ...evmToolbox(need(q, "input", 20_000), num(q, "decimals", { min: 0, max: 36, fallback: 18, integer: true })) }), PACK_PRICE),

  entry("/pack/seo-toolkit", "SEO analysis, SEO toolkit: audit, keywords, social preview",
    "One call for an on-page SEO analysis of a URL: the SEO audit (title and description lengths, canonical, headings, alt text, structured data, score, issues), the top keywords and two-word phrases with their density, the social preview (OpenGraph, Twitter card), the favicon, and robots.txt access with its sitemaps. Server HTML only. Cheaper than the tools one by one. Use before publishing, for an SEO report or to compare a competitor's page.",
    ["seo-analysis", "seo-toolkit", "seo-audit", "keyword-density", "pack", "web"],
    { url: { type: "string", description: "Absolute http(s) URL of the page", required: true, example: "https://www.wikipedia.org/" } },
    { pack: "seo-toolkit", url: "https://www.wikipedia.org/", audit: { score: 64, issues: ["no canonical link"], title: "Wikipedia", titleLength: 9, h1: ["Wikipedia"], wordCount: 1500 }, keywords: [{ word: "wikipedia", count: 23, densityPct: 1.75 }], phrases: [{ phrase: "free encyclopedia", count: 3, densityPct: 0.23 }], social: { title: "Wikipedia", description: "Wikipedia is a free online encyclopedia…", image: null }, favicon: "https://www.wikipedia.org/static/favicon/wikipedia.ico", robots: { allowed: true, sitemaps: [] }, failed: {} },
    async (env, q) => {
      const url = need(q, "url", 2_000);
      try { if (!/^https?:$/.test(new URL(url).protocol)) throw new Error(); } catch { throw new HttpError(400, "url must be an absolute http(s) URL"); }
      const { data, failed } = await runSections({
        audit: call(env, "/seo/audit", { url }),
        keywords: call(env, "/text/keyword-density", { url }),
        meta: local(env, "/url/meta", { url }),
        favicon: local(env, "/url/favicon", { url }),
        robots: call(env, "/robots", { url }),
      });
      const kd = data.keywords as { keywords?: unknown[]; phrases?: unknown[]; totalWords?: number } | undefined;
      const meta = data.meta as Record<string, unknown> | undefined;
      return {
        pack: "seo-toolkit", url,
        audit: data.audit ? pick2(data.audit, ["score", "issues", "title", "titleLength", "description", "descriptionLength", "canonical", "robots", "h1", "h2Count", "images", "imagesWithoutAlt", "lang", "viewport", "jsonLdBlocks", "links", "wordCount"]) : null,
        keywords: kd?.keywords?.slice(0, 15) ?? null, phrases: kd?.phrases?.slice(0, 10) ?? null,
        social: meta ? pick2(meta, ["title", "description", "siteName", "type", "image", "canonical", "openGraph", "twitter"]) : null,
        favicon: (data.favicon as { best?: string | null } | undefined)?.best ?? null,
        robots: data.robots ? pick2(data.robots, ["allowed", "matchedRule", "sitemaps"]) : null,
        failed,
      };
    }, PACK_PRICE),

  entry("/pack/gas-tracker", "Gas tracker, multichain gas: 5 EVM chains and Bitcoin fees",
    "One call for current gas prices on Base, Ethereum, Arbitrum, Optimism and Polygon: gas price, base fee and priority fee in gwei and what a plain transfer costs in the native coin and, for the ETH chains, in US dollars (Uniswap ETH price), sorted cheapest first, plus Bitcoin fee rates in sat/vB. Cheaper than the tools bought one by one. Use to pick the cheapest chain, time a transaction or show fees in a wallet.",
    ["gas-tracker", "multichain-gas", "gas-price", "gas-fees", "pack", "crypto"], {},
    { pack: "gas-tracker", ethUsd: 2371.36, chains: [{ chain: "Optimism", gasPriceGwei: "0.001000292", baseFeeGwei: "0.000000292", priorityFeeGwei: "0.001", transferCost: "0.000000021006132", symbol: "ETH", transferUsd: 0.00005 }], cheapest: "Optimism", bitcoin: { nextBlock: 3, hour: 2, unit: "sat/vB" }, failed: {} },
    async (env) => {
      const { data, failed } = await runSections({
        ...Object.fromEntries(GAS_CHAINS.map(([slug]) => [slug, call(env, `/${slug}/gas`, {})])),
        ethUsd: call(env, "/price/token", { symbol: "ETH", chain: "base" }),
        bitcoin: bitcoinFees(),
      });
      const usd = (data.ethUsd as { usd?: number; priceUsd?: number } | undefined);
      const ethUsd = usd?.usd ?? usd?.priceUsd ?? null;
      const chains = GAS_CHAINS.filter(([slug]) => data[slug]).map(([slug, name, symbol]) => {
        const g = data[slug] as { gasPriceGwei: string; baseFeeGwei: string | null; priorityFeeGwei?: string | null; transferCost: string };
        const transferUsd = symbol === "ETH" && ethUsd ? Math.round(Number(g.transferCost) * ethUsd * 1e6) / 1e6 : null;
        return { chain: name, gasPriceGwei: g.gasPriceGwei, baseFeeGwei: g.baseFeeGwei, priorityFeeGwei: g.priorityFeeGwei ?? null, transferCost: g.transferCost, symbol, transferUsd };
      }).sort((a, b) => (a.transferUsd ?? Infinity) - (b.transferUsd ?? Infinity));
      const fees = data.bitcoin as { fees?: { nextBlock: number; hour: number }; unit?: string } | undefined;
      return { pack: "gas-tracker", ethUsd, chains, cheapest: chains.find((c) => c.transferUsd !== null)?.chain ?? null, bitcoin: fees?.fees ? { nextBlock: fees.fees.nextBlock, hour: fees.fees.hour, unit: fees.unit ?? "sat/vB" } : null, failed };
    }, PACK_PRICE),

  entry("/pack/domain-intel", "Domain intelligence, enrichment: who runs a domain and on what",
    "Company enrichment in one call for any domain: the site's name, description and logo, its tech stack (CMS, frameworks, analytics, hosting), email provider and email security (SPF, DMARC), who hosts the server (IP registry holder), DNS records, and the domain's registrar, age and expiry. Public DNS, RDAP and the home page only. Use for lead enrichment, company research, vendor checks or sales prospecting.",
    ["domain-intelligence", "company-enrichment", "lead-enrichment", "company-research", "pack", "web"],
    { domain: { type: "string", description: "Company domain such as stripe.com (or a URL; its host is used)", required: true, example: "stripe.com" } },
    { pack: "domain-intel", domain: "stripe.com", site: { title: "Stripe | Financial Infrastructure to Grow Your Revenue", description: "Stripe is a suite of APIs…", siteName: "Stripe", logo: "https://images.stripeassets.com/…/favicon.svg", twitter: "@stripe" }, tech: { "JavaScript frameworks": ["Next.js"], "Web servers": ["Nginx"] }, email: { provider: "Google Workspace", spfPolicy: "~all", dmarcPolicy: "reject" }, hosting: { ip: "52.49.17.168", holder: "Amazon Data Services Ireland Limited", country: null }, registration: { registrar: "SafeNames Ltd.", registeredAt: "1995-09-12T04:00:00Z", ageDays: 11000, expiresAt: "2027-09-11T04:00:00Z" }, dns: { a: ["52.49.17.168"], mx: [{ priority: 10, host: "aspmx.l.google.com" }], ns: ["ns-1087.awsdns-07.org"] }, failed: {} },
    async (env, q) => {
      const domain = hostOf(need(q, "domain", 300));
      const home = `https://${domain}/`;
      const dom = await domainInfo(domain);
      if (!dom.exists) throw new HttpError(404, `${domain} does not exist in DNS`);
      const ip = dom.dns.a[0] ?? null;
      const { data, failed } = await runSections({
        meta: local(env, "/url/meta", { url: home }),
        favicon: local(env, "/url/favicon", { url: home }),
        tech: local(env, "/tech/stack", { url: home }),
        ...(ip ? { hosting: call(env, "/ip/lookup", { ip }) } : {}),
      });
      const meta = data.meta as Record<string, unknown> | undefined;
      const host = data.hosting as { holder?: { name: string | null } | null; country?: string | null } | undefined;
      return {
        pack: "domain-intel", domain,
        site: meta || data.favicon ? {
          title: meta?.title ?? null, description: meta?.description ?? null, siteName: meta?.siteName ?? nameFromTitle(meta?.title, domain),
          logo: (data.favicon as { best?: string | null } | undefined)?.best ?? null,
          twitter: (meta?.twitter as Record<string, string> | undefined)?.["twitter:site"] ?? null,
        } : null,
        tech: (data.tech as { byCategory?: unknown } | undefined)?.byCategory ?? null,
        email: { provider: mailProvider(dom.dns.mx.map((m) => m.host).filter((h) => h && h !== ".")), spfPolicy: dom.email.spfPolicy, dmarcPolicy: dom.email.dmarcPolicy },
        hosting: ip ? { ip, holder: host?.holder?.name ?? null, country: host?.country ?? null } : null,
        registration: dom.registration ? pick2(dom.registration, ["registrar", "registeredAt", "ageDays", "expiresAt"]) : null,
        dns: { a: dom.dns.a, aaaa: dom.dns.aaaa, mx: dom.dns.mx, ns: dom.dns.ns },
        failed,
      };
    }, PACK_PRICE),
];
