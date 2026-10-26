import { SaxesParser, type SaxesTagNS } from "saxes";
import { HttpError } from "../lib/env";
import { capBytes, fetchPublic, parseTarget } from "../lib/fetch";

const NS = "http://www.sitemaps.org/schemas/sitemap/0.9";
// cloudflare.com declares the namespace with https (26 Oct 2026); same schema, so it is accepted too.
const NS_HTTPS = "https://www.sitemaps.org/schemas/sitemap/0.9";
const LIMIT = 512 * 1024;
const BAD_XML = () =>
  new HttpError(422, "Invalid or unsupported sitemap XML", "SITEMAP_INVALID");
export interface SitemapEntry {
  url: string;
  lastModified: string | null;
}

/** One bounded XML document, no child fetching and no external entity expansion. */
export function parseSitemap(source: string) {
  const parser = new SaxesParser({ xmlns: true });
  const stack: (string | null)[] = [],
    locations: { location: string; lastModified: string | null }[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  let kind: "urlset" | "sitemapindex" | undefined,
    rootUri = "",
    nodes = 0;
  let current: { loc: string; lastmod: string; hasLoc: boolean } | undefined;
  let reportedEntries = 0,
    rejectedEntries = 0,
    duplicateEntries = 0;
  const core = (tag: SaxesTagNS) => (tag.uri === rootUri ? tag.local : null);
  parser.on("error", () => {
    throw BAD_XML();
  });
  parser.on("doctype", () => {
    throw new HttpError(
      422,
      "DTD declarations are not supported",
      "SITEMAP_DTD",
    );
  });
  parser.on("opentag", (tag) => {
    // 60,000: entries with ~20 hreflang alternates each (cloudflare.com) used 8,000 up in 400 entries; input stays capped at 512 KiB.
    if (++nodes > 60000 || stack.length >= 16)
      throw new HttpError(
        422,
        "Sitemap XML exceeds structural limits",
        "SITEMAP_COMPLEXITY",
      );
    if (!stack.length) {
      if (
        !["urlset", "sitemapindex"].includes(tag.local) ||
        (tag.uri !== NS && tag.uri !== NS_HTTPS && tag.uri !== "")
      )
        throw BAD_XML();
      kind = tag.local as typeof kind;
      rootUri = tag.uri;
      if (!rootUri) warnings.push("sitemap_namespace_missing");
    }
    if (
      current &&
      stack.length === 3 &&
      (stack[2] === "loc" || stack[2] === "lastmod")
    )
      throw BAD_XML();
    stack.push(core(tag));
    if (
      stack.length === 2 &&
      stack[1] === (kind === "urlset" ? "url" : "sitemap")
    ) {
      if (++reportedEntries > 1000)
        throw new HttpError(
          422,
          "Sitemap exceeds 1000 entries; choose a smaller child sitemap",
          "SITEMAP_ENTRY_LIMIT",
        );
      current = { loc: "", lastmod: "", hasLoc: false };
    }
    if (current && stack.length === 3 && stack[2] === "loc") {
      if (current.hasLoc) throw BAD_XML();
      current.hasLoc = true;
    }
  });
  const text = (value: string) => {
    if (!current || stack.length !== 3) return;
    if (stack[2] === "loc") current.loc += value;
    else if (stack[2] === "lastmod") current.lastmod += value;
    if (current.loc.length > 2048 || current.lastmod.length > 80)
      throw new HttpError(
        422,
        "Sitemap location or date field exceeds limits",
        "SITEMAP_FIELD_LIMIT",
      );
  };
  parser.on("text", text);
  parser.on("cdata", text);
  parser.on("closetag", () => {
    if (stack.length === 2 && current) {
      const raw = current.loc.trim();
      if (!raw || /[\u0000-\u0020\u007f]/.test(raw)) rejectedEntries++;
      else if (seen.has(raw)) duplicateEntries++;
      else {
        seen.add(raw);
        locations.push({
          location: raw,
          lastModified: current.lastmod.trim() || null,
        });
      }
      current = undefined;
    }
    stack.pop();
  });
  try {
    parser.write(source).close();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw BAD_XML();
  }
  if (!kind || stack.length) throw BAD_XML();
  if (rejectedEntries) warnings.push("invalid_or_nonpublic_locations_omitted");
  if (duplicateEntries) warnings.push("duplicate_locations_omitted");
  return {
    kind,
    locations,
    reportedEntries,
    rejectedEntries,
    duplicateEntries,
    warnings,
  };
}

function bounded(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
) {
  const value =
    raw === undefined ? fallback : /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw new HttpError(
      400,
      `${name} must be an integer from ${minimum} to ${maximum}`,
    );
  return value;
}
/**
 * The start of a sitemap as a complete document: up to `max` whole entries, then the root closed again. Used when the
 * input was cut at 512 KiB (`mustClose`) or holds more than `max` entries; otherwise the source is returned unchanged.
 */
export function firstEntries(source: string, max: number, mustClose: boolean): { source: string; cut: boolean } {
  const root = /<\s*((?:[\w.-]+:)?)(urlset|sitemapindex)\b/.exec(source);
  if (!root) return { source, cut: false };
  const prefix = root[1].replace(/[.]/g, "\\.");
  const close = new RegExp(`</\\s*${prefix}${root[2] === "urlset" ? "url" : "sitemap"}\\s*>`, "g");
  let count = 0, end = -1;
  for (let m = close.exec(source); m; m = count === max ? null : close.exec(source)) {
    count++;
    end = m.index + m[0].length;
  }
  const more = count === max && close.exec(source) !== null;
  if ((!mustClose && !more) || end < 0) return { source, cut: false };
  return { source: `${source.slice(0, end)}</${root[1]}${root[2]}>`, cut: true };
}
const XML_ACCEPT ="application/xml,text/xml,application/gzip,application/octet-stream;q=0.8,text/plain;q=0.5";
const XML_TYPES = ["application/xml", "text/xml", "text/plain", "application/octet-stream", "application/gzip", "application/x-gzip"];
const typeOf = (r: Response) => (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
/** The sitemap of a site given by its home page: robots.txt "Sitemap:" lines on the same host first, then the usual paths. */
async function discoverSitemap(home: URL): Promise<{ url: URL; response: Response } | null> {
  const candidates: URL[] = [];
  try {
    const robots = await fetchPublic(new URL("/robots.txt", home), "text/plain", [], { cacheSeconds: 600 });
    if (robots.ok && robots.body) {
      const text = new TextDecoder().decode(await new Response(capBytes(robots.body, 256 * 1024, () => {})).arrayBuffer());
      for (const m of text.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)) {
        try {
          const u = parseTarget(m[1]);
          if (u.hostname === home.hostname && candidates.length < 3) candidates.push(u);
        } catch { /* a bad line is skipped */ }
      }
    } else await robots.body?.cancel();
  } catch { /* no robots.txt */ }
  candidates.push(new URL("/sitemap.xml", home), new URL("/sitemap_index.xml", home));
  for (const url of candidates) {
    try {
      const response = await fetchPublic(url, XML_ACCEPT, [], { cacheSeconds: 600 });
      if (response.ok && XML_TYPES.includes(typeOf(response))) return { url, response };
      await response.body?.cancel();
    } catch { /* try the next one */ }
  }
  return null;
}
async function sha256(value: string) {
  return (
    "sha256:" +
    Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
      ),
      (n) => n.toString(16).padStart(2, "0"),
    ).join("")
  );
}

