// Privacy policy, terms and support pages. Plain statements of what the service actually stores and does;
// update them whenever logging, storage or payment handling changes.
import { Hono } from "hono";
import type { Env } from "./env";
import { SUPPORT_EMAIL } from "../endpoints";

const UPDATED = "26 October 2026";
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

function page(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Agent Data Tools</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><style>body{font:16px/1.6 system-ui,sans-serif;max-width:44rem;margin:2rem auto;padding:0 16px;color:#1b1b1b;background:#fff}h1{font-size:1.6rem}h2{font-size:1.15rem;margin-top:1.6rem}a{color:#1f7a4d}code{background:#f2f2f2;padding:.1rem .3rem;border-radius:4px}@media (prefers-color-scheme:dark){body{background:#151515;color:#eee}a{color:#6fd3a0}code{background:#262626}}</style></head><body>${body}<p><small>Last updated ${UPDATED}. <a href="/">Agent Data Tools</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/support">Support</a></small></p></body></html>`;
}

const mail = `<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>`;

export const PRIVACY_HTML = page("Privacy policy", `<h1>Privacy policy</h1>
<p>Agent Data Tools is operated by SpellzCode in Sweden. This page says what the service stores when you or your agent use it. Contact: ${mail}.</p>
<h2>What we store</h2>
<ul>
<li><strong>Request counts.</strong> Per tool and per day: how many calls were quoted, paid, free, failed or paid with credits. No inputs or outputs are stored in these counts.</li>
<li><strong>Request processing logs.</strong> Our host, Cloudflare, records request logs (including IP address, user agent, URL and timing) for operations and debugging, kept for Cloudflare's standard retention period. Tool inputs passed in the URL appear in those logs.</li>
<li><strong>Free calls.</strong> A one-way hash of your IP address and a count of free calls used. The IP address itself is not stored for this.</li>
<li><strong>Crypto payments (x402).</strong> For each settled payment: the paying wallet address, amount, network, transaction reference and tool. Blockchain payments are public by nature.</li>
<li><strong>Agent memory.</strong> What you save with the memory tools (/memory/set), under a one-way hash of the namespace you choose, until it expires (at most 30 days) or you delete it with /memory/delete. Anyone who knows a namespace can read it.</li>
<li><strong>Card credits.</strong> A one-way hash of your API key with its balance and purchase history, and the Stripe Checkout or payment reference that created it. The key itself is kept with that reference only so that reopening your claim link shows the same key. Card details are handled by Stripe and never reach us.</li>
<li><strong>Sign-in from apps (OAuth, for example ChatGPT).</strong> The app's registration (its name and redirect addresses) and one-way hashes of the access and refresh tokens issued to it, linked to your account. Tokens stop working when they expire.</li>
</ul>
<h2>Why we keep it</h2>
<p>Only to run the service: to answer and bill tool calls, to count and limit free calls, to keep a payment and credit record, to sign apps in, and to find and fix failures. Nothing is used for advertising or profiling.</p>
<h2>How long we keep it</h2>
<ul>
<li>Request logs: Cloudflare's standard retention (days, not months).</li>
<li>Agent memory: until you delete it, at most 30 days.</li>
<li>Sign-in tokens: until they expire.</li>
<li>Request counts, free-call counts, payment and card-credit records: while the service runs, because they are the accounting record. You can ask us to delete card-credit records (see below).</li>
</ul>
<h2>What we do not do</h2>
<ul>
<li>We do not sell or share data with advertisers, and we do not track you across other sites. The pages set no cookies.</li>
<li>We do not keep the content you ask a tool to read or compute, beyond the request logs above and what you save with the memory tools.</li>
<li>Tools that read the web fetch the public URL you give them; that site sees a request from our servers.</li>
</ul>
<h2>Third parties</h2>
<p>Cloudflare (hosting, and the AI models behind the AI tools: the text you send to an AI tool is processed by Cloudflare Workers AI to produce the answer), Brave (the query you send to the web and news search tools), Stripe (card payments), Coinbase Developer Platform (x402 payment settlement), and the public data sources each tool names in its description. They receive only what is needed to answer that call.</p>
<h2>Your choices</h2>
<p>To ask what we hold about an API key or wallet, or to have card-credit records deleted (this ends the key's balance), write to ${mail}.</p>`);

export const TERMS_HTML = page("Terms of service", `<h1>Terms of service</h1>
<p>These terms cover use of Agent Data Tools (the API, the MCP servers and this website), operated by SpellzCode in Sweden.</p>
<h2>The service</h2>
<ul>
<li>Each tool returns data from public sources or from computation, as described in its listing. Data can be incomplete, delayed or wrong; check anything important before relying on it.</li>
<li>Screening, risk and compliance tools (for example sanctions or counterparty checks) give information, not legal, financial or compliance advice, and do not replace your own obligations.</li>
<li>The service is provided as is, without warranties, and we may change, pause or remove tools. Per-tool reliability is published at <a href="/status">/status</a>.</li>
</ul>
<h2>Prices and payment</h2>
<ul>
<li>Each tool's price is shown in its listing and in its payment request. You pay only for successful calls; failed calls are not charged.</li>
<li>Every caller gets a small number of free calls; we may change or end free calls.</li>
<li>Card credits: 1 credit = $0.001. Credits do not expire. Unused credits can be refunded on request to ${mail}; used credits are not refundable.</li>
<li>Crypto payments are final once settled on chain, except where a call failed after payment, which you can report to ${mail}.</li>
</ul>
<h2>Acceptable use</h2>
<ul>
<li>Do not use the service for anything unlawful, to harm others, or to overload it. Keep your API key private; anyone with it can spend its credits.</li>
<li>We may block keys or traffic that break these terms.</li>
</ul>
<h2>Liability</h2>
<p>To the extent the law allows, our total liability for any claim is limited to what you paid us in the 30 days before it arose.</p>
<h2>Contact</h2><p>${mail}</p>`);

export const SUPPORT_HTML = page("Support", `<h1>Support</h1>
<p>Email ${mail}. We answer within one to two working days.</p>
<ul>
<li><strong>A paid call failed or returned bad data:</strong> include the <code>X-Request-ID</code> response header (or the MCP result's <code>requestId</code>), the tool and the approximate time (UTC).</li>
<li><strong>Card credits:</strong> include the email used at checkout. Do not send your full API key; the first 8 characters are enough.</li>
<li><strong>Bugs and feature requests:</strong> also welcome on <a href="https://github.com/Nutshell2000/agent-data-tools/issues">GitHub issues</a> (public; never post keys).</li>
</ul>
<p>Buying and using tools: <a href="/credits">pay by card</a>, <a href="/llms.txt">llms.txt</a>, <a href="/openapi.json">OpenAPI</a>.</p>`);

export const legal = new Hono<{ Bindings: Env }>();
legal.get("/privacy", (c) => c.html(PRIVACY_HTML));
legal.get("/terms", (c) => c.html(TERMS_HTML));
legal.get("/support", (c) => c.html(SUPPORT_HTML));
