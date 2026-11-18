// LexGlyph Phase B (18 Nov 2026): Court of Justice case law linked to articles, Swedish statutes and the EU directives
// they implement, an article as it read on a date, and the answer as a Word document.
const assert = require("node:assert/strict");
const Module = require("node:module");
const { before, test } = require("node:test");
const esbuild = require("esbuild");
const { pathToFileURL } = require("node:url");

async function loadTypeScript(entry) {
  const result = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false });
  const loaded = new Module(entry, module);
  loaded.filename = entry;
  loaded.paths = Module._nodeModulePaths(process.cwd());
  loaded._compile(result.outputFiles[0].text, entry);
  return loaded.exports;
}

let CL, SE, G, V, D, X, lex, layers, law;
before(async () => {
  CL = await import(pathToFileURL(require.resolve("../scripts/law-index/caselaw-links.mjs")).href);
  SE = await import(pathToFileURL(require.resolve("../scripts/law-index/build-se.mjs")).href);
  G = await loadTypeScript(require.resolve("../src/lib/law-grounding.ts"));
  V = await loadTypeScript(require.resolve("../src/lib/law-versions.ts"));
  D = await loadTypeScript(require.resolve("../src/lib/docx.ts"));
  X = await loadTypeScript(require.resolve("../src/lib/lexglyph-extra.ts"));
  lex = await loadTypeScript(require.resolve("../src/lib/lexglyph-page.ts"));
  layers = await loadTypeScript(require.resolve("../src/routes/law-layers.ts"));
  law = await loadTypeScript(require.resolve("../src/routes/law-search.ts"));
});

test("judgment paragraphs link to the articles they cite, in the Court's ways of writing them", () => {
  const forms = CL.actCitationForms(law.LAW_ACTS);
  const state = {};
  const links = (t, interprets = ["Working Time Directive"]) => CL.articleLinks(t, forms, interprets, law.LAW_ACTS, state).map((l) => `${l.short}:${l.num}`);
  assert.deepEqual(links("the mechanism provided for in Article 46(2)(c) of the GDPR is based on"), ["GDPR:46"]);
  assert.deepEqual(links("Articles 2(1), 3 and 7(2) of Directive 2003/88 must be interpreted"), ["Working Time Directive:2", "Working Time Directive:3", "Working Time Directive:7"]);
  assert.deepEqual(links("Article 6(1) of Regulation (EU) 2016/679 provides"), ["GDPR:6"]);
  assert.deepEqual(links("Article 101 TFEU and Article 47 of the Charter"), ["TFEU:101", "Charter:47"]);
  assert.deepEqual(links("under Article 23 of Regulation No 1/2003 the Commission"), ["Regulation 1/2003:23"]);
  // "that directive": the last directive named in the judgment (here 2003/88 above), else the one CELLAR lists.
  assert.deepEqual(links("Article 7 of that directive confers a right"), ["Working Time Directive:7"]);
  assert.deepEqual(CL.articleLinks("Article 7 of that directive", forms, ["Working Time Directive"], law.LAW_ACTS, {}).map((l) => l.short), ["Working Time Directive"]);
  // Article 267 TFEU (the reference itself) is not a link; an unknown act is not either.
  assert.deepEqual(links("a request under Article 267 TFEU"), []);
  assert.deepEqual(links("Article 5 of Directive 1999/99 on something else"), []);
});

test("a judgment's numbered paragraphs and ruling are read; costs and signatures are not", () => {
  const html = `<p class="coj-count" id="point1">1</p><p class="coj-normal">This request concerns the interpretation of Article 7 of Directive 2003/88.</p>
    <p class="coj-count" id="point2">2</p><p class="coj-normal">The request has been made in proceedings between X and Y about annual leave.</p>
    <p class="coj-count" id="point3">3</p><p class="coj-normal">In the light of the foregoing, the answer is yes. Costs Since these proceedings are, for the parties, a step in the action. On those grounds, the Court (Fifth Chamber) hereby rules: Article 7 of Directive 2003/88 precludes national legislation. [Signatures]</p>`;
  const j = CL.parseJudgment(html);
  assert.deepEqual(j.paras.map((p) => p.para), ["1", "2", "3"]);
  assert.match(j.ruling, /^On those grounds, the Court \(Fifth Chamber\) hereby rules: Article 7/);
  assert.doesNotMatch(j.paras[2].text, /Costs|hereby rules/);
});

