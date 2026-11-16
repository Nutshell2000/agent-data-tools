# Search plumbing: IndexNow, true sitemap lastmod, WebApplication data (16 Nov 2026)

Branch `cloud/20261116-search-plumbing`. Written in a cloud container whose clone is **shallow** (50 commits), with no
PowerShell. Nothing was pushed, deployed or submitted to anyone.

## 1. IndexNow

Existed: `INDEXNOW_KEY` and the `/<key>.txt` route (src/index.ts), `scripts/indexnow.mjs` (every sitemap URL of the
workers.dev origin AND of `PUBLIC_SITE_ORIGIN`, one POST each, no batching, success = 200/202), called by the train.

Changed in `scripts/indexnow.mjs` (pure parts exported: `parseSitemap`, `selectUrls`, `batches`, `payload`, `verdict`,
`sinceDay`, `parseArgs`, `defaultOrigin`, `main`):
- With no origin it submits ONE host, the public site from wrangler.jsonc (https://glyphcall.com). The workers.dev
  copies are no longer submitted: they are duplicates whose canonical is the public site. An origin given by hand
  still works as before.
- Only https URLs on exactly the submitted host go out, each once; `host` and `keyLocation` are that host's.
- Batches of at most 10,000 URLs.
- 200 and 202 are success. 400, 403, 422 and 429 fail the run with the reason printed and are not retried. A 5xx or
  network error is tried once more after 5 s.
- `--dry` GETs the key file and the sitemap and prints the host, keyLocation and every URL it would send.
- `--changed-since <git ref | ISO date>`: only pages whose sitemap `<lastmod>` is on or after that day (a git ref
  means its commit day in UTC). lastmod is a day, so the day itself counts: several releases on one day resubmit
  that day's changed pages. A page without lastmod is left out. If the sitemap has no lastmod at all, everything is
  submitted as before and the output says so. An unknown ref or a bad date stops the run with nothing sent.
- The key file answers 200 on glyphcall.com, the workers.dev host, tools.funwords.eu and www.glyphcall.com
  (tests/search-jsonld.test.cjs, Host set in Miniflare). A retired host's `/sitemap.xml` is a 301 to the public
  site, so there is nothing to submit for a retired host from its own sitemap.

Checked by running it: `node scripts/indexnow.mjs --dry` once against the live site (two plain GETs): key file served
on glyphcall.com, 980 URLs in the sitemap, all 980 on glyphcall.com, one batch. Nothing was posted. The live sitemap
has no lastmod yet.

Tests: `scripts/indexnow.test.mjs` (11 tests; the last one runs `main` against a stand-in `fetch`).

## 2. True lastmod in the sitemap

Existed: no `<lastmod>` anywhere (`sitemapXml` in src/discovery.ts, `withEinvoicePages` in src/lib/einvoice-pages.ts;
there is no sitemap index).

Added:
- `src/lib/page-lastmod.ts` (`lastmodOf`, `lastmodTag`): a page gets `<lastmod>YYYY-MM-DD</lastmod>` only when
  `src/data/page-lastmod.generated.ts` has a valid day for it that is not after today (UTC). Both sitemap builders
  call `lastmodTag(path)`.
- `scripts/build-page-lastmod.mjs`: writes the generated file from git history. `--check` exits 1 when the file would
  change and writes nothing. `--base <ref>|none` (default `origin/main`). It **refuses a shallow clone**.
- **The committed generated file is empty** (`PAGE_LASTMOD = {}`): this container's clone is shallow, so no date
  from here would be trustworthy. Until the generator runs on a full clone the sitemap has no lastmod, as today.

How a date is made: the newest commit (committer date, UTC day) among the page's source files. Files this release
changes (uncommitted, or different from the merge base with `origin/main`) count as today, the day the page changes
for a reader. Merge commits do not count.

| Sitemap pages | Source files |
|---|---|
| `/` | src/lib/home-page.ts, src/lib/product-pages.ts |
| `/docs` | src/lib/site-pages.ts |
| product pages (`productPaths()`) | src/lib/product-pages.ts |
| `/compare`, `/compare/<rival>` | src/lib/compare-pages.ts (voice ones: src/lib/voice-compare.ts) |
| `/benchmarks` | src/lib/benchmarks-page.ts |
| `/vat-number-check*` | src/lib/vat-pages.ts |
| `/company-register*` | src/lib/register-pages.ts |
| `/tools` | src/lib/tool-pages.ts, src/endpoints.ts, src/families.ts |
| `/tools/<slug>` | the route file(s) that export the tool (core tools: src/endpoints.ts + src/tools.ts), src/lib/tool-pages.ts, and src/lib/tool-seo.ts when the tool has a `TOOL_SEO` entry |
| `/guides`, `/guides/<task guide>` | src/guides/task-guides.ts |
| `/guides/web-reading`, `/guides/bitcoin-fees` | src/guides/tool-buying.ts (+ reader-buying.ts for web-reading) |
| `/guides/dependency-audit`, `sitemap`, `local-mcp`, `ai-sdk` | the guide's own file in src/guides/ |
| `/skills/spellzcode-x402-reader/SKILL.md` | src/guides/reader-skill.ts |
| `/examples/extract/` | scripts/build-reader-assets.mjs, examples/reader-samples.mjs |
| `/e-invoice*` | src/lib/einvoice-pages.ts, src/lib/einvoice/validate.ts |
| `/de/e-rechnung*` | src/lib/einvoice-pages-de.ts, src/lib/einvoice/rules-de.ts, src/lib/einvoice/validate.ts |

Honesty limits:
- Coarse: one file renders many pages, so a page's date can be later than its own last visible change (a change to
  tool-pages.ts dates every tool page; this branch's one-line sitemap edit in einvoice-pages.ts dates the English
  e-invoice pages once). It is never later than the day of generation and never in the future.
