// Listings state only what the code does, and the documents that describe the service agree with the catalogue.
// Static checks over the whole catalogue and the hand-written documents: nothing here starts the Worker.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { before, test } = require("node:test");
const esbuild = require("esbuild");

const ROOT = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");

let m, byPath;
before(async () => {
  const contents = [
    'export * from "./src/discovery";',
    'export { ENTRY_OF } from "./src/routes/entry-paths";',
    'export { FREE_CALLS_PER_CALLER, FREE_HTTP_CALLS_PER_CALLER, FREE_CALLS_PER_DAY } from "./src/lib/free-calls";',
    'export { CREDIT_PACKS } from "./src/lib/credits";',
    'export { listingDescription, listingNameFor, listingTags, bazaarExtensionFor, builderCodeExtension, LISTING_NAME_OF } from "./src/lib/bazaar-extension";',
    'export { usdcRequirements } from "./src/lib/discovery-index";',
    'export { catalogSkillMarkdown } from "./src/guides/catalog-skill";',
    'export { TICKERS, knowsTicker, listedTickers, tickerClause } from "./src/lib/tickers";',
    'export { CHAINS, EXTRA_CHAINS, USDC } from "./src/routes/chain-reads";',
    'export { TECH_RULES } from "./src/routes/packs-intel";',
    'export { SPEECH_LANGS } from "./src/lib/melo";',
    'export { SPEECH_VOICES } from "./src/routes/ai-text";',
    'export { GUARD_CATEGORIES } from "./src/routes/safety";',
  ].join("\n");
  const out = await esbuild.build({ stdin: { contents, resolveDir: ROOT, loader: "ts" }, bundle: true, format: "cjs", platform: "node", write: false, external: ["cloudflare:workers"], logLevel: "silent" });
  const loaded = new Module(path.join(ROOT, "listing-truth.bundle.cjs"), module);
  loaded.paths = Module._nodeModulePaths(ROOT);
  loaded._compile(out.outputFiles[0].text, loaded.id);
  m = loaded.exports;
  byPath = Object.fromEntries(m.ENDPOINTS.map((e) => [e.path, e]));
});

const usd = (price) => Number(price.slice(1));
const textOf = (e) => `${e.summary} ${e.description}`;

// ---- Published inputs ----

test("every published example input is usable: required inputs carry a value, enum inputs carry one of their own values", () => {
  for (const e of m.ENDPOINTS) {
    for (const [name, p] of Object.entries(e.params)) {
      if (p.required) assert.ok(p.example !== undefined && p.example !== "", `${e.path}: required input ${name} has no example value`);
      if (p.enum) assert.ok(p.enum.includes(String(p.example)), `${e.path}: ${name} example ${JSON.stringify(p.example)} is not one of ${p.enum.join(", ")}`);
      if (p.example !== undefined && p.example !== "") {
        assert.equal(typeof p.example === "string", p.type === "string", `${e.path}: ${name} is declared ${p.type} but its example is a ${typeof p.example}`);
        if (p.type === "integer") assert.ok(Number.isInteger(p.example), `${e.path}: ${name} is an integer but its example is ${p.example}`);
      }
    }
    // The inputs a buyer copies (service card, Bazaar discovery input) are the required ones, each with its example.
    for (const [name, p] of m.exampleParams(e)) assert.ok(p.example !== undefined && p.example !== "", `${e.path}: published example has no value for ${name}`);
    assert.ok(Object.keys(e.outputExample).length > 0, `${e.path}: empty output example`);
  }
});

// ---- Claims a description may not make ----

// Tools that answer from a file or snapshot stored with the service: the World Bank series (src/routes/econ.ts), the
// Treasury snapshot (src/routes/treasury.ts), the airport table (src/routes/airports.ts) and the EU and Swedish law
// index (src/routes/law-search.ts, law-layers.ts). A listing of such a tool may not call its data live, real-time or
// today's. /airport/status is not one of them: it reads the FAA feed on every call.
const READS_SNAPSHOT = /^\/(econ|law)\/|^\/airport\/lookup$/;
const LIVE_WORDS = /real[- ]time|\blive\b|right now|\btoday\b|up[- ]to[- ]the[- ]minute/i;