test("Swedish statutes: chapters, sections, headings and stycken; the definite name; the Swedish pinpoint", () => {
  const raw = ["Aktiebolagslag (2005:551)", "", "SFS nr:     2005:551", "Ändrad:     t.o.m. SFS 2026:783", "Källa: Regeringskansliet / Lagrummet", "", "",
    "8 kap. Bolagets organisation", "", "Styrelsens ansvar", "", "4 § Styrelsen ansvarar för bolagets", "organisation och förvaltningen av", "bolagets angelägenheter.", "",
    "Styrelsen ska fortlöpande bedöma", "bolagets ekonomiska situation.", "", "4 a § Styrelsen ska se till att", "", "1. bokföringen kontrolleras,", "", "2. medelsförvaltningen kontrolleras.", "",
    "9 kap. Revision", "", "4 § Ett aktiebolag ska ha minst en revisor.", "",
    "Övergångsbestämmelser", "", "1 § Gammal text som inte ska läsas."].join("\n");
  const p = SE.parseStatute(raw);
  assert.equal(p.amended, "2026:783");
  assert.equal(p.sections.length, 3);
  assert.equal(p.sections[2].chapter, "9", "section numbers start again in each chapter, so chapters are kept");
  // Avtalslagen numbers its sections straight through its chapters: cited "28 § avtalslagen".
  const avtal = SE.parseStatute(["Lag (1915:218) om avtal", "Källa: x", "", "3 kap. Om avtals ogiltighet", "", "28 § Har någon genom tvång avtalat …", "", "29 § Annat.", "", "4 KAP. Allmänna bestämmelser", "", "36 § Ett avtalsvillkor får jämkas."].join("\n"));
  assert.deepEqual(avtal.sections.map((s) => `${s.chapter}:${s.section}`), ["null:28", "null:29", "null:36"]);
  assert.deepEqual([p.sections[0].chapter, p.sections[0].section, p.sections[0].heading], ["8", "4", "Styrelsens ansvar"]);
  assert.equal(p.sections[0].text, "Styrelsen ansvarar för bolagets organisation och förvaltningen av bolagets angelägenheter.\nStyrelsen ska fortlöpande bedöma bolagets ekonomiska situation.");
  assert.equal(p.sections[1].section, "4 a");
  assert.equal(SE.definiteName("Aktiebolagslag (2005:551)"), "aktiebolagslagen (2005:551)");
  assert.equal(SE.definiteName("Lag (1982:80) om anställningsskydd"), "lagen (1982:80) om anställningsskydd");
  assert.equal(SE.definiteName("Rättegångsbalk (1942:740)"), "rättegångsbalken (1942:740)");
  const s = p.sections[0];
  assert.equal(G.seLocate(s.text, s.text.indexOf("fortlöpande"), "8 kap. 4 §"), "8 kap. 4 § andra stycket");
  const t = p.sections[1].text;
  assert.equal(G.seLocate(t, t.indexOf("medelsförvaltningen"), "8 kap. 4 a §"), "8 kap. 4 a § 2");
});

