// "Try it with your own inputs": a plain GET form on the browser pages (tool page, the 402 page a browser gets,
// the free-trial result) that runs one free call on the visitor's own values. Before it, a person could only run
// the published example (London's weather, one fixed wallet), so nobody saw the tool work on their own data
// before deciding to buy credits. No script: the form submits to the tool URL with trial=1, which already renders
// the result as a page. Only for tools in the free calls.
import { exampleParams, type Endpoint } from "../endpoints";
import { FREE_CALLS_PER_CALLER } from "./free-calls";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** At most this many fields: required inputs and the published example's, never `only`. */
const MAX_FIELDS = 6;

/** An input's description as a hint under the field, cut at a word when long. Not split on full stops: the
 *  descriptions use "e.g." and decimals. */
function hint(description: string): string {
  if (description.length <= 120) return description;
  const cut = description.slice(0, 117);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 60 ? cut.lastIndexOf(" ") : 117)}…`;
}

/**
 * The form, prefilled with the values the visitor already sent (when `values` holds any of the tool's inputs) or
 * else the published example. Empty for tools without inputs: their "Run it free" button already covers them.
 */
export function tryForm(endpoint: Endpoint, values?: URLSearchParams, heading = "Try it with your own inputs"): string {
  const example = new Map(exampleParams(endpoint));
  const required = Object.entries(endpoint.params).filter(([, p]) => p.required).map(([name]) => name);
  const names = [...new Set([...required, ...example.keys()])].filter((name) => name !== "only" && endpoint.params[name]).slice(0, MAX_FIELDS);
  if (!names.length) return "";
  const own = values && names.some((name) => values.has(name));
  const fields = names.map((name) => {
    const p = endpoint.params[name];
    const value = own ? values!.get(name) ?? "" : String(example.get(name)?.example ?? p.example ?? "");
    const id = `try-${name}`;
    const control = p.enum
      ? `<select id="${esc(id)}" name="${esc(name)}">${p.enum.map((v) => `<option${v === value ? " selected" : ""}>${esc(v)}</option>`).join("")}</select>`
      : `<input id="${esc(id)}" name="${esc(name)}" type="text" value="${esc(value)}"${p.required ? " required" : ""}${p.type === "string" ? "" : ' inputmode="decimal"'} autocomplete="off" spellcheck="false">`;
    return `<div class="field"><label for="${esc(id)}"><code>${esc(name)}</code>${p.required ? "" : " <span class=\"opt\">(optional)</span>"}</label>${control}<small>${esc(hint(p.description))}</small></div>`;
  });
  return `<form class="try" method="get" action="${esc(endpoint.path)}">
<h2>${esc(heading)}</h2>
${fields.join("\n")}
<input type="hidden" name="trial" value="1">
<button type="submit" class="btn primary">Run it free</button>
<p class="small">Uses one of your ${FREE_CALLS_PER_CALLER} free calls. Nothing is charged, and a call that fails is not counted.</p>
</form>`;
}

/** Styles for the form; the pages already define the colour variables and the .btn classes it uses. */
export const TRY_FORM_CSS =
  "form.try{background:var(--card,#f6f7f9);border:1px solid var(--line);border-radius:10px;padding:16px 16px 8px;margin:8px 0 24px}" +
  "form.try h2{margin:0 0 12px}form.try .field{margin:0 0 12px}form.try label{display:block;font-weight:600;margin-bottom:4px}" +
  "form.try .opt{font-weight:400;color:var(--muted)}form.try input,form.try select{width:100%;max-width:100%;padding:9px 10px;border:1px solid var(--line);border-radius:7px;background:var(--bg);color:var(--fg);font:inherit}" +
  "form.try small{display:block;color:var(--muted);margin-top:3px}form.try button{cursor:pointer;font:inherit}form.try .small{color:var(--muted);font-size:.88rem}";