test("a tool that reads a stored snapshot is not listed as live, real-time or today's data", () => {
  const snapshotPaths = new Set(m.ENDPOINTS.map((e) => e.path).filter((p) => READS_SNAPSHOT.test(p)));
  assert.ok(snapshotPaths.size >= 8, `snapshot tools found: ${snapshotPaths.size}`);
  const doors = Object.entries(m.ENTRY_OF).filter(([, canonical]) => snapshotPaths.has(canonical)).map(([door]) => door);
  for (const p of [...snapshotPaths, ...doors]) {
    const e = byPath[p];
    if (!e) continue; // paused
    // "not a live yield curve" is a disclaimer, not a claim.
    const claims = textOf(e).replace(/not (a )?(live|real[- ]time)[^.;]*/gi, "");
    assert.doesNotMatch(claims, LIVE_WORDS, `${p} reads a stored snapshot`);
  }
  // Any description that says it reads a committed or dated snapshot is held to the same rule, wherever it lives.
  for (const e of m.ENDPOINTS) {
    if (!/(committed|dated|stored) [A-Za-z ]*snapshot/i.test(e.description)) continue;
    assert.doesNotMatch(textOf(e).replace(/not (a )?(live|real[- ]time)[^.;]*/gi, ""), LIVE_WORDS, `${e.path} says it reads a snapshot`);
  }
});

// A tool whose path names one network (/<chain>/..., /base-gas) reads that network only.
const CHAIN_PREFIX = /^\/(base|eth|arb|op|polygon|avax|gnosis|linea|zksync|scroll|mantle|celo|sonic|unichain|hyperevm|bera|ink|sei|solana)[/-]/;
const EVERY_CHAIN = /\b(all|every|any) (major )?(EVM )?(chain|network|blockchain)s?\b/i;

test("no listing claims every chain: single-network tools, and tools with no network input, name their networks", () => {
  // /evm/checksum: EIP-55 is the same on every EVM chain and the tool reads no network at all.
  const exempt = new Set(["/evm/checksum"]);
  for (const e of m.ENDPOINTS) {
    if (exempt.has(e.path)) continue;
    const text = textOf(e);
    const takesNetwork = Object.keys(e.params).some((k) => /^(chain|chains|network|networks)$/.test(k));
    if (CHAIN_PREFIX.test(e.path) || !takesNetwork) assert.doesNotMatch(text, EVERY_CHAIN, `${e.path} reads fixed networks`);
    assert.doesNotMatch(Object.hasOwn(m.LISTING_NAME_OF, e.path) ? m.LISTING_NAME_OF[e.path] : "", EVERY_CHAIN, `${e.path} listing name`);
  }
});

test("no listing claims an engine or a record the service does not have", () => {
  for (const e of m.ENDPOINTS) {
    const all = `${textOf(e)} ${e.tags.join(" ")}`;
    // Web search is the Brave index, keyword-ranked: nothing here is a neural or semantic web index.
    assert.doesNotMatch(all, /neural/i, `${e.path}: no neural search engine behind this service`);
    // Domain tools return the registrar and dates (RDAP); the registrant is not in any answer.
    assert.doesNotMatch(all, /who owns (a|the|this) (domain|site|website)/i, `${e.path}: registrant is not returned`);
    // The whale tools return unlabelled addresses: no wallet is identified as "smart money".
    if (e.path.startsWith("/whale")) assert.doesNotMatch(`${all} ${m.listingNameFor(e)}`, /smart[- ]money/i, `${e.path}: addresses are not labelled`);
  }
});

test("a description that states its per-call price states the tool's own price", () => {
  let checked = 0;
  for (const e of m.ENDPOINTS) {
    for (const match of e.description.matchAll(/\$(\d+(?:\.\d+)?) (?:per|a) call/g)) {
      checked++;
      assert.equal(Number(match[1]), usd(e.price), `${e.path} says ${match[0]} and costs ${e.price}`);
    }
  }
  assert.ok(checked >= 1, "the rule still has something to check");
});

test("an entry path states no limit or size its canonical tool does not have", () => {
  // The 20 Nov doors promised 2,000 characters on a 300-character tool. Every figure of 100 or more in a door's name
  // or description must appear in the canonical tool's own text, inputs or example (or in the door's own inputs).
  const plain = (s) => s.replace(/,(?=\d{3})/g, "");
  for (const [door, canonical] of Object.entries(m.ENTRY_OF)) {
    const a = byPath[door], b = byPath[canonical];
    assert.ok(a && b, `${door} -> ${canonical}`);
    const source = plain(`${b.summary} ${b.description} ${b.details ?? ""} ${JSON.stringify(b.params)} ${JSON.stringify(a.params)} ${JSON.stringify(b.outputExample)}`);
    const figures = [...plain(textOf(a)).matchAll(/(?<![\w$.-])\d{3,}(?![\w-])/g)].map((x) => x[0]);
    for (const f of new Set(figures)) assert.match(source, new RegExp(`(?<!\\d)${f}(?!\\d)`), `${door} states ${f}, which ${canonical} does not`);
    // A door answers with its canonical tool's fields.
    assert.deepEqual(Object.keys(a.outputExample).filter((k) => !Object.hasOwn(b.outputExample, k)).filter((k) => !(canonical === "/extract" && k === "markdown")), [], `${door} example has fields ${canonical} lacks`);
  }
});

