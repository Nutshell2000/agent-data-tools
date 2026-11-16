// Human pages for payee records (routes/payee.ts): /payee explains the file and takes a claim; /payee/<domain> shows a
// record. Plain HTML, no script; the working product name is internal and never appears here.
import { DECLARATION_PATH, KEYS_PATH, RECORD_DAYS, type PayeeRecord } from "../routes/payee";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

const STYLE = `:root{--bg:#fbfbfa;--fg:#1d1d1b;--muted:#5d5d58;--line:#e2e1dc;--ok:#1f7a3f;--warn:#9a5b00;--bad:#b3261e;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--fg:#ecebe6;--muted:#a8a79f;--line:#33322e;--ok:#5cc184;--warn:#e0a342;--bad:#f28b82;--card:#1c1c1a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:760px;margin:0 auto;padding:32px 16px 64px}h1{font-size:1.7rem;line-height:1.25;margin:0 0 8px}h2{font-size:1.15rem;margin:32px 0 8px}
p,li{color:var(--fg)}.muted{color:var(--muted)}code,pre{font:13px/1.5 ui-monospace,Consolas,monospace}pre{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;overflow-x:auto}
form{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}input{flex:1 1 240px;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg);font:inherit}
button{padding:10px 16px;border:0;border-radius:8px;background:var(--fg);color:var(--bg);font:inherit;cursor:pointer}
table{width:100%;border-collapse:collapse;margin:8px 0}td,th{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}th{width:34%;color:var(--muted);font-weight:500}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-weight:600;font-size:.9rem;border:1px solid currentColor}.verified{color:var(--ok)}.partial,.none{color:var(--warn)}.review{color:var(--bad)}`;

const shell = (title: string, description: string, canonical: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(description)}"><link rel="canonical" href="${esc(canonical)}"><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;

export const EXAMPLE_DECLARATION = {
  version: 1,
  company: { name: "Example Shop AB", country: "SE", id: "559999-9999", vat: "SE559999999901" },
  payTo: [{ address: "0x1111111111111111111111111111111111111111", network: "base", signature: "0x…" }],
  einvoice: { peppolId: "0007:5599999999", formats: ["xrechnung-cii", "ubl", "zugferd"] },
};

export function payeeLandingPage(origin: string) {
  const body = `<h1>Verified payee records</h1>
<p>AI agents are starting to pay sellers no person has vetted. A verified payee record lets a business show agents, before they pay, that it is a real registered company, that the wallet in its quote is its own, and that nothing about it is on a sanctions list.</p>
<p class="muted">Free for the business. Agents read records through the paid <code>/payee/check</code> tool. We never hold or move money, and a record states checked facts, not a credit view.</p>

<h2>Look up a record</h2>
<form action="${esc(origin)}/payee/lookup" method="get"><input name="domain" placeholder="shop.example.com" required aria-label="Domain"><button>Look up</button></form>

<h2>Claim a record for your business</h2>
<ol>
<li>Publish <code>${esc(DECLARATION_PATH)}</code> on your domain, served over https:
<pre>${esc(JSON.stringify(EXAMPLE_DECLARATION, null, 2))}</pre></li>
<li>Prove each payout wallet: sign the text <code>agent-payee:&lt;your domain&gt;:&lt;wallet address in lower case&gt;</code> with that wallet (EIP-191 personal sign; contract wallets via ERC-1271 work too) and put the signature next to it.</li>
<li>Claim it below. We read the file, check the company in the official registers, EU VIES, GLEIF and the OFAC, EU, UN and UK sanctions lists, verify each signature and screen each wallet.</li>
</ol>
<form action="${esc(origin)}/payee/claim" method="get"><input name="domain" placeholder="shop.example.com" required aria-label="Your domain"><button>Check and claim</button></form>

<h2>What the statuses mean</h2>
<table>
<tr><th><span class="badge verified">verified</span></th><td>The domain serves the file, the company was found in an official register with nothing on a sanctions list, and at least one wallet is proven by signature.</td></tr>
<tr><th><span class="badge partial">partial</span></th><td>The file is there, but something is not proven yet (no registered company declared, or no signed wallet).</td></tr>
<tr><th><span class="badge review">review</span></th><td>Something needs a person's look: a sanctions list match, a register ID that does not match, an invalid VAT number or a blocked wallet.</td></tr>
</table>
<p class="muted">Records are checked again after ${RECORD_DAYS} days. Each record carries an Ed25519-signed attestation; the public key is at <a href="${esc(origin)}${esc(KEYS_PATH)}">${esc(KEYS_PATH)}</a>. All records: <a href="${esc(origin)}/payee/registry">/payee/registry</a>.</p>`;
  return shell("Verified payee records for agent payments", "Show AI agents that your business and its payout wallets are verified before they pay you. Free for businesses.", `${origin}/payee`, body);
}

