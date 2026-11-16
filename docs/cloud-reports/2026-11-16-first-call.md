# First call without a key: short llms.txt and root JSON, 402 that opens with what to do (16 Nov 2026)

Branch `cloud/20261116-first-call`. No version bump, no tool or description change (the MCP contract baseline is untouched).

## Why

The top of the funnel is empty: newcomers read a very long llms.txt and a large root JSON, meet a 402 whose useful part
comes after the payment terms, and leave. The service already gives `FREE_HTTP_CALLS_PER_CALLER` (3) keyless calls over
HTTP with `trial=1` and `FREE_CALLS_PER_CALLER` (25) over MCP; nothing a newcomer reads first said so first.

## What changed

- **`src/lib/first-call.ts` (new).** One place for the first-call copy, all computed from the catalog and constants:
  - `FIRST_CALL_PATH` = `/validate/iban` and `firstCall(origin)`: the tool's published example request with `trial=1`
    and its published `outputExample`. The tool computes locally (no outside source, no clock), so the printed answer
    is the answer a caller gets; `tests/first-call.test.cjs` runs the printed URL in Miniflare and compares.
  - `featuredTools()`: twelve tools from a hand-picked order (`FEATURED`), filtered at run time to those in
    `SALES_FIRST` (new accessor `salesFirstPaths()` in `src/lib/discovery-index.ts`) and in the HTTP free trial
    (`httpFree`). Path, example query, price and summary come from the catalog.
  - `llmsShortTxt(origin, facts)`: the new `/llms.txt`. Order: what the service is, the keyless first call with its
    answer and the honest limits, how to pay (card credits, free key by e-mail only while `freeKeysOn`, x402, MPP only
    while a method is on, USDC prepaid), twelve tools, MCP in two lines, links. With free calls off it says so and
    offers `sample=1` instead of a trial curl.
  - `rootCard(origin, facts)`: the new `GET /` for programs. `SERVICE_CARD_PATH` = `/service-card.json`.
- **`src/index.ts`.** `/llms.txt` serves `llmsShortTxt`; `/llms-full.txt` (already a route) keeps serving the whole
  former file (`llmsTxt` in `src/discovery.ts`, unchanged except that its "Service card" link now points at
  `/service-card.json`). `GET /` for a non-browser serves `rootCard`; the former body (`serviceCard`) is at
  `/service-card.json`. Browsers keep the HTML page. `firstCallFacts(env)` gathers brand, trials, free keys and rails.
- **`src/lib/readable-402.ts` (`readable402`).** The body now starts with `hint`, `freeTrial`, `payByCard`, `prepay`,
  then the x402 fields in the header's own order, then `related`, `withKey`. `freeTrial` (`{ what, url }`) is present
  only when the existing `freeCalls` flag is true (the tool is in the HTTP trial, trials are on, and this caller has not
  used them up); its `url` is the refused request with `trial=1` (control parameters `x402`/`sample` dropped), or the
  tool's published example when the request carried no input. `payByCard` is `{ credits, smallestPack?, use }`;
  `smallestPack` (`price`, `credits`, `buy`) only while card payments can issue keys, as `cardHint` already did.
  The v1-shaped body (`x402=1` / `QUOTE_BODY=v1`) opens the same way. Nothing about the x402 fields or the
  `PAYMENT-REQUIRED` header changed; the new test compares the body's x402 fields with the decoded header as strings.
- **Typo.** "pay with X-PAYMENT.No wallet?" is now "pay with X-PAYMENT. No wallet?" (the only place the two strings
  were joined; nothing under `public/clients/` was touched).
- **Hero (`src/lib/home-page.ts` `landingPage`).** New fourth argument `opts: { trial?, freeKey? }`. With `trial` the
  first hero tab ("Try it now", checked by default) is `curl "<origin>/validate/iban?…&trial=1"` followed by the
  answer, and one line with the free-call number from the constant. The three key-based tabs follow. CSS gained the
  `#t4` selectors and `.pane pre.res`. No payment-protocol or wallet word was added above "For AI agents".
  The agent catalogue page (`homePage` in `src/discovery.ts`, `/agents`) opens with the same request and answer
  (`firstCallHtml`, one new line before "Get started").
- **Nav.** "Get a free key" → `/keys/free`, only while `freeKeysOn(env)`: the front page (`.nav-cta`), the docs page
  (`top(brand, freeKey)` in `src/lib/site-pages.ts`, `docsPage(brand, origin, freeKey)`), and the product pages' crumb
  line (`productPage`, under its existing `freeKey` flag, which is also false for products whose tool a free key does
  not cover).