// ---- Sentences about the whole service ----

test("the service summary, page title and guidance take prices and free-call numbers from the code", () => {
  const prices = m.ENDPOINTS.map((e) => usd(e.price));
  assert.equal(usd(m.LOWEST_PRICE), Math.min(...prices));
  assert.equal(usd(m.TOP_PRICE), Math.max(...prices));
  const count = {};
  for (const e of m.ENDPOINTS) count[e.price] = (count[e.price] ?? 0) + 1;
  assert.equal(m.USUAL_PRICE, Object.entries(count).sort((a, b) => b[1] - a[1])[0][0]);
  assert.equal(m.ORDINARY_PRICE, m.USUAL_PRICE);
  assert.ok(m.SERVICE_SUMMARY.includes(`from ${m.LOWEST_PRICE} a call, most at ${m.USUAL_PRICE}.`), m.SERVICE_SUMMARY.slice(0, 160));
  assert.ok(m.SERVICE_SUMMARY.includes(`(${m.FREE_CALLS_PER_CALLER} over MCP, ${m.FREE_HTTP_CALLS_PER_CALLER} over HTTP`));
  assert.ok(m.PAGE_TITLE.endsWith(`${m.TOOL_COUNT} tools, ${m.FREE_CALLS_PER_CALLER} free calls over MCP, then from ${m.LOWEST_PRICE}`), m.PAGE_TITLE);
  const origin = "https://example.test";
  const home = m.homePage(origin, "0x0000000000000000000000000000000000000001");
  const llms = m.llmsTxt(origin, true, "0x0000000000000000000000000000000000000001");
  const guidance = m.openApi(origin).info["x-guidance"];
  for (const [name, doc] of [["home page", home], ["llms-full.txt", llms], ["x-guidance", guidance]]) {
    // No hand-typed floor or ceiling: every "from $x" and "up to $x" a document states is the catalogue's.
    for (const match of doc.matchAll(/\bfrom (\$\d+(?:\.\d+)?) a call/g)) assert.equal(match[1], m.LOWEST_PRICE, `${name}: ${match[0]}`);
    for (const match of doc.matchAll(/a few cost up to (\$\d+(?:\.\d+)?)/g)) assert.equal(match[1], m.TOP_PRICE, `${name}: ${match[0]}`);
    for (const match of doc.matchAll(/Most tools cost (\$\d+(?:\.\d+)?)/g)) assert.equal(match[1], m.USUAL_PRICE, `${name}: ${match[0]}`);
    // A free-call number in a sentence is one of the two limits free-calls.ts enforces.
    for (const match of doc.matchAll(/\b(?:first )?(\d+) (?:free )?successful calls/g)) assert.ok([m.FREE_CALLS_PER_CALLER, m.FREE_HTTP_CALLS_PER_CALLER].includes(Number(match[1])), `${name}: ${match[0]}`);
  }
  assert.match(home, new RegExp(`The first ${m.FREE_CALLS_PER_CALLER} successful calls on [^<]{5,120} are free`));
});

