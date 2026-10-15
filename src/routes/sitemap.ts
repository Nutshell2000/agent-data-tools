import { SaxesParser, type SaxesTagNS } from "saxes";
import { HttpError } from "../lib/env";
import { capBytes, fetchPublic, parseTarget } from "../lib/fetch";

const NS = "http://www.sitemaps.org/schemas/sitemap/0.9";
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
    if (++nodes > 8000 || stack.length >= 16)
      throw new HttpError(
        422,
        "Sitemap XML exceeds structural limits",
        "SITEMAP_COMPLEXITY",
      );
    if (!stack.length) {
      if (
        !["urlset", "sitemapindex"].includes(tag.local) ||
        (tag.uri !== NS && tag.uri !== "")
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
  const target = parseTarget(rawUrl);
  if (contains.length > 200 || /[\u0000-\u001f\u007f]/.test(contains))
    throw new HttpError(
      400,
      "contains must be at most 200 characters without control characters",
    );
  const maxUrls = bounded(maxParam, 25, 1, 100, "maxUrls");
  const offset = bounded(offsetParam, 0, 0, 1000, "offset");
  const response = await fetchPublic(
    target,
    "application/xml,text/xml,application/gzip,application/octet-stream;q=0.8,text/plain;q=0.5",
  );
  const contentType = (response.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
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
  if (Number(response.headers.get("content-length")) > LIMIT) {
    await response.body?.cancel();
    throw new HttpError(
      422,
      "Sitemap input exceeds 512 KiB",
      "SITEMAP_TOO_LARGE",
    );
  }
  let clipped = false;
  const input = new Uint8Array(
    await new Response(
      capBytes(response.body!, LIMIT + 1, () => {
        clipped = true;
      }),
    ).arrayBuffer(),
  );
  if (clipped || input.length > LIMIT)
    throw new HttpError(
      422,
      "Sitemap input exceeds 512 KiB",
      "SITEMAP_TOO_LARGE",
    );
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
      if (expandedClipped || bytes.length > LIMIT)
        throw new HttpError(
          422,
          "Expanded sitemap exceeds 512 KiB",
          "SITEMAP_TOO_LARGE",
        );
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
    source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
      bytes,
    );
  } catch {
    throw new HttpError(
      415,
      "Sitemap must be UTF-8 encoded",
      "SITEMAP_ENCODING",
    );
  }
  const parsed = parseSitemap(source);
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