test("quotes from Swedish sections and judgments get their own citation styles", () => {
  const sources = [
    layers.seSource({ id: "x", sfs: "1977:480", chapter: null, chapter_title: null, section: "4", heading: null, text: "Arbetstagare har rätt till semesterledighet om tjugofem dagar varje semesterår.\nAndra stycket här.", name: "semesterlagen (1977:480)", url: "https://data.riksdagen.se/dokument/sfs-1977-480.html" }),
    layers.caseSource({ celex: "62018CJ0311", number: "C-311/18", ecli: "ECLI:EU:C:2020:559", parties: "Data Protection Commissioner v Facebook Ireland Limited and Maximillian Schrems", date: "2020-07-16", para: "134", text: "the contractual mechanism provided for in Article 46(2)(c) of the GDPR is based on the responsibility of the controller", url: "https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:62018CJ0311", mentions: 24 }),
  ];
  const { kept } = G.verifyClaims([
    { text: "Man har rätt till 25 dagars semester.", source: 1, quote: "rätt till semesterledighet om tjugofem dagar varje semesterår" },
    { text: "Standard clauses rest on the controller's responsibility.", source: 2, quote: "mechanism provided for in Article 46(2)(c) of the GDPR is based on the responsibility" },
  ], sources);
  assert.deepEqual(kept.map((k) => k.citation), ["4 § första stycket semesterlagen (1977:480)", "C-311/18, Data Protection Commissioner v Facebook Ireland Limited and Maximillian Schrems, para 134"]);
  assert.equal(kept[1].url, "https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:62018CJ0311#point134");
  // The paragraph shown for a judgment is the Court's reasoning, not its quotation of the legislation.
  const paras = [
    { para: "6", text: `Article 7 of Directive 2003/88, which is identical to Article 7 of Directive 93/104, is worded as follows: ‘1. Member States shall take the measures necessary ${"x".repeat(80)}` },
    { para: "20", text: "‘Must Article 7 of Directive 2003/88 be interpreted as precluding …?’" },
    { para: "38", text: `It must be recalled that the right of every worker to paid annual leave must be regarded as a particularly important principle of EU social law ${"y".repeat(40)}` },
  ];
  assert.equal(layers.bestParagraph(paras).para, "38");
  assert.equal(layers.seFtsQuery("hur många dagars semester har jag rätt till"), '"många"* OR "dagars"* OR "semester"* OR "rätt"*');
});

test("an article on a date: the version in force then, today's, and a line-by-line difference", async () => {
  const rows = [{ short: "GDPR", version_celex: "02016R0679-20160504", date: "2016-05-04" }, { short: "GDPR", version_celex: "02016R0679-20250101", date: "2025-01-01" }];
  assert.equal(V.versionOn(rows, "2020-06-01").version_celex, "02016R0679-20160504");
  assert.equal(V.versionOn(rows, "2015-01-01"), null);
  assert.deepEqual(V.diffLines("a\nb\nc", "a\nB\nc").map((d) => `${d.kind}:${d.text}`), ["same:a", "removed:b", "added:B", "same:c"]);
  const page = (n) => `<div class="eli-subdivision" id="art_6"><p class="oj-ti-art">Article 6</p><p class="oj-sti-art">Lawfulness</p><p class="oj-normal">1. Processing shall be lawful only if ${n}.</p></div>`;
  const db = { prepare: () => ({ bind: () => ({ all: async () => ({ results: rows }) }) }) };
  const p = await V.articleOnDate(db, "GDPR", "6", "2020-06-01", "eng", async (celex) => page(celex.endsWith("20160504") ? "one condition applies" : "at least one condition applies"));
  assert.equal(p.then.from, "2016-05-04");
  assert.equal(p.now.from, "2025-01-01");
  assert.ok(p.diff.some((d) => d.kind === "removed") && p.diff.some((d) => d.kind === "added"));
  const html = X.versionBody("en", p, "General Data Protection Regulation");
  assert.match(html, /GDPR, Article 6 as in force on 2020-06-01/);
  assert.match(html, /<del>1\. Processing shall be lawful only if one condition applies\.<\/del>/);
  assert.match(html, /<ins>1\. Processing shall be lawful only if at least one condition applies\.<\/ins>/);
  const before = await V.articleOnDate(db, "GDPR", "6", "2010-01-01", "eng", async () => page("x"));
  assert.match(X.versionBody("en", before, "GDPR"), /first consolidated version applies from 2016-05-04/);
});