- Not followed: prices and plan sizes (credits.ts, key-prices.ts), the footer (legal.ts), shared styles, the try
  form. A change there alone moves no date. Following them would give every page one date at each release.
- Live results on a page never move its date.
- A date is the day of the commit or of the generation, not of the deploy; they can differ by a day.

Tests: `scripts/build-page-lastmod.test.mjs` (6 tests): every sitemap URL resolves to a rule whose files exist;
every lastmod in the real sitemap is a valid day not after today; committed days are not all identical (holds
trivially while the file is empty, and is proven on fixtures); the date arithmetic on fixtures; git reading and the
shallow refusal on throwaway repositories. None depends on this repository's history depth, so they run in CI.
`--check` is NOT in `npm test` (CI is depth 1); it belongs to the release step.

Inferred, not run: the generator's `main` on a full clone (it refuses here). Its parts were run on this shallow clone
with the guard bypassed in a scratch call: 980 pages, every one mapped, three different days.

## 3. WebApplication and FAQPage data

- New `src/lib/app-jsonld.ts` (`webApplicationLd`, `webApplicationScript`, `ldJson`, `offerPrice`). One
  `<script type="application/ld+json" data-ld="app">` line added to the head of the front page
  (src/lib/home-page.ts) and of every product page (src/lib/product-pages.ts).
- `WebApplication` (the schema.org subtype of SoftwareApplication for software used in a browser; Google's
  software-app guidance accepts it), `applicationCategory` "DeveloperApplication", `operatingSystem` "Any", `name`,
  `url`, `description` (the page's own meta description), `offers` (the plan and pack prices the page shows, from
  `productOffers`; USD; without card payments a product page publishes its per-call price and the front page no
  offers), `provider` and `publisher` Organization "SpellzCode" with Brand = the page's brand (Glyphcall).
- No `aggregateRating`, no `review`: there are none. Google shows the software-app rich result only with one of
  them, so these pages are **not eligible for that result**; the Rich Results Test will say so. Do not add ratings.
- `withPublicCanonical` (src/lib/public-site.ts) now also points the URLs inside that one marked block at
  `PUBLIC_SITE_ORIGIN`, so the data names the same address as the canonical tag on every host.
- Escaping: `ldJson` escapes `<`, `>`, `&`, U+2028/2029.
- Not added: the free browser tools (voice.glyphcall.com, studio.glyphcall.com) are not served by this Worker.
- FAQ audit (55 pages across every family, run through Miniflare): every page that shows questions and answers
  already carries FAQPage data with exactly the visible text, and no page carries FAQ data for text it does not
  show. `/docs`, `/credits`, `/tools`, `/guides`, `/about`, `/compare` have no question-and-answer section; the
  question-shaped headings on `/benchmarks` are titles of result tables. So no FAQ data was added or removed; the
  test now pins the rule.

Tests: `tests/search-jsonld.test.cjs` (7 tests).

## scripts/release.ps1 (three small edits, NOT run: no PowerShell here)

- After `Step 'bump'`: `Step 'page-lastmod' { node scripts/build-page-lastmod.mjs } 'page-lastmod' -Optional`.
- `$Regenerated` also lists `src/data/page-lastmod.generated.ts` (a merge conflict in it takes main's; the step
  rebuilds it).
- `Step 'indexnow' { node scripts/indexnow.mjs --changed-since 'origin/main~1' } 'IndexNow' -Optional`.

Read these three lines before the next train run. If the `page-lastmod` step warns (shallow clone, error), the old
dates ship and the changed-only IndexNow step will miss the pages that release changed: rerun by hand as below.

## What the owner or the train runs

Before a release, on a full clone (the train's `page-lastmod` step does it):

    node scripts/build-page-lastmod.mjs
    node scripts/build-page-lastmod.mjs --check     # exit 1 = stale

After a deploy:

    node scripts/indexnow.mjs --dry                               # prints what would be sent
    node scripts/indexnow.mjs --changed-since origin/main~1       # what the train runs
    node scripts/indexnow.mjs --changed-since 2026-11-16          # by hand, after a failed run
    node scripts/indexnow.mjs                                     # every page of glyphcall.com

Once, after the first deploy with dates: open https://glyphcall.com/sitemap.xml, check that lastmod is there and
differs between pages, and resubmit the sitemap in Search Console and Bing Webmaster Tools.

After the deploy, validate the structured data (owner's step): paste https://glyphcall.com/ and one product page
(for example https://glyphcall.com/pdf-to-text-api) into https://search.google.com/test/rich-results and
https://validator.schema.org/. Expected: valid JSON-LD with WebApplication and FAQPage items and no errors in the
schema.org validator; the Rich Results Test reports the missing rating for "Software App" (expected, see above).

## Skipped

- Real lastmod dates (shallow clone). The full `npm test` was not completed here (budget); the lead agent runs it.
- A one-time IndexNow run for the old hosts after their pages redirect (`node scripts/indexnow.mjs <old origin>`)
  is possible only for workers.dev, whose sitemap is still its own; decide after the redirect work is merged.