test("the payment networks named in service-wide sentences are the networks the deployment accepts", () => {
  const wrangler = read("wrangler.jsonc");
  const ids = [/"NETWORK":\s*"([^"]+)"/.exec(wrangler)[1], .../"EXTRA_NETWORKS":\s*"([^"]*)"/.exec(wrangler)[1].split(",").filter(Boolean)];
  const NAMES = { "eip155:8453": "Base", "eip155:137": "Polygon", "eip155:42161": "Arbitrum", "eip155:10": "Optimism", "eip155:1": "Ethereum" };
  const names = ids.map((id) => { assert.ok(NAMES[id], `unknown network ${id}: name it in this test and in the sentences it guards`); return NAMES[id]; });
  if (/"SOLANA_PAY_TO":\s*"[^"]+"/.test(wrangler)) names.push("Solana");
  const comma = `(${names.join(", ")})`;
  const or = `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
  assert.ok(m.SERVICE_SUMMARY.includes(`USDC via x402 ${comma}`), `summary names ${comma}`);
  assert.ok(m.GUIDANCE.includes(`USDC on ${or}`), `guidance names ${or}`);
  assert.ok(m.homePage("https://example.test", "0x0000000000000000000000000000000000000001").includes(`x402 (USDC on ${or})`), `home page names ${or}`);
  const readme = read("README.md");
  assert.ok(readme.includes(`in USDC on ${or}`) && readme.includes(`x402 protocol (${or})`), `README names ${or}`);
});

test("README, llms-install.md and the catalog skill state the enforced free-call limits, credit packs and tool count", () => {
  const readme = read("README.md");
  assert.ok(readme.includes(`**${m.FREE_CALLS_PER_CALLER} free successful calls** over MCP, used automatically, or **${m.FREE_HTTP_CALLS_PER_CALLER}** over HTTP`));
  assert.ok(readme.includes(`${m.FREE_CALLS_PER_CALLER} successful calls per caller over MCP, ${m.FREE_HTTP_CALLS_PER_CALLER} over HTTP`));
  assert.ok(readme.includes(`${m.FREE_CALLS_PER_DAY.toLocaleString("en-US")} a day in total`));
  for (const pack of m.CREDIT_PACKS.filter((p) => p.usdCents >= 500)) assert.ok(readme.includes(`$${pack.usdCents / 100} = ${pack.credits.toLocaleString("en-US")}`), `README credit pack $${pack.usdCents / 100}`);
  for (const match of readme.matchAll(/\b(\d{3}) (?:pay-per-call |catalog )?tools\b/g)) assert.equal(Number(match[1]), m.TOOL_COUNT, `README: ${match[0]}`);
  assert.ok(read("llms-install.md").includes(`caller gets ${m.FREE_CALLS_PER_CALLER} free successful calls`));
  const skill = m.catalogSkillMarkdown("https://example.test");
  const floor = Math.floor(m.TOOL_COUNT / 10) * 10;
  assert.ok(skill.includes(`More than ${floor} tools behind one host`), "catalog skill tool count");
  assert.ok(skill.includes(`each caller gets ${m.FREE_HTTP_CALLS_PER_CALLER} free successful calls over HTTP (${m.FREE_CALLS_PER_CALLER} through the MCP server)`), "catalog skill free calls");
  assert.ok(skill.includes(`most ${m.USUAL_PRICE} and everyday lookups ${m.ACQUISITION_PRICE}`), "catalog skill prices");
});

// ---- Paths and prices named in documents ----

const DOCUMENTS = ["README.md", "llms-install.md", "src/lib/first-call.ts", "src/lib/product-pages.ts", "src/lib/tool-seo.ts", "src/guides/catalog-skill.ts", "src/guides/ai-sdk.ts", "src/guides/task-guides.ts"];

test("README's endpoint table lists live tools at their catalogue prices", () => {
  let rows = 0;
  for (const line of read("README.md").split("\n")) {
    const row = /^\| `GET (\/[a-z0-9/-]+)[^`]*` \| [^|]* \|(.*)\|$/.exec(line);
    if (!row) continue;
    rows++;
    assert.ok(byPath[row[1]], `README lists ${row[1]}, which is not a tool`);
    assert.equal(row[2].trim(), byPath[row[1]].price, `README price of ${row[1]}`);
  }
  assert.ok(rows >= 20, `rows read: ${rows}`);
});

test("a price written beside a tool path in a document is that tool's price", () => {
  let checked = 0;
  for (const file of DOCUMENTS) {
    const text = read(file);
    // `/path` ($0.01)   or   /path ($0.01)
    for (const match of text.matchAll(/`?(\/[a-z0-9][a-z0-9/-]*)`? \((\$\d+(?:\.\d+)?)\)/g)) {
      if (!byPath[match[1]]) continue;
      checked++;
      assert.equal(usd(match[2]), usd(byPath[match[1]].price), `${file}: ${match[0]}`);
    }
    // $0.01 (ai/speech)   as the product pages write it
    for (const match of text.matchAll(/(\$\d+(?:\.\d+)?) \(([a-z0-9][a-z0-9/-]*)\)/g)) {
      if (!byPath[`/${match[2]}`]) continue;
      checked++;
      assert.equal(usd(match[1]), usd(byPath[`/${match[2]}`].price), `${file}: ${match[0]}`);
    }
  }
  assert.ok(checked >= 5, `pairs checked: ${checked}`);
});