- **News opt-in on `/keys/free` (`src/lib/free-keys.ts`).** The form has an unticked checkbox `updates` ("E-mail me
  about new tools and price changes (optional, at most monthly)"); JSON callers may send `"updates": true`.
  When ticked, the sign-up record (`freekey:pending:<token hash>`, 24 h) carries the address encrypted with AES-GCM
  under a key derived from the link's token, which exists only in the message. When the link is opened and the key is
  issued, the address is decrypted and stored at `freekey:optin:<address hash>` in the same KV (`TRIALS`) as
  `{ email, consentAt, confirmedAt }`; an existing record is kept. Unticked: nothing new is stored. Ticked but never
  opened: no readable address exists anywhere and the record expires with the link. No mail is sent to these
  addresses by this change; the confirmation message gains two lines when the box was ticked. The privacy page
  (`src/lib/legal.ts`) and the line under the form say exactly this, and that removal is by writing to the support
  address.
- **Scripts.** `scripts/check-live-readiness.mjs` and `scripts/seed-bazaar.mjs` read every tool from the root JSON;
  both now fetch `/service-card.json`. They fail before doing anything if run against a deployment older than this one.

## Measured (Miniflare, origin `https://api.test`, free keys off, MPP off)

- `/llms.txt`: 5,236 bytes (limit in the test: 8,192). With the production origin, free keys and both MPP methods on,
  the same function gives 6.5 KB.
- `GET /` as JSON: 1,668 bytes (limit 4,096); about 2.4 KB with the production origin and every option on.
- A `/weather?city=Stockholm` 402 body: keys `hint, freeTrial, payByCard, prepay, x402Version, error, resource,
  accepts, extensions, related`; the first four are 1,466 of 5,999 characters.

## Tests

- `tests/first-call.test.cjs` (new, 8 tests): sizes and order of `/llms.txt`; twelve featured tools with catalog
  prices, all in the free trial and in `SALES_FIRST`; `/llms-full.txt` equals `llmsTxt(...)` and still describes every
  tool; root JSON under 4 KB, both for `Accept: application/json` and for a plain non-browser client, every own link
  in it answers 200, `/service-card.json` lists every tool; the first four 402 keys for a trial tool, the v1 body, a
  request without input; no `freeTrial` for `/search`, `/pdf/text`, or a caller who used the free calls; the hero's
  first example run for real; the nav link on and off.
- `tests/free-keys.test.cjs` (+2): unticked → the whole address is nowhere in KV or the ledger; ticked and unconfirmed →
  the same; ticked and confirmed → stored with the consent time; the privacy text.
- Assertions moved, none deleted: `tests/reader-assets.test.cjs` reads `docs.buyerSkill` from `/service-card.json` and
  the skill / local-MCP mentions from `/llms-full.txt` (and checks the short files link the long ones);
  `tests/task-guides.test.cjs` reads the guide list and the credit prices from `/llms-full.txt`.

## For the owner / release train

- After the deploy: `curl -H 'accept: application/json' <origin>/` (short), `<origin>/service-card.json` (full),
  `<origin>/llms.txt` and `/llms-full.txt`, one unpaid tool call to see the body order, then the printed hero curl on
  glyphcall.com. Run `npm run check:live` only after the deploy (it needs `/service-card.json`).
- Anything outside this repo that reads `endpoints`, `payment` or `docs` from the root JSON must read
  `/service-card.json` instead. The short card keeps `name`, `description`, and `pay.x402.{protocol,network,networks,payTo}`.
  Directory listings that were registered with the root URL as "service card" still get valid JSON with a link.
- The branch `mcp-surface` changes what `/mcp` lists. The short llms.txt already describes `/mcp` as "small: a finder
  plus popular tools"; if that branch is not released together with this one, that phrase is ahead of the code.
- The news opt-in only records consent. Before any message is sent to those addresses a sender, an unsubscribe link
  in each message and a removal routine (`freekey:optin:<hash>` delete) are needed; none of that is built here.
- No secrets, bindings or dashboard steps.

## Not done, and why

- Comparison, benchmark, VAT and register pages have a crumb line, not the nav; they did not get the link (comparison
  pages already carry a free-key button).
- The front-page hero shows the trial tab only when free calls are on (`TRIALS_ENABLED`), since the curl would
  otherwise answer 402.
- `/e` beacon, utm handling and tool counts belong to other branches and were left alone; the new copy states no
  tool count.
