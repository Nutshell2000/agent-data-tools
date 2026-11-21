// Reading an outside source's answer. 21 Nov 2026: a sweep of every tool with a mocked network found 28 tools where a
// source's 200 answer that was not JSON (an HTML error or block page, an empty body) came out as our own "internal
// error" (500). That is the source's failure: a 502 that names the source and says nothing was charged, as the
// neighbouring failures of the same tools already do.
import { HttpError } from "./env";

/** The refusal for a source whose answer could not be used. */
export const unreadableSource = (source: string) => new HttpError(502, `${source} sent an answer that could not be read; nothing was charged, try again`);

/**
 * A response's JSON body. A body that is not JSON, or that is the bare JSON value null, is the source's failure (502),
 * never an exception of ours: every caller reads an object or a list from it.
 */
export async function sourceJson<T>(res: Response, source: string): Promise<NonNullable<T>> {
  let body: T;
  try {
    body = (await res.json()) as T;
  } catch {
    throw unreadableSource(source);
  }
  if (body === null || body === undefined) throw unreadableSource(source);
  return body as NonNullable<T>;
}
