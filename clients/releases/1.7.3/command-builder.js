var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// src/lib/env.ts
var HttpError;
var init_env = __esm({
  "src/lib/env.ts"() {
    "use strict";
    HttpError = class extends Error {
      constructor(status, message, code) {
        super(message);
        this.status = status;
        this.code = code;
      }
      status;
      code;
    };
  }
});

// src/lib/fetch.ts
function parseTarget(raw) {
  if (!raw) throw new HttpError(400, "missing required query parameter: url");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, "url must be an absolute http(s) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new HttpError(400, "only http and https URLs are supported");
  if (url.username || url.password) throw new HttpError(400, "URLs with credentials are not supported");
  if (url.port) throw new HttpError(400, "only standard HTTP and HTTPS ports are supported");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const ipv4 = /^\d+\.\d+\.\d+\.\d+$/.test(host) ? host.split(".").map(Number) : null;
  const privateHost = host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.startsWith("[") || /^(0|10|127)\./.test(host) || /^169\.254\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || Boolean(ipv4 && (ipv4[0] === 100 && ipv4[1] >= 64 && ipv4[1] <= 127 || ipv4[0] === 198 && (ipv4[1] === 18 || ipv4[1] === 19) || ipv4[0] >= 224)) || !host.includes(".");
  if (privateHost) throw new HttpError(400, "private, loopback and IPv6-literal hosts are not supported");
  return url;
}
var init_fetch = __esm({
  "src/lib/fetch.ts"() {
    "use strict";
    init_env();
  }
});

// src/guides/reader-commands.ts
function readerCommands(origin, raw, format = "markdown", maxChars = "20000", shell = "posix", section = "") {
  if (raw.length > 8192 || /[\u0000-\u001f\u007f]/.test(raw))
    throw new Error("Use a public HTTP(S) URL without control characters.");
  const target = parseTarget(raw).href;
  if (!["text", "markdown", "both"].includes(format))
    throw new Error("Choose text, markdown or both.");
  if (!/^\d+$/.test(maxChars) || +maxChars < 500 || +maxChars > 1e5)
    throw new Error("Character limit must be an integer from 500 to 100000.");
  if (shell !== "posix" && shell !== "powershell")
    throw new Error("Choose POSIX shell or PowerShell.");
  if (section.length > 500 || /[\u0000-\u001f\u007f]/.test(section))
    throw new Error("Section ID must be at most 500 characters without control characters.");
  const shellQuote = (value) => "'" + value.replace(/'/g, shell === "powershell" ? "''" : `'"'"'`) + "'";
  const quoted = shellQuote(target);
  const options = ` --format ${format} --max-chars ${Number(maxChars)}` + (section ? ` --section ${shellQuote(section)}` : "");
  const quote = new URL("/extract", origin);
  quote.search = new URLSearchParams({
    url: target,
    format,
    maxChars: String(Number(maxChars))
  }).toString();
  if (section) quote.searchParams.set("section", section);
  return {
    quoteUrl: quote.href,
    quoteCommand: `node reader-client.mjs quote ${quoted}${options}`,
    buyCommand: `node reader-client.mjs buy ${quoted} --max-usdc 0.002${options}`
  };
}
var init_reader_commands = __esm({
  "src/guides/reader-commands.ts"() {
    "use strict";
    init_fetch();
  }
});

// clients/reader-command-builder.ts
var require_reader_command_builder = __commonJS({
  "clients/reader-command-builder.ts"() {
    init_reader_commands();
    var panel = document.getElementById("reader-builder");
    if (panel) {
      const input = (id) => document.getElementById(id);
      const quote = document.getElementById(
        "reader-quote-link"
      );
      const error = document.getElementById("reader-builder-error");
      const output = document.getElementById("reader-builder-output");
      const update = () => {
        try {
          const commands = readerCommands(
            panel.dataset.origin,
            input("reader-url").value,
            input("reader-format").value,
            input("reader-limit").value,
            input("reader-shell").value,
            input("reader-section").value
          );
          quote.href = commands.quoteUrl;
          document.getElementById("reader-quote-command").textContent = commands.quoteCommand;
          document.getElementById("reader-buy-command").textContent = commands.buyCommand;
          output.hidden = false;
          error.textContent = "";
        } catch (e) {
          output.hidden = true;
          quote.removeAttribute("href");
          document.getElementById("reader-quote-command").textContent = "";
          document.getElementById("reader-buy-command").textContent = "";
          error.textContent = e instanceof Error ? e.message : "Check the URL and options.";
        }
      };
      for (const id of [
        "reader-url",
        "reader-format",
        "reader-limit",
        "reader-shell",
        "reader-section"
      ])
        document.getElementById(id).addEventListener("input", update);
      for (const button of panel.querySelectorAll(
        "button[data-copy]"
      ))
        button.addEventListener("click", async () => {
          const text = document.getElementById(button.dataset.copy).textContent;
          if (!text || output.hidden) return;
          try {
            await navigator.clipboard.writeText(text);
            button.textContent = "Copied";
          } catch {
            button.textContent = "Select and copy the command below";
          }
        });
      update();
    }
  }
});
export default require_reader_command_builder();
