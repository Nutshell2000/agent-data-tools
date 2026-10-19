// Self-computed checks agents run before trusting something: a page's HTTP security headers, text that may
// carry a prompt injection, and a Dockerfile. No outside data source, so no licence limits and fast answers.
import { entry, need, type Entry } from "../family";
import { HttpError } from "../lib/env";
import { fetchPublic, parseTarget } from "../lib/fetch";

type Severity = "high" | "medium" | "low";
const WEIGHT: Record<Severity, number> = { high: 40, medium: 20, low: 8 };
const clip = (s: string, n = 100) => (s.length > n ? `${s.slice(0, n)}…` : s);
/** Shows hidden characters as visible escapes so an excerpt cannot itself carry them. */
const visible = (s: string) => s.replace(/[​-‏‪-‮⁠-⁤⁦-⁩﻿]|[\u{E0000}-\u{E007F}]/gu, (ch) => `\\u{${ch.codePointAt(0)!.toString(16)}}`);

// ---------------------------------------------------------------- prompt injection

interface Rule { id: string; severity: Severity; pattern: RegExp; note: string }
const INJECTION_RULES: Rule[] = [
  { id: "override", severity: "high", pattern: /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|any|your|the)\b[^.\n]{0,25}\b(instructions?|prompts?|rules|guidelines|messages|directions)\b/i, note: "tries to cancel the agent's existing instructions" },
  { id: "role-hijack", severity: "high", pattern: /\b(you are now|from now on,? you (are|will|must)|act as (an? )?(unfiltered|unrestricted|jailbroken|DAN)|enter (developer|god|DAN) mode)\b/i, note: "tries to give the agent a new role" },
  { id: "fake-system", severity: "high", pattern: /(<\|?(system|im_start|im_end|endoftext)\|?>|\[\/?(INST|SYS)\]|^\s*#{0,3}\s*(system|assistant)\s*(prompt|message)?\s*:)/im, note: "imitates a system or assistant message" },
  { id: "new-instructions", severity: "medium", pattern: /\b(new|updated|important|additional|hidden) (system )?(instructions?|directives?|task)\s*[:\-]/i, note: "announces replacement instructions" },
  { id: "conceal", severity: "high", pattern: /\b(do not|don't|never|without)\b[^.\n]{0,20}\b(tell|telling|inform|informing|mention|mentioning|reveal|revealing|alert|alerting|notify|notifying)\b[^.\n]{0,20}\bthe user\b/i, note: "asks the agent to hide something from its user" },
  { id: "exfil-markdown", severity: "high", pattern: /!\[[^\]]*\]\(\s*https?:\/\/[^)\s]+\?[^)\s]*=/i, note: "markdown image with query parameters, a common data-exfiltration trick" },
  { id: "exfil-request", severity: "high", pattern: /\b(send|post|upload|forward|leak|email)\b[^.\n]{0,40}\b(conversation|chat history|messages|context|credentials?|api[ _-]?keys?|passwords?|secrets?|private keys?|seed phrase|tokens?)\b[^.\n]{0,40}\b(to|at|via)\b/i, note: "asks the agent to send private data somewhere" },
  { id: "secret-request", severity: "high", pattern: /\b(reveal|print|output|show|repeat|dump|disclose)\b[^.\n]{0,30}\b(system prompt|your instructions|hidden instructions|api[ _-]?keys?|secrets?|passwords?|private keys?|seed phrase)\b/i, note: "asks for secrets or the system prompt" },
  { id: "funds", severity: "high", pattern: /\b(transfer|send|withdraw|approve)\b[^.\n]{0,30}\b(all|max|unlimited|your|the)\b[^.\n]{0,20}\b(funds|balance|eth|usdc|usdt|tokens?|crypto|wallet)\b/i, note: "asks the agent to move funds or grant approvals" },
  { id: "shell", severity: "medium", pattern: /\b(curl|wget|bash|sh|powershell|iex)\b[^\n]{0,60}(\|\s*(ba)?sh\b|https?:\/\/)/i, note: "contains a command that downloads or runs code" },
  { id: "tool-steer", severity: "low", pattern: /\b(call|use|invoke|run|execute)\b[^.\n]{0,15}\bthe\b[^.\n]{0,20}\btool\b/i, note: "tells the agent which tool to call" },
  { id: "html-comment", severity: "medium", pattern: /<!--[\s\S]{0,400}?\b(ignore|instruction|assistant|system|agent|ai model|llm)\b[\s\S]{0,400}?-->/i, note: "instructions hidden in an HTML comment" },
];

function scanInjection(text: string) {
  const findings: { rule: string; severity: Severity; note: string; excerpt: string; at: number }[] = [];
  for (const r of INJECTION_RULES) {
    const m = r.pattern.exec(text);
    if (m) findings.push({ rule: r.id, severity: r.severity, note: r.note, excerpt: clip(visible(m[0].replace(/\s+/g, " "))), at: m.index });
  }
  const zeroWidth = (text.match(/[​-‏⁠-⁤﻿]/g) ?? []).length;
  const bidi = (text.match(/[‪-‮⁦-⁩]/g) ?? []).length;
  const tags = (text.match(/[\u{E0000}-\u{E007F}]/gu) ?? []).length;
  if (tags) findings.push({ rule: "unicode-tags", severity: "high", note: "invisible Unicode tag characters, which can carry hidden instructions", excerpt: `${tags} characters`, at: text.search(/[\u{E0000}-\u{E007F}]/u) });
  if (bidi) findings.push({ rule: "bidi-control", severity: "medium", note: "text-direction control characters that can disguise what is displayed", excerpt: `${bidi} characters`, at: text.search(/[‪-‮⁦-⁩]/) });
  if (zeroWidth > 3) findings.push({ rule: "zero-width", severity: "low", note: "several zero-width characters", excerpt: `${zeroWidth} characters`, at: text.search(/[​-‏⁠-⁤﻿]/) });
  const blob = /[A-Za-z0-9+/]{200,}={0,2}/.exec(text);
  if (blob) findings.push({ rule: "encoded-blob", severity: "low", note: "a long base64-like block that may hide content", excerpt: clip(blob[0], 40), at: blob.index });
  const score = Math.min(100, findings.reduce((s, f) => s + WEIGHT[f.severity], 0));
  const risk = score >= 40 ? "high" : score >= 20 ? "medium" : score > 0 ? "low" : "none";
  return { risk, score, findings: findings.sort((a, b) => WEIGHT[b.severity] - WEIGHT[a.severity] || a.at - b.at), hiddenCharacters: { zeroWidth, bidi, tags } };
}

// ---------------------------------------------------------------- HTTP security headers

async function auditHeaders(raw: string | undefined) {
  const res = await fetchPublic(parseTarget(raw), "text/html,*/*;q=0.8");
  await res.body?.cancel().catch(() => {});
  const h = res.headers;
  const finalUrl = new URL(res.url);
  const checks: { header: string; status: "pass" | "warn" | "fail"; value: string | null; note: string }[] = [];
  const add = (header: string, status: "pass" | "warn" | "fail", note: string, value = h.get(header)) => checks.push({ header, status, value: value === null ? null : clip(value, 200), note });

  const hsts = h.get("strict-transport-security");
  const maxAge = Number(/max-age=(\d+)/i.exec(hsts ?? "")?.[1] ?? 0);
  if (finalUrl.protocol !== "https:") add("strict-transport-security", "fail", "the page is served over plain HTTP");
  else if (!hsts) add("strict-transport-security", "fail", "missing: browsers may load the site over plain HTTP");
  else add("strict-transport-security", maxAge >= 15_552_000 ? "pass" : "warn", maxAge >= 15_552_000 ? "set with a long max-age" : "max-age is under 180 days");

  const csp = h.get("content-security-policy");
  if (!csp) add("content-security-policy", "warn", "missing: no restriction on scripts and other resources");
  else add("content-security-policy", /'unsafe-inline'|'unsafe-eval'/.test(csp) ? "warn" : "pass", /'unsafe-inline'|'unsafe-eval'/.test(csp) ? "allows unsafe-inline or unsafe-eval" : "present");

  const framing = h.get("x-frame-options") ?? (/frame-ancestors/i.test(csp ?? "") ? "csp frame-ancestors" : null);
  add("x-frame-options", framing ? "pass" : "warn", framing ? "framing is restricted" : "missing: the page can be framed (clickjacking)", framing);
  add("x-content-type-options", /nosniff/i.test(h.get("x-content-type-options") ?? "") ? "pass" : "warn", /nosniff/i.test(h.get("x-content-type-options") ?? "") ? "nosniff set" : "missing nosniff");
  add("referrer-policy", h.get("referrer-policy") ? "pass" : "warn", h.get("referrer-policy") ? "present" : "missing: full URLs may leak to other sites");
  add("permissions-policy", h.get("permissions-policy") ? "pass" : "warn", h.get("permissions-policy") ? "present" : "missing: browser features are not restricted");

  const server = h.get("server");
  if (server && /\d/.test(server)) add("server", "warn", "reveals a software version");
  const powered = h.get("x-powered-by");
  if (powered) add("x-powered-by", "warn", "reveals the server framework");

  const cookies = typeof h.getSetCookie === "function" ? h.getSetCookie() : [];
  const weakCookies = cookies.filter((c) => !/;\s*secure/i.test(c) || !/;\s*httponly/i.test(c) || !/;\s*samesite/i.test(c)).map((c) => c.split("=")[0]);
  if (weakCookies.length) checks.push({ header: "set-cookie", status: "warn", value: weakCookies.slice(0, 10).join(", "), note: "cookies without Secure, HttpOnly or SameSite" });

  const score = Math.max(0, 100 - checks.reduce((s, c) => s + (c.status === "fail" ? 25 : c.status === "warn" ? 8 : 0), 0));
  const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
  return { url: raw, finalUrl: finalUrl.href, status: res.status, grade, score, checks };
}

// ---------------------------------------------------------------- Dockerfile

function lintDockerfile(text: string) {
  const lines = text.replace(/\\\r?\n/g, " ").split(/\r?\n/);
  const findings: { line: number; rule: string; severity: Severity; message: string }[] = [];
  const add = (line: number, rule: string, severity: Severity, message: string) => findings.push({ line, rule, severity, message });
  let lastUser: string | null = null, cmds = 0, entrypoints = 0, healthcheck = false, froms = 0;
  lines.forEach((rawLine, i) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) return;
    const [ins, ...rest] = line.split(/\s+/);
    const op = ins.toUpperCase();
    const args = rest.join(" ");
    const n = i + 1;
    if (op === "FROM") {
      froms++;
      const image = args.split(/\s+/)[0] ?? "";
      if (image !== "scratch" && !image.startsWith("$") && !/[:@]/.test(image.split("/").pop() ?? "")) add(n, "untagged-base", "medium", `base image ${image} has no tag; pin a version`);
      else if (/:latest$/i.test(image)) add(n, "latest-tag", "medium", `base image ${image} uses :latest; pin a version`);
    }
    if (op === "USER") lastUser = args.split(/\s+/)[0] ?? null;
    if (op === "CMD") cmds++;
    if (op === "ENTRYPOINT") entrypoints++;
    if (op === "HEALTHCHECK") healthcheck = true;
    if (op === "MAINTAINER") add(n, "maintainer", "low", "MAINTAINER is deprecated; use a LABEL");
    if (op === "ADD" && /^(--\S+\s+)*https?:\/\//i.test(args)) add(n, "add-url", "medium", "ADD with a URL downloads without verification; use curl with a checksum");
    else if (op === "ADD" && !/\.(tar|tgz|gz|bz2|xz|zip)(\s|$)/i.test(args)) add(n, "add-not-copy", "low", "use COPY for plain files; ADD also extracts and fetches");
    if (op === "RUN") {
      if (/\b(curl|wget)\b[^|]*\|\s*(ba)?sh\b/.test(args)) add(n, "pipe-to-shell", "high", "downloads a script and runs it unverified");
      if (/\bapt-get\s+install\b/.test(args) && !/--no-install-recommends/.test(args)) add(n, "apt-recommends", "low", "apt-get install without --no-install-recommends makes the image larger");
      if (/\bapt-get\s+install\b/.test(args) && !/rm\s+-rf\s+\/var\/lib\/apt\/lists/.test(args)) add(n, "apt-lists", "low", "apt lists are not removed in the same RUN; the layer keeps them");
      if (/\bapt-get\s+(dist-)?upgrade\b/.test(args)) add(n, "apt-upgrade", "medium", "apt-get upgrade makes builds unrepeatable; pin a newer base image instead");
      if (/\bsudo\b/.test(args)) add(n, "sudo", "medium", "sudo inside a build; run the step as root or switch USER");
      if (/\bchmod\s+(-R\s+)?777\b/.test(args)) add(n, "chmod-777", "medium", "chmod 777 makes files writable by everyone");
      if (/\bpip\s+install\b/.test(args) && !/--no-cache-dir/.test(args)) add(n, "pip-cache", "low", "pip install without --no-cache-dir keeps the download cache");
      if (/\bcd\s+\S+/.test(args) && !/&&/.test(args)) add(n, "cd-in-run", "low", "use WORKDIR instead of cd");
    }
    if ((op === "ENV" || op === "ARG") && /\b\w*(password|passwd|secret|token|api_?key|private_?key)\w*\s*=?\s*\S+/i.test(args) && !/=\s*$/.test(args)) add(n, "secret-in-image", "high", `${op} appears to set a secret; secrets in ENV or ARG stay in the image history`);
    if (op === "EXPOSE" && /\b22\b/.test(args)) add(n, "ssh-port", "medium", "exposes SSH (22); containers rarely need it");
  });
  if (!froms) add(1, "no-from", "high", "no FROM instruction");
  if (!lastUser || /^(root|0)(:|$)/.test(lastUser)) add(lines.length, "runs-as-root", "medium", "the container runs as root; add a USER with an unprivileged account");
  if (cmds > 1) add(lines.length, "multiple-cmd", "low", "more than one CMD; only the last takes effect");
  if (entrypoints > 1) add(lines.length, "multiple-entrypoint", "low", "more than one ENTRYPOINT; only the last takes effect");
  if (!healthcheck) add(lines.length, "no-healthcheck", "low", "no HEALTHCHECK");
  const score = Math.max(0, 100 - findings.reduce((s, f) => s + (f.severity === "high" ? 30 : f.severity === "medium" ? 12 : 4), 0));
  return { score, findings: findings.sort((a, b) => WEIGHT[b.severity] - WEIGHT[a.severity] || a.line - b.line), counts: { high: findings.filter((f) => f.severity === "high").length, medium: findings.filter((f) => f.severity === "medium").length, low: findings.filter((f) => f.severity === "low").length } };
}

