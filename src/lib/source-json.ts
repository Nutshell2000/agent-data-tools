// Reading an outside source's answer. 21 Nov 2026: a sweep of every tool with a mocked network found 28 tools where a
// source's 200 answer that was not JSON (an HTML error or block page, an empty body) came out as our own "internal
// error" (500). That is the source's failure: a 502 that names the source and says nothing was charged, as the
// neighbouring failures of the same tools already do.
import { HttpError } from "./env";
import { readCapped } from "./read-capped";

/** The refusal for a source whose answer could not be used. */
export const unreadableSource = (source: string) => new HttpError(502, `${source} sent an answer that could not be read; nothing was charged, try again`);

/**
 * A response's JSON body. A body that is not JSON, or that is the bare JSON value null, is the source's failure (502),
 * never an exception of ours: every caller reads an object or a list from it.
 */
export async function sourceJson<T>(res: Response, source: string, maxBytes = SOURCE_MAX_BYTES): Promise<NonNullable<T>> {
  let body: T;
  try {
    body = await jsonWithin<T>(res, maxBytes);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw unreadableSource(source);
  }
  if (body === null || body === undefined) throw unreadableSource(source);
  return body as NonNullable<T>;
}

// ---- the shape of an answer (21 Nov 2026) ----
// The same sweep found 67 tools that read a field of an answer that was JSON but not the JSON the handler expects: an
// object where a list belongs, a missing section, a nested null. `r.features.filter(...)` then threw, which is our 500
// and counts against the whole service; a handler that guarded with `?? []` instead sold an empty answer. Both are
// the source's failure. One check, used by every such handler, instead of a hand-written test in each.

/** What a field of a source's answer must be for the handler to read it. "any" is present and not null. */
export type SourceKind = "array" | "object" | "string" | "number" | "any";

const isKind = (v: unknown, kind: SourceKind): boolean =>
  kind === "array" ? Array.isArray(v)
    : kind === "object" ? typeof v === "object" && v !== null && !Array.isArray(v)
    : kind === "string" ? typeof v === "string"
    : kind === "number" ? typeof v === "number" && Number.isFinite(v)
    : v !== null && v !== undefined;

/** The value at a dotted path ("daily.uv_index_max"), read through own keys only; undefined when any step is missing. */
function at(body: unknown, path: string): unknown {
  let v = body;
  for (const key of path.split(".")) {
    if (typeof v !== "object" || v === null || !Object.hasOwn(v, key)) return undefined;
    v = (v as Record<string, unknown>)[key];
  }
  return v;
}

/**
 * The answer, when it is a list. Anything else is the source's failure: 502, names the source, nothing charged.
 * `source` is the name a caller would recognise ("USGS", "Hacker News").
 */
export function sourceList<T = unknown>(body: unknown, source: string): T[] {
  if (!Array.isArray(body)) throw unreadableSource(source);
  return body as T[];
}

/**
 * The answer, when it is an object (not a list, not null) whose listed fields are what the handler reads. `fields`
 * maps a key or a dotted path to its kind; a field not listed is not checked. Anything else is a 502 as above.
 */
export function sourceShape<T>(body: T, source: string, fields: Readonly<Record<string, SourceKind>> = {}): NonNullable<T> {
  if (!isKind(body, "object")) throw unreadableSource(source);
  for (const [path, kind] of Object.entries(fields)) if (!isKind(at(body, path), kind)) throw unreadableSource(source);
  return body as NonNullable<T>;
}

// ---- counted reads of a source's answer (21 Nov 2026) ----
// `res.json()` and `res.text()` take a whole body into memory before anything can look at its size. The sources the
// tools read are fixed public APIs, not addresses a caller chooses, so this is not the open door the page readers had
// (lib/read-capped.ts); but a source that is broken, hijacked or simply grows should fail one call with a 502, not
// take the isolate's memory and the requests beside it. These two read through the counter and are otherwise drop-in.

/** The ceiling for a source's answer when the caller names none: far above any answer the tools read today. */
export const SOURCE_MAX_BYTES = 32 * 1024 * 1024;
/** For the few sources whose honest answers are tens of megabytes (DefiLlama's pool file, SEC company facts, 13F tables). */
export const SOURCE_MAX_BYTES_LARGE = 64 * 1024 * 1024;

const tooLarge = (maxBytes: number) => new HttpError(502, `a data source sent more than ${Math.round(maxBytes / 1024 / 1024)} MB, which is more than this tool reads; nothing was charged, try again`);

async function bytesWithin(res: Response, maxBytes: number): Promise<Uint8Array> {
  const { bytes, over } = await readCapped(res.body, maxBytes);
  if (over) throw tooLarge(maxBytes);
  return bytes;
}

/**
 * `res.json()` with a ceiling: rejects exactly as `json()` does when the body is not JSON (so a caller's own
 * `catch` keeps working), and with a 502 when the body is larger than `maxBytes`.
 */
export async function jsonWithin<T = unknown>(res: Response, maxBytes = SOURCE_MAX_BYTES): Promise<T> {
  // A stand-in without a stream body (a test double, a cached copy made from a string) keeps its own reader.
  if (res.body === undefined) return (await res.json()) as T;
  return JSON.parse(new TextDecoder().decode(await bytesWithin(res, maxBytes))) as T;
}

/** `res.text()` with a ceiling: a 502 when the body is larger than `maxBytes`. */
export async function textWithin(res: Response, maxBytes = SOURCE_MAX_BYTES): Promise<string> {
  if (res.body === undefined) return res.text();
  return new TextDecoder().decode(await bytesWithin(res, maxBytes));
}