test("every tool path a document names is a live tool, a paused tool or a route of the Worker", () => {
  const families = new Set(m.ENDPOINTS.map((e) => e.path.split("/")[1]));
  const index = read("src/index.ts");
  const known = (p) => Boolean(byPath[p]) || Object.hasOwn(m.PAUSED_FAMILY_TOOLS, p) || index.includes(`"${p}"`) || index.includes(`"${p}/`) || index.includes("`" + p);
  // Not tools: the MCP servers, an HTML fragment in the guides' markup, and a path prefix named as a prefix.
  const notTools = (p) => p.startsWith("/mcp/") || p === "/html" || /^\/(eth|arb|op|polygon|base|random|price)$/.test(p);
  for (const file of [...DOCUMENTS, "src/lib/discovery-index.ts", "src/guides/tool-buying.ts", "src/guides/local-mcp.ts", "src/guides/sitemap.ts", "src/guides/dependency-audit.ts"]) {
    const text = read(file);
    for (const match of text.matchAll(/(?<![\w.:>${}/-])\/[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*){0,3}(?![\w/.-])/g)) {
      const p = match[0];
      if (!families.has(p.split("/")[1]) || notTools(p)) continue;
      assert.ok(known(p), `${file} names ${p}, which is not a tool or a route`);
    }
  }
  const guidance = m.GUIDANCE;
  for (const match of guidance.matchAll(/(?<![\w<>/-])\/[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*){0,3}(?![\w/-])(?!\.[a-z])/g)) {
    const p = match[0];
    if (!families.has(p.split("/")[1]) || notTools(p)) continue;
    assert.ok(known(p), `x-guidance names ${p}`);
  }
});

// ---- 402 quote size ----

// A 402's headers must stay under 16 KB (Node's fetch refuses more). The largest part is PAYMENT-REQUIRED: the base64
// of the requirement object, which carries the listing description, the input schema and the output example and
// schema. This builds that object for every tool with the functions the paywall uses and production's networks, without
// starting the Worker. tests/discovery-index.test.cjs measures the real response in Miniflare; this one says which
// tool grew and by how much before that slower test runs. Beside it a 402 carries about 2.5 KB of other headers (two
// or three MPP challenges, the Link header, CORS and edge headers), so 12,500 bytes here keeps the whole under 15 KB.
const PAYMENT_REQUIRED_BUDGET = 12_500;

test("every tool's PAYMENT-REQUIRED header stays inside the 402 header budget", () => {
  const wrangler = read("wrangler.jsonc");
  const env = {
    NETWORK: /"NETWORK":\s*"([^"]+)"/.exec(wrangler)[1],
    EXTRA_NETWORKS: /"EXTRA_NETWORKS":\s*"([^"]*)"/.exec(wrangler)[1],
    PAY_TO: /"PAY_TO":\s*"(0x[0-9a-fA-F]{40})"/.exec(wrangler)[1],
    SOLANA_PAY_TO: (/"SOLANA_PAY_TO":\s*"([^"]+)"/.exec(wrangler) ?? [])[1],
  };
  const origin = "https://agent-data-tools.revmesh2074.workers.dev";
  const sizes = m.ENDPOINTS.map((e) => {
    const required = {
      x402Version: 2,
      error: "Payment required",
      resource: { url: `${origin}${e.path}`, description: m.listingDescription(e), mimeType: "application/json", serviceName: m.listingNameFor(e), iconUrl: m.SERVICE_ICON_URL, tags: m.listingTags(e.tags, e.path) },
      accepts: m.usdcRequirements(env, e.price),
      extensions: { ...m.bazaarExtensionFor(e), ...m.builderCodeExtension() },
    };
    return [e.path, Buffer.from(JSON.stringify(required)).toString("base64").length];
  }).sort((a, b) => b[1] - a[1]);
  assert.ok(sizes[0][1] > 4000, "the estimate measures something");
  for (const [p, bytes] of sizes) assert.ok(bytes <= PAYMENT_REQUIRED_BUDGET, `${p}: PAYMENT-REQUIRED is about ${bytes} bytes; shorten its output example (not its description)`);
});

// ---- Quality round two: what an input's text says, against the input's own declaration and the code's constants ----

