# Cookieless measurement on Analytics Engine (cloud build, 16 Nov 2026; branch cloud/20261116-measurement)

Work item 3 of the sales plan. Why: Search Console shows almost no clicks, the funnel counters live in a Durable Object
with a write budget ("Durable Objects write budget" in CLAUDE.md), and a referrer header is not proof of a person. Nothing
here adds a Durable Object or KV write: every count is one non-blocking `writeDataPoint` to Workers Analytics Engine, and
all of it does nothing when the binding is missing. No release version was bumped. Nothing was deployed or pushed.

## What changed

- **Binding.** `analytics_engine_datasets: [{ binding: "ANALYTICS", dataset: "glyphcall_events" }]` in `wrangler.jsonc`;
  dataset `glyphcall_events_staging` in `wrangler.staging.jsonc`. Cloudflare creates a dataset at the first write after a
  deploy with the binding. The binding's type is declared in `src/lib/beacon.ts` (`dataset(env)`), not in `src/lib/env.ts`,
  so no other file knows it.
- **`src/lib/beacon.ts`** (new) and one hook in `src/index.ts`, `app.use(measurement(PAID_PATHS))`, placed after CORS and
  the HSTS middleware and before everything else:
  - `beacon()`: `GET /e?ev=<event>&p=<path>` (also `HEAD`, and `POST` because `navigator.sendBeacon` always posts; the
    body is never read). Always 204, `Cache-Control: no-store`, CORS `*` from the existing middleware, no cookie read or
    set. `ev` and `src` use `safeSource` from lib/funnel.ts (`^[a-z0-9_-]{1,40}$`); `p` goes through `safePath` (starts with
    `/`, query and fragment dropped, URL path characters only, at most 200; `/mcp/k/<key>` becomes `/mcp/k/:key`, `/p/<id>`
    becomes `/p/:id`). Anything invalid, and the two server event names (`SERVER_EVENTS`), is answered 204 and not written.
  - MCP: on a `POST` to any `/mcp…` route the hook reads at most 16 KB of a CLONE of the body (`boundedBody`; a larger
    declared body is not cloned at all), takes the client's software name with the existing `mcpClientName` (lib/caller.ts:
    lower case, `[a-z0-9._-]`, 32 characters, the same name `mcpConnections` counts), lets the request run, and writes
    `mcp_initialize` only if the server answered below 400. `mcpRoute()` stores the route without the key. `src/mcp.ts`
    and the `mcpConnections` counter are untouched.
  - AI crawlers: after a `GET`, `aiCrawlerName(user agent)` + `crawlerCounted()` decide; one `ai_crawler` point per read
    of a human page (`isHumanPage`), a catalog file (`isCatalogFile`: llms.txt, llms-full.txt, openapi.json, the
    .well-known files), `/sitemap.xml`, `/robots.txt`, or any other HTML answer below 400 (legal pages, e-invoice rules,
    comparisons…). Never a tool path, never `/mcp…`.
  - utm into Stripe: `utmReference()` + `withUtmOnStripeLinks()`. See "utm" below.
- **`src/lib/ai-crawlers.ts`** (new): `AI_CRAWLERS`, the one table of AI crawlers. `BOTS` in `src/routes/media-text.ts`
  (`/useragent/parse`) now spreads it in instead of holding its own copies, so there is one list. The parser's answers for
  crawlers it knew are unchanged (GPTBot, ChatGPT-User, OAI-SearchBot, ClaudeBot, PerplexityBot, Bytespider, CCBot,
  Applebot, "Meta crawler" for facebookexternalhit). Changed, on purpose: `meta-externalagent` now reads
  "Meta-ExternalAgent" (was "Meta crawler"), `anthropic-ai` reads "anthropic-ai (Anthropic)" (was "ClaudeBot (Anthropic)"),
  and about twenty crawlers that used to read "Other bot" or nothing have their names (Claude-User, Claude-SearchBot,
  Perplexity-User, GoogleOther, Google-Extended, Google-CloudVertexBot, Applebot-Extended, Amazonbot, Meta-ExternalFetcher,
  FacebookBot, DuckAssistBot, MistralAI-User, cohere-ai, Diffbot, YouBot, AI2Bot, Timpibot, ImagesiftBot, Omgilibot). The
  tool's description and example are unchanged, so the MCP contract baseline is unchanged.
- **`src/lib/legal.ts`**: one new item on /privacy, "Visit counts without cookies", saying what is counted, that there is
  no cookie, identifier or address in it, and that a campaign tag is passed to the Stripe link.
- **`scripts/analytics-queries.mjs`** (new): prints the SQL and the curl command. It reads no token and no environment
  variable and makes no request.
- **`tests/measurement.test.cjs`** (new, 14 tests).

## Data point layout

Every point: `indexes: [event]`, `doubles: [1]`, `blob1 = event`. Count with `SUM(_sample_interval)`.