const row = (k: string, v: string) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;

export function payeeRecordPage(origin: string, record: PayeeRecord, attestation: { signature: string | null; kid: string | null } | null) {
  const c = record.company as { register?: Record<string, unknown> | null; vat?: Record<string, unknown> | null; lei?: Record<string, unknown> | null; sanctions?: { verdict?: string } } | null;
  const reg = c?.register;
  const body = `<p class="muted"><a href="${esc(origin)}/payee">Verified payee records</a></p>
<h1>${esc(record.domain)}</h1>
<p><span class="badge ${esc(record.status)}">${esc(record.status)}</span> <span class="muted">checked ${esc(record.verifiedAt.slice(0, 10))}, valid until ${esc(record.expiresAt.slice(0, 10))}</span></p>
<h2>Company</h2>
<table>
${reg ? row("Register entry", `${esc(reg.name)} (${esc(reg.country)} ${esc(reg.idType)} ${esc(reg.id)})<br><span class="muted">${esc(reg.source)}</span>`) : row("Register entry", c ? "not found" : "no registered business declared")}
${c?.vat ? row("EU VAT number", `${esc(c.vat.vat)}: ${c.vat.valid ? "valid in VIES" : "not valid in VIES"}`) : ""}
${c?.lei ? row("LEI", `${esc(c.lei.lei)} (${esc(c.lei.entityStatus)})`) : ""}
${c?.sanctions ? row("Sanctions (company)", esc(c.sanctions.verdict)) : ""}
</table>
<h2>Payout wallets</h2>
<table>${record.wallets.length ? record.wallets.map((w) => row(`${w.network}`, `<code>${esc(w.address)}</code><br>${w.proof === "signature" ? "proven by signature" : w.proof === "bad-signature" ? "signature does not verify" : "declared, not signed"}; sanctions: ${esc(w.sanctions)}`)).join("") : row("Wallets", "none declared")}</table>
${record.einvoice ? `<h2>E-invoices</h2><table>${row("Peppol ID", esc(record.einvoice.peppolId ?? "not given"))}${row("Formats", esc(record.einvoice.formats.join(", ") || "not given"))}</table>` : ""}
${record.flags.length ? `<h2>Notes</h2><ul>${record.flags.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
<h2>Attestation</h2>
<p class="muted">${attestation?.signature ? `Signed (Ed25519, key ${esc(attestation.kid)}). Agents get it with <code>/payee/check?domain=${esc(record.domain)}</code>.` : "Not signed on this deployment."} Sources: ${esc(record.sources.join("; "))}.</p>
<p class="muted">A record states what was checked and when. It is not a guarantee that the seller delivers, not legal advice and not a credit view.</p>`;
  return shell(`${record.domain}: verified payee record`, `Payee record for ${record.domain}: ${record.status}. Company register, VAT, sanctions and payout wallet checks.`, `${origin}/payee/${record.domain}`, body);
}