test("an input's text names every value its enum takes, and a numeric example lies inside the range the text states", () => {
  let enums = 0, ranges = 0;
  for (const e of m.ENDPOINTS) {
    for (const [name, p] of Object.entries(e.params)) {
      if (p.enum) {
        enums++;
        // /stock/history took interval=1h while its text listed "60m"; /dex/trending took majors=exclude unnamed.
        const words = new Set(p.description.toLowerCase().split(/[^a-z0-9.+-]+/).flatMap((w) => [w, w.replace(/[.,]+$/, "")]));
        for (const v of p.enum) assert.ok(words.has(String(v).toLowerCase()), `${e.path}: ${name} takes "${v}", which its description does not name`);
      }
      if ((p.type === "integer" || p.type === "number") && typeof p.example === "number") {
        // "1-48 (default 12)", "500 to 20000", "1-20": the first range the text states.
        const range = /(?<![\w.-])(-?\d[\d,]*(?:\.\d+)?)\s?(?:-|to)\s?(\d[\d,]*(?:\.\d+)?)(?![\w-])/.exec(p.description);
        if (!range) continue;
        const lo = Number(range[1].replaceAll(",", "")), hi = Number(range[2].replaceAll(",", ""));
        if (!(lo < hi)) continue;
        ranges++;
        assert.ok(p.example >= lo && p.example <= hi, `${e.path}: ${name} example ${p.example} is outside the ${lo}-${hi} its description states`);
      }
    }
  }
  assert.ok(enums >= 40 && ranges >= 100, `checked ${enums} enum inputs and ${ranges} ranged inputs`);
});

test("a tool with an exact output schema publishes an example the schema covers, and the example has every required field", () => {
  const exact = m.ENDPOINTS.filter((e) => e.outputSchema);
  assert.ok(exact.length >= 3, `tools with an exact output schema: ${exact.length}`);
  for (const e of exact) {
    const properties = Object.keys(e.outputSchema.properties ?? {});
    assert.deepEqual(Object.keys(e.outputExample).filter((k) => !properties.includes(k)), [], `${e.path}: example fields the schema does not document`);
    assert.deepEqual((e.outputSchema.required ?? []).filter((k) => !Object.hasOwn(e.outputExample, k)), [], `${e.path}: required fields the example lacks`);
  }
});

// ---- Token tickers, per network ----

const TOKEN_TOOL = /^\/([a-z]+)\/(token-balance|token-info|allowance|token-transfers)$/;

test("a per-network token tool names only tickers that resolve on its network", () => {
  const slugs = new Set([...m.CHAINS, ...m.EXTRA_CHAINS].map((c) => c.slug));
  assert.equal(slugs.size, 18);
  // Every ticker any network's table holds: a listing that names one of them promises it resolves there.
  const universe = [...new Set(Object.values(m.TICKERS).flatMap((table) => Object.keys(table)))];
  assert.ok(universe.includes("USDT") && universe.includes("WETH") && universe.includes("DAI"));
  let named = 0, tools = 0;
  for (const e of m.ENDPOINTS) {
    const hit = TOKEN_TOOL.exec(e.path);
    if (!hit || !slugs.has(hit[1])) continue;
    tools++;
    const slug = hit[1];
    const text = `${e.summary} ${e.description} ${e.params.token.description}`;
    for (const ticker of universe) {
      if (!new RegExp(`(?<![A-Za-z0-9.])${ticker}(?![A-Za-z0-9.])`).test(text)) continue;
      named++;
      // USDC resolves on every network: from the table, or from the per-network USDC table where there is no table.
      const resolves = ticker === "USDC" ? Boolean(m.USDC[slug]) : m.knowsTicker(ticker, slug);
      assert.ok(resolves, `${e.path} names ${ticker}, which is not in the ticker table of ${slug}`);
    }
    // The token example is an address (it works whatever the table holds).
    assert.match(String(e.params.token.example), /^0x[0-9a-fA-F]{40}$/, `${e.path} token example`);
  }
  assert.ok(tools >= 60 && named >= 150, `checked ${tools} token tools, ${named} named tickers`);
  // The rule has teeth: a network with no table is offered USDC alone, and a table's tickers are offered.
  assert.deepEqual(m.listedTickers("zksync", ["USDT", "WETH", "DAI"]), ["USDC"]);
  assert.equal(m.tickerClause("hyperevm", ["USDT", "WETH"]), "the ticker USDC");
  assert.deepEqual(m.listedTickers("base", ["USDT", "WETH", "DAI"]), ["USDC", "USDT", "WETH", "DAI"]);
});

