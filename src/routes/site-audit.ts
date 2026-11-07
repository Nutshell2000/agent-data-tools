// Website audit in a real browser (1.101.0, 7 Nov 2026). Why: the busiest open shopper on Base (0x72c5…, $190 a week over
// ~190 sellers) bought 522 single-URL "full website audit" calls in 7 days at $0.15 each from one seller; ours is $0.01 (owner's rule, 25 Oct: every tool at most $0.01; browser time is about $0.0003 a call) (accessibility via
// axe-core, on-page SEO, security headers and page speed from one browser load). /pack/website-audit reads server HTML only
// and has no accessibility or speed, so it cannot answer that task.
// One hosted-browser load (lib/browser.ts: SSRF guard on every request, daily browser cap, 15 s navigation budget) gives:
// WCAG 2.1 A/AA violations from axe-core (bundled, src/data/axe-source.generated.ts, MPL-2.0 unmodified), navigation and
// paint timings, layout shift and page weight, and the SEO audit on the rendered DOM. Security headers come from a plain
// fetch of the same URL in parallel (checks.ts). Capacity-limited: never in the free calls.
import { AXE_SOURCE, AXE_VERSION } from "../data/axe-source.generated";
import { entry, need, type Entry } from "../family";
import { withBrowserPage } from "../lib/browser";
import { HttpError, type Env } from "../lib/env";
import { auditHeaders } from "./checks";
import { seoAudit } from "./web-checks";

const VIEWPORT = { width: 1366, height: 900 };
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const IMPACTS = ["critical", "serious", "moderate", "minor"] as const;
type Impact = (typeof IMPACTS)[number];

export interface AxeRaw { violations: { id: string; impact: string | null; help: string; helpUrl: string; tags: string[]; nodes: number; targets: string[] }[]; passes: number; incomplete: number }
export interface PerfRaw {
  ttfb: number | null; dcl: number | null; load: number | null; fcp: number | null; lcp: number | null; cls: number;
  navBytes: number; resources: { type: string; bytes: number; thirdParty: boolean }[]; domElements: number;
}

/** WCAG result: violations by impact, a 0-100 score (rules, not nodes, so one repeated issue does not zero it). */
export function accessibilityReport(raw: AxeRaw) {
  const weight: Record<Impact, number> = { critical: 15, serious: 8, moderate: 3, minor: 1 };
  const bySeverity: Record<Impact, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  const rank = (i: string | null) => { const n = IMPACTS.indexOf((i ?? "minor") as Impact); return n < 0 ? 3 : n; };
  const violations = raw.violations.slice().sort((a, b) => rank(a.impact) - rank(b.impact) || b.nodes - a.nodes);
  for (const v of violations) bySeverity[IMPACTS[rank(v.impact)]]++;
  const score = Math.max(0, 100 - violations.reduce((s, v) => s + weight[IMPACTS[rank(v.impact)]], 0));
  return {
    standard: "WCAG 2.1 A and AA (axe-core automated rules)",
    engine: `axe-core ${AXE_VERSION}`,
    score,
    violations: violations.length,
    affectedElements: violations.reduce((s, v) => s + v.nodes, 0),
    bySeverity,
    passedRules: raw.passes,
    needsReview: raw.incomplete,
    issues: violations.slice(0, 25).map((v) => ({ rule: v.id, impact: v.impact ?? "minor", help: v.help, wcag: v.tags, elements: v.nodes, examples: v.targets, helpUrl: v.helpUrl })),
    note: "Automated rules find about a third to a half of WCAG problems; keyboard use, reading order and content still need a person.",
  };
}

const ms = (v: number | null) => (v == null || !Number.isFinite(v) || v <= 0 ? null : Math.round(v));