export async function sitemap(
  rawUrl: string | undefined,
  contains = "",
  maxParam?: string,
  offsetParam?: string,
) {
  let target = parseTarget(rawUrl);
  if (contains.length > 200 || /[\u0000-\u001f\u007f]/.test(contains))
    throw new HttpError(
      400,
      "contains must be at most 200 characters without control characters",
    );
  const maxUrls = bounded(maxParam, 25, 1, 100, "maxUrls");
  const offset = bounded(offsetParam, 0, 0, 1000, "offset");
  // Sitemaps change rarely: a repeat read within 10 minutes is served from the edge cache instead of asking the host again.
  let response = await fetchPublic(
    target,
    "application/xml,text/xml,application/gzip,application/octet-stream;q=0.8,text/plain;q=0.5",
    [],
    { cacheSeconds: 600 },
  );
  // A site's home page instead of its sitemap (url=https://www.cloudflare.com in the 26 Oct 2026 probe): find the sitemap
  // the way crawlers do, from robots.txt "Sitemap:" lines on the same host, else /sitemap.xml and /sitemap_index.xml.
  if (typeOf(response) === "text/html" && target.pathname === "/") {
    await response.body?.cancel();
    const found = await discoverSitemap(target);
    if (!found)
      throw new HttpError(
        404,
        "no sitemap found for this site: its robots.txt names none and /sitemap.xml and /sitemap_index.xml are missing; pass the sitemap URL itself",
        "SITEMAP_NOT_FOUND",
      );
    ({ url: target, response } = found);
  }
  const contentType = typeOf(response);
  if (
    ![
      "application/xml",
      "text/xml",
      "text/plain",
      "application/octet-stream",
      "application/gzip",
      "application/x-gzip",
    ].includes(contentType)
  ) {
    await response.body?.cancel();
    throw new HttpError(
      415,
      "url must return XML or gzip-compressed XML",
      "SITEMAP_REQUIRED",
    );
  }
  // Large sitemaps (cloudflare.com, vercel.com: most real company sites) are read from the start: the first 512 KiB, then
  // only complete entries, at most 1000 of them, with a warning. They used to be refused whole (26 Oct 2026 probe).
  let clipped = false;
  let input = new Uint8Array(
    await new Response(
      capBytes(response.body!, LIMIT + 1, () => {
        clipped = true;
      }),
    ).arrayBuffer(),
  );
  const gzipped = input[0] === 0x1f && input[1] === 0x8b;
  let truncatedInput = false;
  if (clipped || input.length > LIMIT) {
    // A cut gzip stream cannot be decompressed reliably: those stay refused, with the child-sitemap advice.
    if (gzipped)
      throw new HttpError(
        422,
        "Compressed sitemap input exceeds 512 KiB; choose a smaller child sitemap",
        "SITEMAP_TOO_LARGE",
      );
    input = input.slice(0, LIMIT);
    truncatedInput = true;
  }
  let bytes: Uint8Array = input;
  if (input[0] === 0x1f && input[1] === 0x8b) {
    try {
      let expandedClipped = false;
      const stream = new Blob([input])
        .stream()
        .pipeThrough(new DecompressionStream("gzip"));
      bytes = new Uint8Array(
        await new Response(
          capBytes(stream, LIMIT + 1, () => {
            expandedClipped = true;
          }),
        ).arrayBuffer(),
      );
      if (expandedClipped || bytes.length > LIMIT) {
        bytes = bytes.slice(0, LIMIT);
        truncatedInput = true;
      }
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        422,
        "Could not decompress sitemap",
        "SITEMAP_GZIP_INVALID",
      );
    }
  }
  let source: string;
  try {
    // A cut input may end inside a multi-byte character; that tail is dropped with the incomplete entry below.
    source = new TextDecoder("utf-8", { fatal: !truncatedInput, ignoreBOM: false }).decode(
      bytes,
    );
  } catch {
    throw new HttpError(
      415,
      "Sitemap must be UTF-8 encoded",
      "SITEMAP_ENCODING",
    );
  }
  const head = firstEntries(source, 1000, truncatedInput);
  if (truncatedInput && !head.cut)
    throw new HttpError(
      422,
      "The first 512 KiB of this sitemap hold no complete entry; choose a smaller child sitemap",
      "SITEMAP_TOO_LARGE",
    );
  source = head.source;
  const parsed = parseSitemap(source);
  if (head.cut) parsed.warnings.push("large_sitemap_read_from_start_first_512_kib_or_1000_entries");
  const needle = contains.toLowerCase();
  const matched = parsed.locations.filter((entry) =>
    entry.location.toLowerCase().includes(needle),
  );
  const candidates = matched.slice(offset, offset + maxUrls),
    entries: SitemapEntry[] = [];
  let rejectedLocationsInPage = 0;
  const pageSeen = new Set<string>();
  for (const item of candidates) {
    try {
      const url = parseTarget(item.location).href;
      if (url.length > 2048) throw BAD_XML();
      if (!pageSeen.has(url)) {
        entries.push({ url, lastModified: item.lastModified });
        pageSeen.add(url);
      }
    } catch {
      rejectedLocationsInPage++;
    }
  }
  const nextOffset =
    offset + maxUrls < matched.length ? offset + maxUrls : null;
  const text = entries.length
    ? entries.map((entry) => entry.url).join("\n")
    : "No matching entries at this offset in this sitemap.";
  return {
    url: target.href,
    finalUrl: response.url || target.href,
    kind: parsed.kind,
    entries,
    reportedEntries: parsed.reportedEntries,
    uniqueReportedLocations: parsed.locations.length,
    missingOrInvalidLocations: parsed.rejectedEntries,
    duplicateReportedLocations: parsed.duplicateEntries,
    rejectedLocationsInPage,
    matchingReportedLocations: matched.length,
    contains,
    offset,
    nextOffset,
    hasMore: nextOffset !== null,
    warnings: [
      ...parsed.warnings,
      ...(rejectedLocationsInPage
        ? ["nonpublic_or_invalid_locations_in_page_omitted"]
        : []),
      "counts_describe_reported_locations_before_public_url_validation",
      "locations_and_dates_are_source_reported_not_probed",
      ...(parsed.kind === "sitemapindex"
        ? ["entries_are_child_sitemaps_not_pages"]
        : []),
    ],
    text,
    format: "text" as const,
    hashFormat: "text" as const,
    contentHash: await sha256(text),
    sourceHash: await sha256(source),
    fetchedAt: new Date().toISOString(),
  };
}