test("the ticker table holds checksummed addresses and the same USDC contract the per-network tools use", () => {
  const { getAddress } = require("viem");
  const slugs = new Set([...m.CHAINS, ...m.EXTRA_CHAINS].map((c) => c.slug));
  for (const [slug, table] of Object.entries(m.TICKERS)) {
    assert.ok(slugs.has(slug), `ticker table for ${slug}, which is not a network of the chain tools`);
    for (const [ticker, address] of Object.entries(table)) {
      assert.equal(ticker, ticker.toUpperCase(), `${slug} ${ticker}: keys are upper case (inputs are upper-cased before the lookup)`);
      assert.equal(getAddress(address), address, `${slug} ${ticker}: not an EIP-55 checksummed address`);
    }
    // token=USDC answered from the USDC table before a network had a ticker table; it must stay the same contract.
    assert.equal(table.USDC, m.USDC[slug], `${slug}: USDC in the ticker table differs from the USDC table`);
  }
  // One address is one token on a network (a copy-paste slip would give two tickers the same contract).
  for (const [slug, table] of Object.entries(m.TICKERS)) {
    const seen = new Map();
    for (const [ticker, address] of Object.entries(table)) {
      assert.ok(!seen.has(address.toLowerCase()), `${slug}: ${ticker} and ${seen.get(address.toLowerCase())} share ${address}`);
      seen.set(address.toLowerCase(), ticker);
    }
  }
});

// ---- Figures a description states, against the constant that decides them ----

test("descriptions that state the size of a table state the table's size", () => {
  // /tech/stack said "About 110 public fingerprints" over a table of 93.
  const tech = /About (\d+) public fingerprints/.exec(byPath["/tech/stack"].description);
  assert.ok(tech, "/tech/stack states its fingerprint count");
  assert.equal(Number(tech[1]), Math.floor(m.TECH_RULES.length / 10) * 10, `/tech/stack: ${m.TECH_RULES.length} rules`);
  // The speech tools: languages and voice counts.
  for (const p of ["/ai/speech", "/text-to-speech"]) {
    const e = byPath[p];
    assert.deepEqual(e.params.lang.enum, [...m.SPEECH_LANGS], `${p} lang enum`);
    assert.ok(e.description.includes(`English (${m.SPEECH_VOICES.en.length} voices) or Spanish (${m.SPEECH_VOICES.es.length} voices)`), `${p} voice counts`);
    for (const voice of [...m.SPEECH_VOICES.en, ...m.SPEECH_VOICES.es]) assert.ok(e.params.voice.description.includes(voice), `${p} does not name the voice ${voice}`);
  }
  // /ai/moderation: "14 in all".
  const guard = /(\d+) in all/.exec(byPath["/ai/moderation"].description);
  assert.equal(Number(guard[1]), Object.keys(m.GUARD_CATEGORIES).length, "/ai/moderation category count");
});

// ---- Hand-written manifests and guides (no script writes these) ----

test("hand-written manifests and integration guides state the catalogue's tool count and lowest price", () => {
  const files = ["gemini-extension.json", ".claude-plugin/marketplace.json", "claude-plugin/.claude-plugin/plugin.json", "integrations/n8n/README.md", "integrations/n8n/package.json",
    "integrations/openclaw/skill/agent-data-tools/SKILL.md", "integrations/openclaw/bundle/skills/agent-data-tools/SKILL.md", "clients/agent-data-tools/README.md"];
  let counts = 0;
  for (const file of files) {
    const text = read(file);
    // "670+ pay-per-call ... tools", "More than 670 tools", "about 670 tools": a round figure at or just under the count.
    for (const match of text.matchAll(/(?:(\d{3})\+ pay-per-call|More than (\d{3}) tools|\(about (\d{3}) tools\))/g)) {
      const n = Number(match[1] ?? match[2] ?? match[3]);
      counts++;
      assert.ok(n <= m.TOOL_COUNT && n > m.TOOL_COUNT - 20, `${file}: "${match[0]}" beside a catalogue of ${m.TOOL_COUNT} tools`);
    }
    // "and 650+ more", "about 650 more": never more than the catalogue holds.
    for (const match of text.matchAll(/(?:and|about) (\d{3})\+? more/g)) { counts++; assert.ok(Number(match[1]) < m.TOOL_COUNT, `${file}: "${match[0]}" beside a catalogue of ${m.TOOL_COUNT} tools`); }
    for (const match of text.matchAll(/fixed price, from (\$\d+(?:\.\d+)?)/g)) assert.equal(match[1], m.LOWEST_PRICE, `${file}: ${match[0]}`);
  }
  assert.ok(counts >= 8, `figures checked: ${counts}`);
});

