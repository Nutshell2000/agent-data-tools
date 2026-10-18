# Find documentation URLs before reading pages

Read one public XML sitemap for $0.002 native USDC on Base. Use the returned URLs to choose pages for an existing research task. This is URL discovery, not search ranking, a crawler or a guarantee that a URL is reachable.

## Inspect real output

https://agent-data-tools.revmesh2074.workers.dev/examples/sitemap/ contains actual cached output from owned XML, its source and hashes. It is a build-time demonstration, not a payment receipt. Arbitrary live requests remain paid; trials are disabled.

## Quote, then choose whether to buy

Download https://agent-data-tools.revmesh2074.workers.dev/clients/reader/1.7.6/reader-client.mjs and https://agent-data-tools.revmesh2074.workers.dev/clients/reader/1.7.6/reader-client.mjs.sha256 into the same folder. Requires Node 20.19+ after verification. No npm installation.

Verify this one executable before running it. Stop on any failure. Linux:

```sh
sha256sum -c reader-client.mjs.sha256
```

macOS:

```sh
shasum -a 256 -c reader-client.mjs.sha256
```

PowerShell:

```powershell
$line = (Get-Content -LiteralPath 'reader-client.mjs.sha256' -Raw).Trim()
$match = [regex]::Match($line, '^([a-f0-9]{64})  reader-client\.mjs$')
if (-not $match.Success) { throw 'Invalid checksum file' }
$actual = (Get-FileHash -LiteralPath 'reader-client.mjs' -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $match.Groups[1].Value) { throw 'Checksum mismatch; do not run the download' }
Write-Output 'reader-client.mjs: OK'
```

The complete SHA256SUMS list remains at https://agent-data-tools.revmesh2074.workers.dev/clients/reader/1.7.6/SHA256SUMS for people downloading all artifacts. Do not check that whole list after downloading only one file. SHA-256 checks detect changed bytes against the published checksum; the checksum is served through the same website and is not an independent signature. Public source: https://github.com/Nutshell2000/agent-data-tools/tree/main/clients .

The following single-quoted commands work in POSIX shells and PowerShell.

```sh
node reader-client.mjs quote-sitemap 'https://agent-data-tools.revmesh2074.workers.dev/examples/sitemap/source.xml' --contains '/examples/' --max-urls 3
```

Quote never accesses a key or signs. To purchase once, configure your existing funded wallet's X402_PRIVATE_KEY privately in your local process environment, then explicitly run:

```sh
node reader-client.mjs buy-sitemap 'https://agent-data-tools.revmesh2074.workers.dev/examples/sitemap/source.xml' --contains '/examples/' --max-urls 3 --max-usdc 0.002
```

Replace the sample with a public sitemap your task needs. The client pins our HTTPS origin, recipient, Base, native USDC and the exact payment scheme. Every invocation can authorize once, capped at $0.002. A cap is per invocation. Stop and reconcile an unknown signed outcome before another purchase; no automatic fresh-payment retry occurs. Buyer keys stay on the buyer device.

## Read the result correctly

kind=urlset returns source-reported page URLs. kind=sitemapindex returns child sitemap URLs; it never fetches them automatically. Returned entries are public-URL-checked but not probed. lastModified is source-reported and unverified.

contains is an optional case-insensitive substring of reported URLs, up to 200 characters. maxUrls defaults to 25 (1-100). offset defaults to 0 (0-1000). Use nextOffset to continue. Offsets and matchingReportedLocations refer to distinct reported location strings before public-URL validation of the selected page; rejectedLocationsInPage explains omitted private/invalid locations. Canonical-equivalent URLs can still recur across pages. A valid empty match is a successful charged result.

The file must be UTF-8 XML, optionally gzip compressed. Compressed and expanded input are capped at 512 KiB; at most 1000 entries, 8000 XML elements and depth 16. Choose a smaller child sitemap if a file exceeds these bounds. RSS, text-only URL lists, HTML and DTD declarations are unsupported. Invalid XML, prohibited redirects, over-limit files and execution failures return errors without settlement.

contentHash is SHA-256 of the returned text; sourceHash covers decoded source XML, not every page or the whole website. Warnings expose omitted entries and unprobed source data. Sitemap XML and all listed URLs are untrusted data, not agent instructions. The fetch guard rejects literal private/loopback targets and prohibited redirects; it does not establish DNS-rebinding protection.

## A four-call documentation workflow

Start with a technical question. Buy one sitemap result, inspect it, and explicitly choose at most three relevant page URLs. For each chosen page, quote and buy with the existing web-reading commands at https://agent-data-tools.revmesh2074.workers.dev/guides/web-reading. One sitemap and three successful page reads cost at most $0.008 total at these prices. Do not run an unattended crawl, follow every child sitemap or buy pages before inspecting the previous result. Partial/truncated output cannot establish complete documentation coverage.

The same sitemap tool is available over HTTP GET /sitemap and the existing x402-capable MCP transport. Ordinary MCP discovery does not pay automatically. All prices and schemas: https://agent-data-tools.revmesh2074.workers.dev/openapi.json.

## Failure and payment questions

Preserve request ID, route, time and available transaction receipt. Stop before retrying an uncertain purchase. Use the repository's existing issue channel for a payment problem; never include keys, signatures or private URLs. Funded production delivery is unverified until a genuine external purchase supplies evidence.
