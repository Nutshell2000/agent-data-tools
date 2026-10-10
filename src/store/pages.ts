import { SERVICE_NAME } from "../endpoints";
import { PRODUCTS, type Product } from "./catalog";
import { USDC_BASE } from "./chain";
import { formatUsdc, orderState, type Order } from "./orders";

const REPO = "https://github.com/Nutshell2000/agent-data-tools";

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

// Same palette and type scale as the service's home page.
const CSS = `
:root { --bg:#fbfaf7; --fg:#1d1b16; --muted:#6b665c; --line:#e3ded3; --accent:#0b6e4f; --code:#f1ede4; --on-accent:#ffffff; }
@media (prefers-color-scheme: dark) { :root { --bg:#15140f; --fg:#ece8dd; --muted:#a39d8f; --line:#2e2b23; --accent:#5fd0a5; --code:#221f18; --on-accent:#10130f; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif; }
main { max-width:760px; margin:0 auto; padding:32px 16px 64px; }
nav { font-size:0.92rem; margin-bottom:28px; }
h1 { font-size:2rem; margin:0 0 8px; letter-spacing:-0.01em; }
h2 { font-size:1.15rem; margin:32px 0 10px; }
p { margin:0 0 12px; }
.lead { color:var(--muted); font-size:1.05rem; }
a { color:var(--accent); }
ul { margin:0 0 12px; padding-left:20px; }
li { margin-bottom:6px; }
code { background:var(--code); padding:2px 6px; border-radius:4px; font:0.9em ui-monospace,Consolas,monospace; overflow-wrap:anywhere; }
.card { border:1px solid var(--line); border-radius:10px; padding:20px; margin:16px 0; }
.price { color:var(--accent); font-weight:700; font-size:1.4rem; }
button, .btn { display:inline-block; background:var(--accent); color:var(--on-accent); border:0; border-radius:8px; padding:12px 22px; font:600 1rem system-ui,sans-serif; cursor:pointer; text-decoration:none; }
button.small { padding:5px 10px; font-size:0.8rem; margin-left:8px; }
.field { margin:14px 0; }
.label { color:var(--muted); font-size:0.85rem; display:block; margin-bottom:4px; }
.value { font:1.05rem ui-monospace,Consolas,monospace; overflow-wrap:anywhere; }
.note, footer { color:var(--muted); font-size:0.9rem; }
.status { border-radius:8px; padding:12px 14px; background:var(--code); margin:18px 0; }
footer { border-top:1px solid var(--line); margin-top:40px; padding-top:16px; }
`;

function shell(title: string, description: string, body: string) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<style>${CSS}</style>
</head>
<body>
<main>
<nav><a href="/">${esc(SERVICE_NAME)}</a> / <a href="/store">Store</a></nav>
${body}
<footer>
<p>Digital downloads, delivered as soon as the payment is seen on chain. Payments are in USDC on Base and can't be reversed, so there are no automatic refunds. If a download is broken or not what was described, <a href="${REPO}/issues">open an issue</a> and we'll put it right.</p>
<p>Sold by the maintainer of ${esc(SERVICE_NAME)}. Contact: <a href="${REPO}/issues">${esc(REPO.replace("https://", ""))}/issues</a></p>
</footer>
</main>
</body>
</html>`;
}

export function storePage() {
  const cards = PRODUCTS.map(
    (p) => `<div class="card">
<h2 style="margin-top:0"><a href="/store/${esc(p.slug)}">${esc(p.title)}</a></h2>
<p>${esc(p.tagline)}</p>
<p><span class="price">$${p.priceUsd}</span> <span class="note">in USDC on Base</span></p>
<a class="btn" href="/store/${esc(p.slug)}">See what's inside</a>
</div>`,
  ).join("");
  return shell(
    `Store | ${SERVICE_NAME}`,
    "Digital products for developers building paid APIs for AI agents.",
    `<h1>Store</h1>
<p class="lead">Digital products for developers building paid APIs for AI agents. Pay in USDC, download straight away, no account.</p>
${cards}`,
  );
}

export function productPage(p: Product) {
  return shell(
    `${p.title} | ${SERVICE_NAME}`,
    p.tagline,
    `<h1>${esc(p.title)}</h1>
<p class="lead">${esc(p.tagline)}</p>
${p.description.map((d) => `<p>${esc(d)}</p>`).join("")}
<h2>What's inside</h2>
<ul>${p.includes.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
<div class="card">
<p><span class="price">$${p.priceUsd}</span> <span class="note">one-time, in USDC on Base</span></p>
<form method="post" action="/store/${esc(p.slug)}/order"><button type="submit">Buy with USDC</button></form>
<p class="note" style="margin:12px 0 0">You'll get an exact amount and an address. Send it from any wallet or exchange that supports USDC on Base, and the download unlocks by itself, usually within a minute.</p>
</div>
<p class="note">Agents can buy it too: <code>GET /buy/${esc(p.slug)}</code> with an x402 client.</p>`,
  );
}

export function orderPage(order: Order, p: Product, payTo: string) {
  const state = orderState(order);
  const amount = formatUsdc(order.amount);
  // EIP-681 link: lets a mobile wallet prefill the USDC transfer on Base.
  const walletLink = `ethereum:${USDC_BASE}@8453/transfer?address=${payTo}&uint256=${order.amount}`;
  const pay = `
<p>Send <strong>exactly</strong> this amount of <strong>USDC</strong> on the <strong>Base</strong> network. The last digits identify your order, so don't round it.</p>
<div class="card">
<div class="field"><span class="label">Amount (USDC)</span><span class="value" id="amount">${esc(amount)}</span><button class="small" data-copy="amount">Copy</button></div>
<div class="field"><span class="label">To address (Base network)</span><span class="value" id="address">${esc(payTo)}</span><button class="small" data-copy="address">Copy</button></div>
<p class="note" style="margin:0"><a href="${esc(walletLink)}">Open in a wallet app</a>. Sending on another network, or another token, will not unlock the order.</p>
</div>`;
  return shell(
    `Order | ${p.title}`,
    `Order for ${p.title}`,
    `<h1>${esc(p.title)}</h1>
<p class="note">Order <code>${esc(order.id.slice(0, 8))}</code>. Keep this page open, or bookmark it: this address is your receipt and your download link.</p>
<div id="pay" ${state === "waiting" ? "" : "hidden"}>${pay}</div>
<div class="status" id="status" aria-live="polite">${
      state === "paid" ? "Payment received." : state === "expired" ? "This order has expired. Start a new one from the product page." : "Waiting for your payment. This page checks every few seconds."
    }</div>
<p id="download" ${state === "paid" ? "" : "hidden"}><a class="btn" href="/order/${esc(order.id)}/download">Download ${esc(p.title)}</a></p>
<script>
document.querySelectorAll("[data-copy]").forEach(function (b) {
  b.addEventListener("click", function () {
    navigator.clipboard.writeText(document.getElementById(b.dataset.copy).textContent).then(function () {
      b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy"; }, 1500);
    });
  });
});
var state = ${JSON.stringify(state)};
function check() {
  if (state !== "waiting") return;
  fetch("/order/${esc(order.id)}/status").then(function (r) { return r.json(); }).then(function (s) {
    state = s.state;
    if (state === "paid") {
      document.getElementById("status").textContent = "Payment received.";
      document.getElementById("pay").hidden = true;
      document.getElementById("download").hidden = false;
    } else if (state === "expired") {
      document.getElementById("status").textContent = "This order has expired. Start a new one from the product page.";
      document.getElementById("pay").hidden = true;
    }
  }).catch(function () {});
}
setInterval(check, 8000);
</script>`,
  );
}
