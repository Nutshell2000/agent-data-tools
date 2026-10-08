import { HttpError } from "./env";

/** Rejects targets that are never legitimate for a public fetch service. */
export function parseTarget(raw: string | undefined): URL {
  if (!raw) throw new HttpError(400, "missing required query parameter: url");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, "url must be an absolute http(s) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new HttpError(400, "only http and https URLs are supported");
  if (url.username || url.password) throw new HttpError(400, "URLs with credentials are not supported");
  const host = url.hostname.toLowerCase();
  const privateHost =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.startsWith("[") ||
    /^(0|10|127)\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    !host.includes(".");
  if (privateHost) throw new HttpError(400, "private, loopback and IPv6-literal hosts are not supported");
  return url;
}

/** Passes at most `limit` bytes through, then ends the stream. */
export function capBytes(body: ReadableStream<Uint8Array>, limit: number, onTruncate: () => void) {
  let seen = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (seen >= limit) return;
        const room = limit - seen;
        seen += chunk.byteLength;
        if (chunk.byteLength > room) {
          controller.enqueue(chunk.subarray(0, room));
          onTruncate();
          controller.terminate();
        } else {
          controller.enqueue(chunk);
        }
      },
    }),
  );
}

/** Fetches a public URL with the same guards as /extract. Throws HttpError on any failure. */
export async function fetchPublic(target: URL, accept: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(target, {
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
      headers: { "user-agent": "Mozilla/5.0 (compatible; AgentDataTools/1.0)", accept, "accept-language": "en" },
    });
  } catch (e) {
    const timedOut = e instanceof Error && e.name === "TimeoutError";
    throw new HttpError(timedOut ? 504 : 502, timedOut ? "target did not respond within 8 seconds" : "could not reach target URL");
  }
  // A redirect must not smuggle the request to a blocked host.
  parseTarget(res.url || target.href);
  if (!res.ok) throw new HttpError(502, `target responded with HTTP ${res.status}`);
  if (!res.body) throw new HttpError(502, "target returned an empty body");
  return res;
}

/** Downloads a file of an expected media type, refusing anything over `maxBytes`. */
export async function fetchFile(rawUrl: string | undefined, typePattern: RegExp, maxBytes: number, what: string) {
  const target = parseTarget(rawUrl);
  const res = await fetchPublic(target, "*/*");
  const contentType = res.headers.get("content-type") ?? "";
  if (!typePattern.test(contentType)) throw new HttpError(415, `url must point to ${what}; got ${contentType || "an unknown type"}`);
  let tooBig = Number(res.headers.get("content-length")) > maxBytes;
  const bytes = tooBig ? new Uint8Array() : new Uint8Array(await new Response(capBytes(res.body!, maxBytes + 1, () => {})).arrayBuffer());
  tooBig ||= bytes.byteLength > maxBytes;
  if (tooBig) throw new HttpError(422, `file is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB limit`);
  return { url: target.href, contentType: contentType.split(";")[0].trim(), bytes };
}