test("the Word export is a valid ZIP with the document, styles and one footnote per cited sentence", () => {
  const data = JSON.stringify({ q: "annual leave", ui: "en", lang: "en",
    claims: [{ text: "Workers get four weeks.", quote: "at least four weeks", citation: "Working Time Directive, Article 7(1)", url: "https://eur-lex.europa.eu/x" }, { text: "<script>", quote: "q & a", citation: "c", url: "u" }],
    provisions: [{ citation: "Working Time Directive, Article 7", heading: "Annual leave", text: "1. Member States shall…", url: "https://eur-lex.europa.eu/x", version: "text as published" }] });
  const { bytes, filename } = X.lexglyphExport(data);
  assert.equal(filename, "lexglyph-annual-leave.docx");
  const buf = Buffer.from(bytes);
  assert.equal(buf.readUInt32LE(0), 0x04034b50, "starts with a ZIP local header");
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.equal(buf.readUInt16LE(eocd + 10), 6, "six parts");
  // Every stored part's CRC matches its bytes.
  let at = 0;
  const names = [];
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const crc = buf.readUInt32LE(at + 14), size = buf.readUInt32LE(at + 18), nlen = buf.readUInt16LE(at + 26);
    const name = buf.subarray(at + 30, at + 30 + nlen).toString("utf8");
    const body = buf.subarray(at + 30 + nlen, at + 30 + nlen + size);
    assert.equal(D.crc32(body), crc, name);
    names.push(name);
    if (name === "word/document.xml") { const x = body.toString("utf8"); assert.match(x, /Workers get four weeks\./); assert.match(x, /&lt;script&gt;/); assert.match(x, /<w:footnoteReference w:id="2"\/>/); }
    if (name === "word/footnotes.xml") assert.match(body.toString("utf8"), /Working Time Directive, Article 7\(1\) https:\/\/eur-lex\.europa\.eu\/x/);
    at += 30 + nlen + size;
  }
  assert.deepEqual(names, ["[Content_Types].xml", "_rels/.rels", "word/_rels/document.xml.rels", "word/document.xml", "word/styles.xml", "word/footnotes.xml"]);
  assert.throws(() => X.lexglyphExport("not json"), (e) => e.status === 400);
  assert.throws(() => X.lexglyphExport("x".repeat(200_001)), (e) => e.status === 400);
});

test("the page: case law and Swedish implementations under each article, a date form, Swedish sections, Word download", () => {
  const result = { act: "Working Time Directive", short: "Working Time Directive", celex: "32003L0088", citation: "Working Time Directive, Article 7", kind: "article", label: "Article 7", heading: "Annual leave", text: "1. Member States shall…", url: "https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32003L0088#art_7", version: "text as published in the Official Journal", language: "en" };
  const cases = [[{ celex: "62009CJ0214", number: "C-214/10", ecli: "ECLI:EU:C:2011:761", parties: "KHS AG v Winfried Schulte", date: "2011-11-22", para: "23", text: "the right to paid annual leave must be regarded as a particularly important principle", url: "https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:62009CJ0214", mentions: 9 }]];
  const html = lex.lexglyphPage("https://lex.glyphcall.com", "Glyphcall", { ui: "sv", q: "semester", explain: true, results: [result], cases,
    seImpl: [{ short: "Working Time Directive", sfs: "1982:673", name: "arbetstidslagen (1982:673)", url: "https://data.riksdagen.se/dokument/sfs-1982-673.html" }],
    se: [{ id: "se:1977:480:4", sfs: "1977:480", chapter: null, chapter_title: null, section: "4", heading: "Semesterledighet", text: "Arbetstagare har rätt till semesterledighet om tjugofem dagar.", name: "semesterlagen (1977:480)", url: "https://data.riksdagen.se/dokument/sfs-1977-480.html" }],
    claims: [{ text: "Fyra veckor.", source: 1, quote: "at least four weeks", citation: "Working Time Directive, Article 7(1)", url: result.url }], grounded: true, qLang: { eurlex: "SV", tag: "sv" } });
  assert.match(html, /EU-domstolens praxis om artikeln \(1\)/);
  assert.match(html, /href="https:\/\/eur-lex.europa.eu\/legal-content\/SV\/TXT\/HTML\/\?uri=CELEX:62009CJ0214#point23"/);
  assert.match(html, /C-214\/10, KHS AG v Winfried Schulte, para 23/);
  assert.match(html, /Genomförd i Sverige genom: <a href="https:\/\/data.riksdagen.se\/dokument\/sfs-1982-673.html"[^>]*>arbetstidslagen \(1982:673\)<\/a>/);
  assert.match(html, /<form method="get" action="\/lexglyph\/version" class="ondate">.*name="act" value="Working Time Directive".*name="article" value="7"/s);
  assert.match(html, /<h2>Svensk lag<\/h2>.*4 § semesterlagen \(1977:480\): Semesterledighet/s);
  assert.match(html, /<form method="post" action="\/lexglyph\/export" class="export"><input type="hidden" name="data" value="\{&quot;q&quot;:&quot;semester&quot;/);
  assert.match(html, /Ladda ner som Word/);
});