| Event | blob2 | blob3 | blob4 | blob5 | blob6 | blob7 |
|---|---|---|---|---|---|---|
| any beacon event (`page_view`, `signup_click`…) | path | referrer family | software family of the user agent | country | `src` or `utm_source` | site that sent it |
| `mcp_initialize` | route (`/mcp`, `/mcp/compact`, `/mcp/k/:key/chain`, `/mcp/account`…; `/mcp/other` if odd) | client software name (`unnamed` if none) | `open`, `key` or `account` | empty | `src` | host |
| `ai_crawler` | path (at most 120; `/other` if it holds odd characters) | crawler name (`GPTBot`, `Claude-User`…) | status class (`2xx`, `3xx`, `4xx`, `5xx`) | empty | empty | host |

- Referrer family: `referrerFamily` (lib/funnel.ts) applied to the page's own `document.referrer`, which the page sends as
  `r`. `r` empty is `direct`; `r` on one of our hosts is `internal`; no `r` at all is `unknown` (the request's own Referer
  header is the calling page, not where the visitor came from, so it is never used for this). The value of `r` is never stored.
- Software family: `callerFamily` (lib/caller.ts): `browser`, `curl`, `gptbot`… Read `beacon-by-software` first: a beacon
  whose software is not `browser` is automation.
- Country: `request.cf.country` when it is two characters, else empty.
- Site: the host of the calling page (Origin, else Referer header) when it is the request's host, the public site or one
  of their subdomains (`voice.glyphcall.com`); `other` for a foreign page; `unknown` when the browser sent neither header.
- Never stored: IP address, full user agent, full referrer, cookies, keys, any other query value. The test feeds all of
  them and asserts none reaches the binding.

## The snippet a page can add later (not added by this branch)

No page calls the beacon yet: other branches are editing the pages. Either line works on glyphcall.com and, because CORS
is open, on voice.glyphcall.com and the other Glyphcall sites (use the absolute URL there).

With script, which also sends where the visitor came from and the campaign tag:

```html
<script>(function(){try{var q=new URLSearchParams(location.search),s=q.get("utm_source")||q.get("src")||"";fetch("https://glyphcall.com/e?ev=page_view&p="+encodeURIComponent(location.pathname)+"&r="+encodeURIComponent(document.referrer)+"&src="+encodeURIComponent(s),{mode:"no-cors",keepalive:true,credentials:"omit"})}catch(e){}})()</script>
```

Without script (the front page has none by rule): an image. It counts the view and the software family, with referrer
family `unknown`; a page built with the request at hand can fill `&src=` itself.

```html
<img src="/e?ev=page_view&p=/credits" alt="" width="1" height="1" referrerpolicy="no-referrer">
```

A click: `navigator.sendBeacon("https://glyphcall.com/e?ev=buy_click&p="+encodeURIComponent(location.pathname))`.
Event names are free within `[a-z0-9_-]{1,40}`; `mcp_initialize` and `ai_crawler` are reserved. Why this is better than
the `page_view` funnel stage: that one counts a GET with a browser-like user agent, which fetchers send too; an image or
script beacon is only requested by something that renders the page.

## Reading it

The Worker cannot read its own dataset: the SQL API needs an account API token (Account Analytics: Read), which the
Worker does not hold, so no read route was added. `node scripts/analytics-queries.mjs` prints every query as a curl
command (`--sql` for the SQL alone, `--staging`, `--days N`, or a word to filter by name). The three asked for:

```sql
-- AI crawlers per UTC day, crawler and path
SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, blob3 AS crawler, blob2 AS path, blob4 AS status, SUM(_sample_interval) AS reads
FROM glyphcall_events WHERE index1 = 'ai_crawler' AND timestamp > NOW() - INTERVAL '30' DAY
GROUP BY day, crawler, path, status ORDER BY day DESC, reads DESC LIMIT 1000

-- Beacon events per UTC day
SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, index1 AS event, SUM(_sample_interval) AS events
FROM glyphcall_events WHERE index1 NOT IN ('mcp_initialize', 'ai_crawler') AND timestamp > NOW() - INTERVAL '30' DAY
GROUP BY day, event ORDER BY day DESC, events DESC

-- MCP client names per UTC day
SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, blob3 AS client, blob4 AS mode, blob6 AS src, SUM(_sample_interval) AS connections
FROM glyphcall_events WHERE index1 = 'mcp_initialize' AND timestamp > NOW() - INTERVAL '30' DAY
GROUP BY day, client, mode, src ORDER BY day DESC, connections DESC LIMIT 1000
```

```sh
curl -s "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/analytics_engine/sql" \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" --data "<one query>"
```

The syntax (`toStartOfInterval`, `SUM(_sample_interval)`, the endpoint) was checked against Cloudflare's documentation on
16 Nov 2026. The queries were NOT run: there is no token in the build session and the dataset does not exist before a deploy.

## utm into Stripe `client_reference_id`

