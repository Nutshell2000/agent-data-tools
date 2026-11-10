// CVE lookup (10 Nov 2026): the CVE Program's record with CISA's enrichment, plus FIRST's EPSS score. Mocked fetch throughout.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const esbuild = require("esbuild");
const Module = require("node:module");

async function load(entry) {
  const built = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, external: ["cloudflare:workers"] });
  const mod = new Module(entry, null);
  mod.filename = entry;
  mod.paths = Module._nodeModulePaths(process.cwd());
  mod._compile(built.outputFiles[0].text, entry);
  return mod.exports;
}

let C, tools, endpoints;
before(async () => {
  C = await load(require.resolve("../src/routes/cve.ts"));
  tools = await load(require.resolve("../src/tools.ts"));
  endpoints = await load(require.resolve("../src/endpoints.ts"));
});

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// The shape cveawg.mitre.org really sends for Log4Shell (10 Nov 2026), shortened: the assigner gave no CVSS, CISA did.
const LOG4SHELL = {
  cveMetadata: { state: "PUBLISHED", cveId: "CVE-2021-44228", assignerShortName: "apache", dateUpdated: "2025-10-21T23:25:23.121Z", dateReserved: "2021-11-26T00:00:00Z", datePublished: "2021-12-10T00:00:00Z" },
  containers: {
    cna: {
      title: "Apache Log4j2 JNDI features do not protect against attacker controlled LDAP and other JNDI related endpoints",
      descriptions: [{ lang: "en", value: "Apache Log4j2 2.0-beta9 through 2.15.0 JNDI features do not protect against attacker controlled LDAP endpoints." }],
      affected: [{ vendor: "Apache Software Foundation", product: "Apache Log4j2", versions: [{ version: "2.0-beta9", status: "affected", lessThan: "log4j-core*", versionType: "custom", changes: [{ at: "2.3.1", status: "unaffected" }, { at: "2.4", status: "affected" }, { at: "2.12.2", status: "unaffected" }, { at: "2.15.0", status: "unaffected" }] }] }],
      references: [
        { url: "https://logging.apache.org/log4j/2.x/security.html" },
        { name: "[oss-security] 20211210", tags: ["mailing-list"], url: "http://www.openwall.com/lists/oss-security/2021/12/10/1" },
        { tags: ["vendor-advisory", "x_refsource_CISCO"], url: "https://tools.cisco.com/security/center/content/CiscoSecurityAdvisory/cisco-sa-apache-log4j-qRuKNEbd" },
        { tags: ["patch"], url: "https://github.com/apache/logging-log4j2/pull/608" },
      ],
      metrics: [{ other: { type: "unknown", content: { other: "critical" } } }],
      problemTypes: [{ descriptions: [{ type: "CWE", lang: "en", description: "CWE-502 Deserialization of Untrusted Data", cweId: "CWE-502" }] }, { descriptions: [{ type: "CWE", lang: "en", description: "CWE-20 Improper Input Validation", cweId: "CWE-20" }] }],
    },
    adp: [
      { title: "CVE Program Container", providerMetadata: { shortName: "CVE" }, references: [{ url: "https://logging.apache.org/log4j/2.x/security.html" }] },
      {
        title: "CISA ADP Vulnrichment", providerMetadata: { shortName: "CISA-ADP" },
        metrics: [
          { cvssV3_1: { scope: "CHANGED", version: "3.1", baseScore: 10, baseSeverity: "CRITICAL", vectorString: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H" } },
          { other: { type: "ssvc", content: { id: "CVE-2021-44228", options: [{ Exploitation: "active" }, { Automatable: "yes" }, { "Technical Impact": "total" }] } } },
          { other: { type: "kev", content: { dateAdded: "2021-12-10", reference: "https://www.cisa.gov/known-exploited-vulnerabilities-catalog?field_cve=CVE-2021-44228" } } },
        ],
        references: [{ url: "https://www.cisa.gov/known-exploited-vulnerabilities-catalog?field_cve=CVE-2021-44228", tags: ["government-resource"] }],
      },
    ],
  },
};
// xz backdoor: the assigner scored it, CISA only added SSVC, and it is not on the KEV list.
const XZ = {
  cveMetadata: { state: "PUBLISHED", cveId: "CVE-2024-3094", assignerShortName: "redhat", datePublished: "2024-03-29T16:51:12.588Z", dateUpdated: "2025-08-18T12:02:21.000Z" },
  containers: {
    cna: {
      title: "Xz: malicious code in distributed source", descriptions: [{ lang: "en", value: "Malicious code was discovered in the upstream tarballs of xz." }],
      affected: [{ vendor: "n/a", product: "xz", versions: [{ version: "5.6.0", status: "affected" }, { version: "5.6.1", status: "affected" }, { version: "5.4.6", status: "unaffected" }] }],
      metrics: [{ other: { type: "Red Hat severity rating", content: { value: "Critical" } } }, { cvssV3_1: { baseScore: 10, baseSeverity: "CRITICAL", vectorString: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H", version: "3.1" }, format: "CVSS" }],
      problemTypes: [{ descriptions: [{ cweId: "CWE-506", description: "Embedded Malicious Code", lang: "en", type: "CWE" }] }],
      references: [{ url: "https://access.redhat.com/security/cve/CVE-2024-3094", tags: ["vdb-entry", "x_refsource_REDHAT"] }],
    },
    adp: [{ title: "CISA ADP Vulnrichment", providerMetadata: { shortName: "CISA-ADP" }, metrics: [{ other: { type: "ssvc", content: { options: [{ Exploitation: "none" }, { Automatable: "yes" }, { "Technical Impact": "total" }] } } }] }],
  },
};

test("a CVE ID as agents write it", () => {
  for (const raw of ["CVE-2021-44228", "cve-2021-44228", " CVE-2021-44228 ", "2021-44228", "CVE 2021 44228", "cve_2021_44228", "https://nvd.nist.gov/vuln/detail/CVE-2021-44228", "https://www.cve.org/CVERecord?id=CVE-2021-44228", "Log4Shell (CVE-2021-44228)"]) {
    assert.equal(C.cveId(raw), "CVE-2021-44228", raw);
  }
  assert.equal(C.cveId("CVE-2024-1234567"), "CVE-2024-1234567");
  for (const raw of ["", "log4shell", "CVE-21-44228", "CVE-2021-123", "GHSA-jfh8-c2jp-5v3q", "12021-44228", "CVE-2021-12345678"]) assert.equal(C.cveId(raw), null, raw);
});

test("the answer carries what a triaging agent needs, with CISA's score when the assigner gave none", () => {
  const v = C.cveView(LOG4SHELL, { probability: 0.99999, percentile: 1, date: "2026-11-10" }, "2026-11-10T20:00:00.000Z");
  assert.equal(v.id, "CVE-2021-44228");
  assert.equal(v.published, "2021-12-10");
  assert.equal(v.assigner, "apache");
  assert.deepEqual(v.cvss, { score: 10, severity: "CRITICAL", vector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H", version: "3.1", scoredBy: "CISA" });
  assert.deepEqual(v.knownExploited, { listed: true, dateAdded: "2021-12-10", catalog: "CISA KEV" });
  assert.deepEqual(v.ssvc, { exploitation: "active", automatable: "yes", technicalImpact: "total" });
  assert.deepEqual(v.epss, { probability: 0.99999, percentile: 1, date: "2026-11-10" });
  assert.deepEqual(v.weaknesses, [{ cwe: "CWE-502", name: "Deserialization of Untrusted Data" }, { cwe: "CWE-20", name: "Improper Input Validation" }]);
  assert.deepEqual(v.affected, [{ vendor: "Apache Software Foundation", product: "Apache Log4j2", versions: [{ range: "from 2.0-beta9 before log4j-core*", fixedIn: ["2.3.1", "2.12.2", "2.15.0"] }] }]);
  // The patch first, then the vendor advisory, then CISA, then the rest in the record's order; a repeated link appears once.
  assert.deepEqual(v.references.map((r) => r.url), [
    "https://github.com/apache/logging-log4j2/pull/608",
    "https://tools.cisco.com/security/center/content/CiscoSecurityAdvisory/cisco-sa-apache-log4j-qRuKNEbd",
    "https://www.cisa.gov/known-exploited-vulnerabilities-catalog?field_cve=CVE-2021-44228",
    "https://logging.apache.org/log4j/2.x/security.html",
    "http://www.openwall.com/lists/oss-security/2021/12/10/1",
  ]);
  assert.deepEqual(v.references[1].tags, ["vendor-advisory", "cisco"]);
  assert.equal(v.referencesTotal, 5);
  assert.equal(v.nvd, "https://nvd.nist.gov/vuln/detail/CVE-2021-44228");
  assert.equal(v.checkedAt, "2026-11-10T20:00:00.000Z");
});

test("the assigner's own score wins, a missing KEV entry reads not listed, and a missing EPSS score is null", () => {
  const v = C.cveView(XZ, null);
  assert.equal(v.cvss.scoredBy, "redhat");
  assert.equal(v.cvss.score, 10);
  assert.deepEqual(v.knownExploited, { listed: false, dateAdded: null, catalog: "CISA KEV" });
  assert.equal(v.ssvc.exploitation, "none");
  assert.equal(v.epss, null);
  assert.deepEqual(v.affected, [{ vendor: null, product: "xz", versions: [{ range: "5.6.0" }, { range: "5.6.1" }] }]);
  assert.deepEqual(v.references[0].tags, ["vdb-entry", "redhat"]);
});

test("a record without any score, a CVSS 2 score and a rejected ID", () => {
  const bare = C.cveView({ cveMetadata: { cveId: "CVE-2020-0001", state: "PUBLISHED" }, containers: { cna: { descriptions: [{ lang: "en", value: "x" }] } } }, null);
  assert.equal(bare.cvss, null);
  assert.equal(bare.ssvc, null);
  assert.deepEqual(bare.affected, []);
  const old = C.cveView({ cveMetadata: { cveId: "CVE-2010-0001", state: "PUBLISHED" }, containers: { cna: { metrics: [{ cvssV2_0: { baseScore: 7.5, vectorString: "AV:N/AC:L/Au:N/C:P/I:P/A:P", version: "2.0" } }] } } }, null);
  assert.deepEqual(old.cvss, { score: 7.5, severity: "HIGH", vector: "AV:N/AC:L/Au:N/C:P/I:P/A:P", version: "2.0", scoredBy: "the assigner" });
  const gone = C.cveView({ cveMetadata: { cveId: "CVE-2021-0002", state: "REJECTED", dateRejected: "2022-01-05T00:00:00Z" }, containers: { cna: { rejectedReasons: [{ lang: "en", value: "Not used." }] } } }, null);
  assert.equal(gone.state, "REJECTED");
  assert.equal(gone.reason, "Not used.");
  assert.equal(gone.rejected, "2022-01-05");
  assert.equal(gone.cvss, undefined);
});

test("affected lists only what is affected: no unaffected product lines, no n/a placeholders, 'before X' read as written", () => {
  const view = (affected) => C.cveView({ cveMetadata: { cveId: "CVE-2023-4863", state: "PUBLISHED" }, containers: { cna: { affected } } }, null);
  // Chrome's record (live 10 Nov 2026): version and lessThan are the same value, meaning everything before it.
  assert.deepEqual(view([{ vendor: "Google", product: "Chrome", versions: [{ version: "116.0.5845.187", status: "affected", lessThan: "116.0.5845.187", versionType: "custom" }] }]).affected,
    [{ vendor: "Google", product: "Chrome", versions: [{ range: "all versions before 116.0.5845.187" }] }]);
  assert.deepEqual(view([{ vendor: "Abacus", product: "Abacus", versions: [{ version: "0", status: "affected", lessThan: "2024.210.16036" }, { version: "1.0", status: "affected", lessThanOrEqual: "1.4" }] }]).affected[0].versions,
    [{ range: "all versions before 2024.210.16036" }, { range: "from 1.0 up to and including 1.4" }]);
  // Heartbleed's record: nothing but placeholders. Red Hat's xz record: product lines it checked and found unaffected.
  const mixed = view([
    { vendor: "n/a", product: "n/a", versions: [{ version: "n/a", status: "affected" }] },
    { vendor: "Red Hat", product: "Red Hat Enterprise Linux 10", defaultStatus: "unaffected", packageName: "xz" },
    { vendor: "Red Hat", product: "Red Hat Enterprise Linux 9", defaultStatus: "unaffected", versions: [{ version: "5.2.5", status: "unaffected" }] },
    { vendor: "Example", product: "Everything", defaultStatus: "affected" },
    { vendor: "Example", product: "Inherits", defaultStatus: "affected", versions: [{ version: "2.0" }] },
  ]);
  assert.deepEqual(mixed.affected, [{ vendor: "Example", product: "Everything", versions: [{ range: "all versions" }] }, { vendor: "Example", product: "Inherits", versions: [{ range: "2.0" }] }]);
  assert.equal(mixed.affectedTotal, 2);
  const many = view(Array.from({ length: 12 }, (_, i) => ({ vendor: "V", product: `P${i}`, versions: [{ version: "1.0", status: "affected" }] })));
  assert.equal(many.affected.length, 8);
  assert.equal(many.affectedTotal, 12);
});

test("the record read: one more try after a busy answer, 404 and 429 uncharged with a reason", async () => {
  const calls = [];
  const noSleep = async () => {};
  const flaky = async (url) => { calls.push(url); return calls.length === 1 ? json({}, 503) : json(LOG4SHELL); };
  assert.equal((await C.cveRecord("CVE-2021-44228", flaky, noSleep)).cveMetadata.cveId, "CVE-2021-44228");
  assert.deepEqual(calls, ["https://cveawg.mitre.org/api/cve/CVE-2021-44228", "https://cveawg.mitre.org/api/cve/CVE-2021-44228"]);
  await assert.rejects(C.cveRecord("CVE-2099-99999", async () => json({ error: "CVE_RECORD_DNE" }, 404), noSleep), (e) => e.status === 404 && /nothing was charged/.test(e.message));
  await assert.rejects(C.cveRecord("CVE-2021-44228", async () => json({}, 429), noSleep), (e) => e.status === 503 && e.code === "CVE_BUSY");
  await assert.rejects(C.cveRecord("CVE-2021-44228", async () => { throw new Error("timeout"); }, noSleep), (e) => e.status === 502);
  await assert.rejects(C.cveRecord("CVE-2021-44228", async () => new Response("<html>", { status: 200 }), noSleep), (e) => e.status === 502);
});

test("EPSS is best effort: a failure, an empty answer or a slow source is null, never an error", async () => {
  assert.deepEqual(await C.epssFor("CVE-2021-44228", async () => json({ data: [{ cve: "CVE-2021-44228", epss: "0.999990000", percentile: "1.000000000", date: "2026-11-10" }] })), { probability: 0.99999, percentile: 1, date: "2026-11-10" });
  assert.equal(await C.epssFor("CVE-2026-0001", async () => json({ data: [] })), null);
  assert.equal(await C.epssFor("CVE-2021-44228", async () => json({}, 500)), null);
  assert.equal(await C.epssFor("CVE-2021-44228", async () => { throw new Error("down"); }), null);
});

test("the listing: one required input, the published example is a real answer shape, names other sellers use are read", async () => {
  const e = endpoints.ENDPOINTS.find((x) => x.path === "/cve");
  assert.ok(e, "/cve is listed");
  assert.equal(e.summary.split(":")[0], "CVE lookup");
  assert.equal(e.params.cve.required, true);
  assert.deepEqual(Object.keys(e.outputExample).sort(), Object.keys(C.cveView(LOG4SHELL, { probability: 1, percentile: 1, date: "2026-11-10" })).sort());
  // A caller that names the input id, cve_id or q (as the other CVE sellers and search agents do) is not refused for it.
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => (String(url).includes("first.org") ? json({ data: [] }) : json(LOG4SHELL));
  try {
    for (const name of ["cve", "id", "cve_id", "cveId", "q"]) {
      const out = await tools.TOOLS["/cve"]({}, (n) => (n === name ? "cve-2021-44228" : undefined));
      assert.equal(out.id, "CVE-2021-44228", name);
    }
    await assert.rejects(tools.TOOLS["/cve"]({}, (n) => (n === "cve" ? "log4shell" : undefined)), (err) => err.status === 400);
  } finally { globalThis.fetch = real; }
});