/** Speed and weight, with plain thresholds (Core Web Vitals "good" limits for LCP and CLS). */
export function performanceReport(raw: PerfRaw) {
  const byType: Record<string, { requests: number; bytes: number }> = {};
  let bytes = raw.navBytes, thirdParty = 0;
  for (const r of raw.resources) {
    const t = r.type || "other";
    byType[t] ??= { requests: 0, bytes: 0 };
    byType[t].requests++; byType[t].bytes += r.bytes; bytes += r.bytes;
    if (r.thirdParty) thirdParty++;
  }
  const requests = raw.resources.length + 1;
  const lcp = ms(raw.lcp), fcp = ms(raw.fcp), ttfb = ms(raw.ttfb);
  const cls = Math.round(raw.cls * 1000) / 1000;
  const issues: string[] = [];
  let score = 100;
  const hit = (cond: boolean, points: number, text: string) => { if (cond) { score -= points; issues.push(text); } };
  hit(lcp != null && lcp > 4000, 30, `largest contentful paint ${lcp} ms (poor: over 4,000)`);
  hit(lcp != null && lcp > 2500 && lcp <= 4000, 15, `largest contentful paint ${lcp} ms (needs improvement: over 2,500)`);
  hit(cls > 0.25, 20, `layout shift ${cls} (poor: over 0.25)`);
  hit(cls > 0.1 && cls <= 0.25, 10, `layout shift ${cls} (needs improvement: over 0.1)`);
  hit(ttfb != null && ttfb > 800, 10, `server response ${ttfb} ms (over 800)`);
  hit(bytes > 4_000_000, 15, `page weight ${(bytes / 1e6).toFixed(1)} MB (over 4 MB)`);
  hit(bytes > 2_000_000 && bytes <= 4_000_000, 8, `page weight ${(bytes / 1e6).toFixed(1)} MB (over 2 MB)`);
  hit(requests > 120, 10, `${requests} requests (over 120)`);
  hit(raw.domElements > 3000, 5, `${raw.domElements} DOM elements (over 3,000)`);
  return {
    score: Math.max(0, score),
    timeToFirstByteMs: ttfb,
    firstContentfulPaintMs: fcp,
    largestContentfulPaintMs: lcp,
    domContentLoadedMs: ms(raw.dcl),
    loadMs: ms(raw.load),
    cumulativeLayoutShift: cls,
    requests,
    thirdPartyRequests: thirdParty,
    transferBytes: bytes,
    byType,
    domElements: raw.domElements,
    issues,
    note: "One load from a data centre on a desktop viewport, not field data. Bytes of other sites count only where they allow timing (Timing-Allow-Origin).",
  };
}

// Evaluated inside the page (strings, because this project has no DOM types).
const AXE_RUN = `(async () => {
  const run = axe.run(document, { runOnly: { type: "tag", values: ${JSON.stringify(AXE_TAGS)} }, resultTypes: ["violations"] });
  const r = await Promise.race([run, new Promise((_, no) => setTimeout(() => no(new Error("axe timeout")), 12000))]);
  return JSON.stringify({
    violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl,
      tags: v.tags.filter((t) => /^wcag\\d/.test(t)), nodes: v.nodes.length,
      targets: v.nodes.slice(0, 3).map((n) => String((n.target && n.target[0]) || "").slice(0, 120)) })),
    passes: r.passes.length, incomplete: r.incomplete.length });
})()`;
const PERF_READ = `(async () => {
  const nav = performance.getEntriesByType("navigation")[0] || {};
  const paint = {}; for (const p of performance.getEntriesByType("paint")) paint[p.name] = p.startTime;
  const read = (type) => new Promise((done) => { try { const got = []; const o = new PerformanceObserver((l) => got.push(...l.getEntries()));
    o.observe({ type, buffered: true }); setTimeout(() => { o.disconnect(); done(got); }, 150); } catch { done([]); } });
  const lcp = await read("largest-contentful-paint"); const shifts = await read("layout-shift");
  const host = location.hostname.split(".").slice(-2).join(".");
  return JSON.stringify({ ttfb: nav.responseStart ?? null, dcl: nav.domContentLoadedEventEnd ?? null, load: nav.loadEventEnd ?? null,
    fcp: paint["first-contentful-paint"] ?? null, lcp: lcp.length ? lcp[lcp.length - 1].startTime : null,
    cls: shifts.filter((s) => !s.hadRecentInput).reduce((a, s) => a + s.value, 0), navBytes: nav.transferSize || nav.encodedBodySize || 0,
    resources: performance.getEntriesByType("resource").map((e) => { let h = ""; try { h = new URL(e.name).hostname; } catch {}
      return { type: e.initiatorType, bytes: e.transferSize || e.encodedBodySize || 0, thirdParty: !!h && !h.endsWith(host) }; }),
    domElements: document.getElementsByTagName("*").length });
})()`;