- A page (GET, 200, HTML, not a tool path) opened with `utm_source` (or `src`; `utm_source` wins), and optionally
  `utm_medium` and `utm_campaign`, has every Stripe payment link on it that carries no query yet rewritten to
  `…?client_reference_id=utm_<source>[_<medium>[_<campaign>]]` (`utmReference`: each part lower case, `[a-z0-9-]`, at most
  40 characters, a missing medium before a campaign is `-`; at most 126 characters, inside Stripe's 200). It is done on the
  response in the hook, so it covers /credits, the product pages, /transcribe-pro and the front page without editing any
  of them, and it needs no binding.
- Top-up links are left alone: they already carry `?client_reference_id=topup_<sha256>` and the rewrite only touches a
  link that ends right after its id. A `utm_…` reference never matches `keyHashFromReference`, so the claim treats such a
  purchase exactly like one with no reference: a new key. `verifyCheckout` and the ledger were not touched.
- Never rewritten: JSON answers (so `/credits` as JSON for agents keeps bare links), tool quotes and 402 bodies, anything
  cached (the rewrite is applied to the one response, never stored).
- **Reading it:** a purchase's reference is not recorded on our side (the session record holds no reference), so
  `/revenue` cannot show it without a change to the money record; that was left out. The owner reads it in Stripe: the
  Checkout Session of a payment carries `client_reference_id` (API field; where the dashboard shows it was not checked
  from here).

## How it is tested

`node --test tests/measurement.test.cjs`: the real Worker in Miniflare behind a wrapper that hands it a fake binding and
serves what the binding received. It covers: the exact blobs of a beacon and that an IP address, the full user agent, the
full referrer, a session id, other query values and a cookie never reach it; HEAD, POST and the preflight; twelve invalid
beacons that write nothing; a key in a path replaced; no binding (beacon 204, crawler page 200, MCP initialize 200, nothing
thrown); `/e` absent from OpenAPI, llms.txt, the discovery index, the sitemap and `/metrics/callers`; a real MCP SDK client
on `/mcp?src=glama` that initializes and lists tools, with exactly one point for it and `mcpConnections` still counting;
a refused sign-in writing nothing; GPTBot on /llms.txt writing one point, a browser and a crawler on a tool path none;
22 crawler user agents named the same by the counter and by `/useragent/parse`; the reference format against Stripe's
character rule; the tag on every Stripe link of /credits; top-up links and `keyHashFromReference` unchanged;
`verifyCheckout` granting the same pack for seven different references; a claim end to end; the privacy text; both wrangler files.

## What the owner / release train must do

1. Deploy as usual; the binding needs no secret and no dashboard step in the documentation. Not verified from here: an
   account that has never used Analytics Engine may be asked to enable it once in the dashboard (Workers & Pages >
   Analytics Engine) when the deploy is refused for that reason. Staging first shows it.
2. After the deploy: `curl -i "<origin>/e?ev=deploy_check&p=/"` (204), then
   `node scripts/analytics-queries.mjs tables` and `beacon-events-by-day` with a token that has Account Analytics: Read.
   Points can take a minute or two to be queryable.
3. Add the snippet to the pages (and the voice site) once the page branches are merged. Until then only
   `mcp_initialize` and `ai_crawler` produce data.
4. Put `?src=<directory>` on the MCP URLs given to directories (`/mcp?src=glama`) and `?utm_source=` on links in posts
   and listings; that is what fills blob6 and the Stripe reference.
5. Retention: Analytics Engine keeps about three months (from memory of its documentation, not re-read): copy the
   per-day tables into the weekly sales baseline if a longer history is wanted.

## Decisions taken here

- Binding `ANALYTICS`, datasets `glyphcall_events` / `glyphcall_events_staging`; one dataset for all events, index = event.
- `POST /e` is accepted besides GET and HEAD, because `navigator.sendBeacon` cannot send a GET.
- The referrer family comes only from the `r` parameter the page sends, never from the beacon request's own Referer header.
- A `site` blob (our own host names only) was added so `/` on the voice site and on glyphcall.com can be told apart.
- MCP client names are cut by the existing `softwareName` (32 characters), not a new 60-character rule, so this count and
  `mcpConnections` agree on names.
- The crawler count includes every non-error HTML page, not a fixed list, so pages added by other branches are counted
  without touching this file.
- `/e` can be called by anyone, so events can be invented. It is a counter, not evidence: read software family and
  country beside it, and never count it as demand.

## Skipped, and why

- A read route: needs an account token the Worker does not have.
- The utm source on `/revenue`: the reference is not stored; adding it means changing `verifyCheckout`'s result, the
  session record and `creditSummary`. A smaller follow-up would be one `credits_claimed` data point (pack, utm source)
  written at the first claim; not done because it edits the claim path that other branches touch.
- Beacon calls in the pages themselves (by instruction).
- The Hermes package README's "What the service keeps" was not changed (the package is pinned and reviewed per commit).
  It does not name the per-day count of connecting client software, which existed before this branch as `mcpConnections`.
- `/credits` JSON links, the 402 page and MCP hints carry no utm: only a page a person opened with a tag does.
