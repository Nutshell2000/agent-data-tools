// Counted reads (21 Nov 2026). `await res.text()`, `.arrayBuffer()`, `.json()` and `.formData()` buffer a whole body
// before any size test can run, so a caller-chosen page, an unpaid upload sent chunked (no Content-Length) or a small
// compressed stream that expands a thousand times could fill the isolate's memory and fail the requests beside it.
// Everything here reads chunk by chunk, counts, and stops at the limit: at most `limit` bytes (plus one chunk in
// flight) are ever held.

function join(chunks: Uint8Array[], total: number): Uint8Array {
  if (chunks.length === 1 && chunks[0].byteLength === total) return chunks[0];
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.byteLength; }
  return out;
}

/**
 * At most `limit` bytes of a stream. `over` says the stream held more: the rest is cancelled, never read. A stream
 * that breaks while being read rejects, as `arrayBuffer()` would.
 */
export async function readCapped(body: ReadableStream<Uint8Array> | null | undefined, limit: number): Promise<{ bytes: Uint8Array; over: boolean }> {
  if (!body) return { bytes: new Uint8Array(), over: false };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { bytes: join(chunks, total), over: false };
    if (!value?.byteLength) continue;
    const room = limit - total;
    if (value.byteLength > room) {
      if (room > 0) { chunks.push(value.subarray(0, room)); total += room; }
      // Not awaited: on one half of a cloned (teed) body the cancel settles only when the other half is cancelled too,
      // and nobody reads that half once the upload is refused.
      void reader.cancel().catch(() => {});
      return { bytes: join(chunks, total), over: true };
    }
    chunks.push(value);
    total += value.byteLength;
  }
}

/** The start of a text body, at most `maxBytes` of it, decoded as UTF-8. A stream that breaks rejects, as `text()` would. */
export async function textCapped(body: ReadableStream<Uint8Array> | null | undefined, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const { bytes, over } = await readCapped(body, maxBytes);
  return { text: new TextDecoder().decode(bytes), truncated: over };
}

/**
 * A JSON answer of at most `maxBytes`, or null when it is larger or not JSON. For the fixed upstreams whose answers
 * are small by design: a wrong or hijacked answer is refused instead of parsed at any size.
 */
export async function jsonCapped(res: Response, maxBytes: number): Promise<unknown | null> {
  try {
    const { bytes, over } = await readCapped(res.body, maxBytes);
    if (over) return null;
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

/**
 * The first `limit + 1` bytes at most, then a stream that replays them and continues with the rest. `complete` is
 * the whole body when it fitted in `limit`; otherwise `rest` is the body from its first byte, still unread beyond
 * what was looked at, so the caller's own cap decides what happens to a large one.
 */
export async function peekBody(body: ReadableStream<Uint8Array>, limit: number): Promise<{ complete: Uint8Array } | { rest: ReadableStream<Uint8Array> }> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total <= limit) {
    const { done, value } = await reader.read();
    if (done) return { complete: join(chunks, total) };
    if (!value?.byteLength) continue;
    chunks.push(value);
    total += value.byteLength;
  }
  let sent = 0;
  const rest = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (sent < chunks.length) { controller.enqueue(chunks[sent++]); return; }
      try {
        const { done, value } = await reader.read();
        if (done) controller.close();
        else if (value) controller.enqueue(value);
      } catch (e) { controller.error(e); }
    },
    cancel(reason) { return reader.cancel(reason).catch(() => {}); },
  });
  return { rest };
}