export async function websiteAudit(env: Env, rawUrl: string) {
  const headers = auditHeaders(rawUrl).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
  const page = await withBrowserPage(env, new URL(rawUrl), VIEWPORT, async (p, status) => {
    if (status !== null && status >= 400) throw new HttpError(422, `the page answered HTTP ${status}`);
    const perf = JSON.parse(String(await p.evaluate(PERF_READ))) as PerfRaw;
    const html = String(await p.content());
    const finalUrl = p.url();
    await p.evaluate(AXE_SOURCE);
    let axe: AxeRaw | null = null, axeError: string | null = null;
    try { axe = JSON.parse(String(await p.evaluate(AXE_RUN))) as AxeRaw; }
    catch (e) { axeError = /timeout/i.test(String(e)) ? "the accessibility scan did not finish within 12 seconds" : "the accessibility scan failed on this page"; }
    return { status, finalUrl, title: await p.title(), perf, html, axe, axeError };
  });
  const security = await headers;
  const accessibility = page.axe ? accessibilityReport(page.axe) : null;
  const performance = performanceReport(page.perf);
  const seo = seoAudit(page.html, page.finalUrl);
  const sec = "error" in security ? null : { grade: security.grade, score: security.score, missing: security.checks.filter((c) => c.status !== "pass").map((c) => c.header), checks: security.checks };
  const parts = [accessibility?.score, performance.score, seo.score, sec?.score].filter((s): s is number => typeof s === "number");
  const overall = Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
  const top = [
    ...(accessibility?.issues.filter((i) => i.impact === "critical" || i.impact === "serious").slice(0, 3).map((i) => `accessibility: ${i.help} (${i.elements} elements)`) ?? []),
    ...performance.issues.slice(0, 2).map((i) => `speed: ${i}`),
    ...seo.issues.slice(0, 3).map((i) => `seo: ${i}`),
    ...(sec?.checks.filter((c) => c.status === "fail").slice(0, 2).map((c) => `security: ${c.header} ${c.note}`) ?? []),
  ];
  return {
    url: rawUrl, finalUrl: page.finalUrl, status: page.status, title: page.title,
    score: overall, grade: overall >= 90 ? "A" : overall >= 75 ? "B" : overall >= 60 ? "C" : overall >= 40 ? "D" : "F",
    topIssues: top,
    accessibility: accessibility ?? { error: page.axeError },
    performance,
    seo,
    security: sec ?? { error: (security as { error: string }).error },
    auditedAt: new Date().toISOString(),
  };
}

export const SITE_AUDIT: Entry[] = [
  entry("/audit/website", "Website audit: accessibility (WCAG), SEO, security headers and page speed",
    "Full website audit of one URL from a single load in a real browser: WCAG 2.1 A/AA accessibility violations with axe-core (rule, impact, elements, fix link), page speed (first byte, FCP, LCP, layout shift) and page weight by type, on-page SEO on the rendered page, and HTTP security headers with a grade. One overall score and the top issues. Use for a site or client report, before a launch, or to compare competitors.",
    ["website-audit", "accessibility", "wcag", "seo-audit", "page-speed", "security-headers", "web"],
    { url: { type: "string", description: "Absolute http(s) URL of the page to audit", required: true, example: "https://www.wikipedia.org/" } },
    {
      url: "https://www.wikipedia.org/", finalUrl: "https://www.wikipedia.org/", status: 200, title: "Wikipedia", score: 81, grade: "B",
      topIssues: ["accessibility: Elements must meet minimum color contrast ratio thresholds (3 elements)", "seo: no canonical link"],
      accessibility: { standard: "WCAG 2.1 A and AA (axe-core automated rules)", engine: "axe-core 4.10.3", score: 89, violations: 2, affectedElements: 4, bySeverity: { critical: 0, serious: 1, moderate: 1, minor: 0 }, passedRules: 38, needsReview: 3, issues: [{ rule: "color-contrast", impact: "serious", help: "Elements must meet minimum color contrast ratio thresholds", wcag: ["wcag2aa", "wcag143"], elements: 3, examples: [".footer-sidebar-text"], helpUrl: "https://dequeuniversity.com/rules/axe/4.10/color-contrast" }] },
      performance: { score: 100, timeToFirstByteMs: 95, firstContentfulPaintMs: 310, largestContentfulPaintMs: 420, domContentLoadedMs: 280, loadMs: 650, cumulativeLayoutShift: 0, requests: 14, thirdPartyRequests: 0, transferBytes: 151200, byType: { script: { requests: 3, bytes: 61000 }, img: { requests: 8, bytes: 52000 } }, domElements: 820, issues: [] },
      seo: { score: 73, issues: ["no canonical link"], title: "Wikipedia", titleLength: 9 },
      security: { grade: "B", score: 84, missing: ["permissions-policy"] },
      auditedAt: "2026-11-07T12:00:00.000Z",
    },
    async (env, q) => {
      const url = need(q, "url", 2_000);
      if (!/^https?:\/\//i.test(url)) throw new HttpError(400, "url must be an absolute http(s) URL");
      return websiteAudit(env, url);
    }),
];

export const __test = { accessibilityReport, performanceReport };
