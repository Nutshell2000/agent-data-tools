import { readerVerificationHtml } from "./reader-download";
export interface ReaderDemo {
  markdown: string;
  generatedAt: string;
  toolVersion: string;
}
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ]!,
  );

export async function loadReaderDemo(
  assets: { fetch: typeof fetch } | undefined,
  origin: string,
): Promise<ReaderDemo | undefined> {
  if (!assets) return;
  try {
    const response = await assets.fetch(
      new Request(`${origin}/examples/extract/technical-guide.json`),
    );
    if (!response.ok) return;
    const text = await response.text();
    if (text.length > 100000) return;
    const value = JSON.parse(text);
    if (
      value.demonstration !== true ||
      typeof value.result?.markdown !== "string" ||
      typeof value.generatedAt !== "string" ||
      typeof value.toolVersion !== "string"
    )
      return;
    return {
      markdown: value.result.markdown,
      generatedAt: value.generatedAt,
      toolVersion: value.toolVersion,
    };
  } catch {
    return;
  }
}

export function readerDemoHtml(demo?: ReaderDemo) {
  return `<section id="real-result"><h2>1. View a real result</h2><p>Actual build-time extraction of our <a href="/examples/extract/sources/technical-guide.html">owned technical guide</a>. A cached demonstration, not a customer purchase or receipt.</p>${demo ? `<p class="note">Extractor ${esc(demo.toolVersion)} · generated ${esc(demo.generatedAt)}. Returned Markdown, including code and table output:</p><pre><code>${esc(demo.markdown)}</code></pre>` : '<p><a href="/examples/extract/technical-guide.json">Open the cached technical-guide result</a>.</p>'}<p><a href="/examples/extract/">All three real examples, sources and hashes</a></p></section>`;
}

export function readerBuyingHtml(
  origin: string,
  version: string,
  demo?: ReaderDemo,
) {
  return `<p>Read a public documentation page as clean text, Markdown, code and tables for <strong>$0.002 USDC on Base</strong> per successful call.</p><p>Static public HTML/plain text only. No JavaScript rendering, authenticated pages or paywall access. Input up to 2 MiB; output defaults to 20,000 characters, maximum 100,000, with explicit truncation.</p><nav aria-label="Reader buying steps"><a href="#real-result">View a real result</a> → <a href="#reader-builder">Inspect a free quote</a> → <a href="#buy-one-page">Buy one page</a></nav>${readerDemoHtml(demo)}
<section id="reader-builder" data-origin="${esc(origin)}"><h2>2. Inspect a free quote</h2><p>Build commands locally. This page sends nothing as you type, accepts no wallet keys and performs no extraction or signing. Only opening the quote link sends the selected public URL to our service for an unpaid 402 quote.</p>
<p><label>Public page URL <input id="reader-url" type="url" value="https://example.com" autocomplete="off" spellcheck="false"></label></p>
<p><label for="reader-format">Output</label> <select id="reader-format"><option value="markdown" selected>Markdown</option><option value="text">Text</option><option value="both">Both</option></select> <label>Character limit <input id="reader-limit" type="number" value="20000" min="500" max="100000" step="1"></label> <label for="reader-shell">Shell</label> <select id="reader-shell"><option value="posix">POSIX shell (macOS/Linux)</option><option value="powershell">PowerShell (Windows)</option></select></p>
<p><label>Section ID (optional) <input id="reader-section" type="text" maxlength="500" value="" autocomplete="off" spellcheck="false"></label> Use an exact visible heading/container ID from the source, without the # prefix. Blank reads the primary content. URL fragments alone do not select sections.</p><p id="reader-builder-error" role="status" aria-live="polite"></p><div id="reader-builder-output" hidden><p><a id="reader-quote-link" rel="nofollow">Open unpaid quote</a> — expect HTTP 402, not page content.</p><p>Or quote with the downloaded CLI:</p><button type="button" data-copy="reader-quote-command">Copy quote command</button><pre><code id="reader-quote-command"></code></pre>
<h2 id="buy-one-page">3. Buy one page</h2><p><a href="/clients/reader/${esc(version)}/reader-client.mjs" download>Download reader-client.mjs</a> · <a href="/clients/reader/${esc(version)}/reader-client.mjs.sha256" download>Checksum for this executable</a> · <a href="https://github.com/Nutshell2000/agent-data-tools/tree/main/clients">Public source</a>. Requires Node.js 20.19+; no package installation. Verify the checksum before running.</p>${readerVerificationHtml("reader-client.mjs")}<p>Use your existing funded Base wallet. Configure <code>X402_PRIVATE_KEY</code> privately in your local process environment; never paste it into this page. Each explicit buy invocation can authorize one payment capped at $0.002. An uncertain signed outcome must be reconciled before another purchase.</p><button type="button" data-copy="reader-buy-command">Copy buy command</button><pre><code id="reader-buy-command"></code></pre></div><noscript><p>JavaScript is disabled. Use the <a href="/guides/web-reading.md">plain-text CLI instructions</a>; no input is submitted by this page.</p></noscript></section><p>Need a late section? Use the optional exact section ID above. <a href="/examples/extract/section-result.json">View a real section result from our long example</a>; missing or ambiguous IDs fail uncharged. A selected result covers that scope, not the entire page.</p><p>Using an MCP agent? <a href="/guides/local-mcp">Download the local MCP adapter</a> for unsigned quotes and explicitly enabled, capped purchases without writing a client. Buying is disabled by default.</p><script type="module" src="/clients/reader/${esc(version)}/command-builder.js"></script>`;
}
