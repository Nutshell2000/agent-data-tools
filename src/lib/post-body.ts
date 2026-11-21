// The fields of a POSTed tool call, as clients really send them (21 Nov 2026). The POST route read only a flat JSON
// object. /status showed paying callers refused with "<input> is required [sent nothing]" on six tools in seven days:
// their request reached the tool with no input at all, which is what a form-encoded body or a JSON body that wraps the
// inputs in one more object ({"input": {...}}, {"arguments": {...}}, as tool-calling frameworks send) turned into.

/** Keys under which clients nest a tool's inputs. `query` and `data` are also real input names, so see `unwrapBody`. */
const WRAPPERS = ["input", "inputs", "params", "parameters", "arguments", "args", "payload", "body", "data", "query"];

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/**
 * A request body as an object of fields, or null: a JSON object, or a form-encoded body (by content type, or when the
 * text is not JSON and looks like `a=b&c=d`). Never throws.
 */
export function parseBody(text: string, contentType: string | null | undefined): Record<string, unknown> | null {
  const raw = text.trim();
  if (!raw) return null;
  const form = () => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of new URLSearchParams(raw)) if (k) out[k] = v;
    return Object.keys(out).length ? out : null;
  };
  if (/x-www-form-urlencoded/i.test(contentType ?? "")) return form();
  try {
    const parsed: unknown = JSON.parse(raw);
    // A JSON string that itself holds JSON (a body stringified twice) is read once more.
    if (typeof parsed === "string" && parsed.trim().startsWith("{")) { try { const inner: unknown = JSON.parse(parsed); return isObject(inner) ? inner : null; } catch { return null; } }
    return isObject(parsed) ? parsed : null;
  } catch {
    return /^[A-Za-z_][\w.-]*=[^\n]*$/.test(raw) && !raw.startsWith("{") ? form() : null;
  }
}

/**
 * The object that holds the tool's inputs. When no top-level key is an input the tool knows and exactly one wrapper key
 * holds an object with at least one known input, that object is used; in every other case the body is returned as it
 * is. So a tool whose own input is called `query` or `data` (a string) is never mistaken for a wrapper.
 */
export function unwrapBody(body: Record<string, unknown> | null, known: (name: string) => boolean): Record<string, unknown> | null {
  if (!body) return body;
  if (Object.keys(body).some(known)) return body;
  const inner = WRAPPERS.filter((k) => isObject(body[k]) && Object.keys(body[k] as object).some(known));
  return inner.length === 1 ? (body[inner[0]] as Record<string, unknown>) : body;
}