test("the chain-check guide and the chain client state each operation's catalogue price, and the client's cap allows it", () => {
  const guide = read("docs/chain-checks.md");
  const core = read("clients/chain/core.mjs");
  const help = /Every buy also requires --max-usdc: ([^.]*(?:\.\d+[^.]*)*)\. Quotes/.exec(core)[1];
  let rows = 0;
  for (const row of guide.matchAll(/^\| `([a-z]+)` \| `(\/[a-z0-9/-]+)` \| [^|]* \| \$(\d+(?:\.\d+)?) \|$/gm)) {
    rows++;
    const [, op, toolPath, stated] = row;
    const price = usd(byPath[toolPath].price);
    assert.equal(Number(stated), price, `docs/chain-checks.md: ${op} is ${toolPath} at ${byPath[toolPath].price}`);
    // The cap the client accepts for this operation (atomic USDC, six decimals) is at least the price.
    const cap = new RegExp(`${op}: \\{ path: "${toolPath}", maxAtomic: (\\d+)n`).exec(core);
    assert.ok(cap, `clients/chain/core.mjs has the operation ${op}`);
    assert.ok(Number(cap[1]) / 1e6 >= price, `chain client caps ${op} at ${Number(cap[1]) / 1e6}, under the price ${price}`);
    // Every documented buy of this operation passes a cap that covers the price and that the client accepts.
    for (const buy of guide.matchAll(new RegExp(`buy ${op}\\b[^\\n]*--max-usdc (\\d+(?:\\.\\d+)?)`, "g"))) {
      assert.ok(Number(buy[1]) >= price, `docs/chain-checks.md: "buy ${op} --max-usdc ${buy[1]}" is under the price ${price}`);
      assert.ok(Number(buy[1]) <= Number(cap[1]) / 1e6, `docs/chain-checks.md: "buy ${op} --max-usdc ${buy[1]}" is over the client's cap`);
    }
    assert.ok(new RegExp(`${op}(?:/[a-z]+)* <=${Number(cap[1]) / 1e6}(?![\\d.])`).test(help) || new RegExp(`[a-z]+/${op} <=${Number(cap[1]) / 1e6}(?![\\d.])`).test(help), `chain client help states the ${op} cap ${Number(cap[1]) / 1e6}: ${help}`);
  }
  assert.equal(rows, 4);
  assert.ok(read("README.md").includes(`a wallet snapshot **${byPath["/wallet"].price}**`), "README states the wallet snapshot price");
});

test("a network a chain input names is a network the chain tools have", () => {
  // Words that name a network, wherever a chain or network input lists its values.
  const known = new Set([...m.CHAINS, ...m.EXTRA_CHAINS].flatMap((c) => [c.slug, c.name.toLowerCase()]));
  for (const extra of ["ethereum", "arbitrum", "optimism", "solana", "tempo", "bitcoin"]) known.add(extra);
  // Networks the service does not read: a listing that offers one of these as a value promises a network no handler has.
  const absent = ["bsc", "bnb", "binance", "blast", "fantom", "tron", "ton", "aptos", "sui", "near", "cosmos", "starknet", "moonbeam", "cronos", "kava", "metis", "taiko", "zora", "mode", "worldchain", "abstract", "monad", "plasma"];
  let checked = 0;
  for (const e of m.ENDPOINTS) {
    for (const [name, p] of Object.entries(e.params)) {
      if (!/^(chain|chains|network|networks)$/.test(name)) continue;
      // LI.FI tools (bridge and swap quotes) take LI.FI's own chain list, which is read live from LI.FI.
      // So do the tools that read DefiLlama's files, which carry every chain DefiLlama tracks.
      if (/^\/(bridge|swap|lifi)\//.test(e.path) || /LI\.FI|DefiLlama/i.test(e.description)) continue;
      checked++;
      const words = p.description.toLowerCase().split(/[^a-z0-9]+/);
      for (const w of words) assert.ok(!absent.includes(w), `${e.path}: ${name} names ${w}, a network no chain tool reads`);
      if (p.enum) for (const v of p.enum) assert.ok(known.has(String(v).toLowerCase()), `${e.path}: ${name} enum value ${v} is not a network of the chain tools`);
    }
  }
  assert.ok(checked >= 20, `chain inputs checked: ${checked}`);
});