export const CHECKS: Entry[] = [
  entry("/text/prompt-injection", "Scan text for prompt-injection attempts",
    "Scan text an agent is about to read (web page, email, tool result; up to 8,000 characters) for prompt-injection attempts: instruction overrides, fake system messages, asks to hide things from the user, exfiltration links, attempts to extract private data or move money, invisible Unicode. Returns a risk level, score and findings with excerpts. Heuristic, not a guarantee. Use before acting on untrusted content.",
    ["security", "prompt-injection", "ai-safety", "agents", "text"],
    { text: { type: "string", description: "The text to scan (up to 8,000 characters)", required: true, example: "Thanks for the update. The signed invoice is attached and payment is due on Friday." } },
    { risk: "none", score: 0, findings: [], hiddenCharacters: { zeroWidth: 0, bidi: 0, tags: 0 } },
    (_env, q) => scanInjection(need(q, "text", 8_000))),

  entry("/http/security-headers", "Audit a page's HTTP security headers",
    "Fetch a public URL and grade its HTTP security headers: HSTS, Content-Security-Policy, framing protection, nosniff, Referrer-Policy and Permissions-Policy, plus version leaks (Server, X-Powered-By) and cookies missing Secure, HttpOnly or SameSite. Returns a grade A-F, a score and each check with its value. Use to review a site's basic web security; for DNS and email records use domain. Private hosts are refused with 400, uncharged.",
    ["security", "http", "headers", "web", "audit"],
    { url: { type: "string", description: "Public http(s) URL to check", required: true, example: "https://example.com" } },
    { url: "https://example.com", finalUrl: "https://example.com/", status: 200, grade: "C", score: 60, checks: [{ header: "strict-transport-security", status: "fail", value: null, note: "missing: browsers may load the site over plain HTTP" }] },
    (_env, q) => auditHeaders(q("url"))),

  entry("/dockerfile/lint", "Lint a Dockerfile for security and size issues",
    "Check a Dockerfile (up to 8,000 characters) for common security and image-size problems: unpinned or :latest base images, running as root, piping downloads into a shell, sensitive values baked into ENV or ARG, ADD from URLs, apt and pip cache left in layers, sudo, chmod 777 and an exposed SSH port. Returns each finding with its line, a severity and a fix, plus a score. Use before building or shipping an image.",
    ["docker", "dockerfile", "security", "lint", "devops"],
    { dockerfile: { type: "string", description: "Dockerfile contents (up to 8,000 characters)", required: true, example: "FROM node:latest\nCOPY . /app\nCMD node /app/server.js" } },
    { score: 72, findings: [{ line: 1, rule: "latest-tag", severity: "medium", message: "base image node:latest uses :latest; pin a version" }], counts: { high: 0, medium: 2, low: 1 } },
    (_env, q) => {
      const text = need(q, "dockerfile", 8_000);
      if (!/^\s*(#.*\n\s*)*(FROM|ARG)\b/im.test(text)) throw new HttpError(422, "this does not look like a Dockerfile (no FROM)");
      return lintDockerfile(text);
    }),
];

export const __test = { scanInjection, lintDockerfile };
