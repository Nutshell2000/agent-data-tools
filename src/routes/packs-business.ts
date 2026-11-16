// Two business packs (16 Nov 2026, sales plan item 7): each is one paid call for a job a planner names in a sentence,
// built only from tools that already exist, at the ordinary price (every tool is at most $0.01).
//  - /pack/counterparty-full: "should my agent pay this counterparty". No single tool answers it for a paid endpoint:
//    /check/x402-seller reads the terms, /x402/payout-check compares the payout wallet with the Bazaar listing,
//    /payee/check reads the verified record, /check/counterparty the wallet. This runs the ones that fit the input.
//  - /pack/einvoice-check: "is this EU e-invoice usable". /einvoice/validate checks the rules and /einvoice/to-json reads
//    the fields, but neither looks the VAT numbers up in VIES or checks the IBAN; /invoice/check does that for PDFs
//    through a model ($0.05, capacity-limited). This is the deterministic XML one: no model, no new source.
// Every section runs the single tool's own handler. Nothing here rates anyone's economic standing.
import { entry, opt, pick, type Entry } from "../family";
import { HttpError, isAddress, type Env } from "../lib/env";
import { parseTarget } from "../lib/fetch";
import { COUNTERPARTY, payeeDomain } from "./counterparty";
import { domainReport } from "./domain-report";
import { EINVOICE, SAMPLE_XRECHNUNG } from "./einvoice";
import { invoiceChecks, type Check } from "./invoice-check";
import { runSections } from "./packs";
import { PAYEE } from "./payee";
import { viesCheck } from "./registries";
import { SANCTIONS } from "./sanctions";
import { TRUST } from "./trust";
import { X402_CHECK } from "./x402-check";

type Inputs = Record<string, string | undefined>;
/** Runs one of our tools in-process; the tests pass a fake. */
export type RunTool = (path: string, inputs: Inputs) => Promise<unknown>;

const ENTRIES: Entry[] = [...COUNTERPARTY, ...SANCTIONS, ...TRUST, ...X402_CHECK, ...PAYEE, ...EINVOICE];
/** Tools outside packs.ts's list, run in-process the same way (the module-local lookup packs-intel.ts uses). */
const local = (env: Env): RunTool => (path, inputs) => {
  // /domain-report is a core tool (src/tools.ts), not a family entry.
  if (path === "/domain-report") return domainReport(env, inputs.name ?? "");
  const e = ENTRIES.find((x) => x.endpoint.path === path);
  if (!e) throw new Error(`unknown tool ${path}`);
  return Promise.resolve().then(() => e.run(env, (n) => inputs[n]));
};

// ---------- counterparty, full check ----------
const FULL_CHAINS = ["base", "eth", "arb", "op", "polygon"] as [string, ...string[]];
export interface CounterpartyInput { address?: string; chain?: string; url?: string; domain?: string }

/** The sections a counterparty input runs: [section name, tool path, the tool's inputs]. Exported for the price test. */
export function counterpartySections(input: CounterpartyInput): [string, string, Inputs][] {
  const { address, url } = input;
  const chain = input.chain ?? "base";
  const domain = input.domain ?? (url ? new URL(url).hostname.replace(/^www\./, "") : undefined);
  const out: [string, string, Inputs][] = [];
  if (address) {
    // /check/counterparty reads Base, Ethereum, Arbitrum and Optimism; a Polygon payee gets the 5-chain /check/payee.
    out.push(["wallet", chain === "polygon" ? "/check/payee" : "/check/counterparty", { address, chain }]);
    out.push(["sanctions", "/sanctions/check", { address }]);
  }
  if (url) {
    out.push(["seller", "/check/x402-seller", { url }]);
    out.push(["payout", "/x402/payout-check", { url }]);
  }
  if (domain) out.push(["domain", "/domain-report", { name: domain }]);
  out.push(["payee", "/payee/check", { address, url, domain: url ? undefined : domain }]);
  return out;
}

const WORDS = new Set(["block", "review", "pass", "partial", "unknown"]);
/**
 * A section's own verdict word and reasons. /domain-report has no verdict word: it is shown as its trust level, and a
 * high-severity flag counts as review, the rule /check/counterparty and /check/x402-seller apply to a domain.
 */
function sectionVerdict(name: string, data: unknown): { verdict: string; shown: string; reasons: string[] } {
  const d = (data ?? {}) as { verdict?: unknown; reasons?: unknown; flags?: unknown; matches?: unknown; trust?: unknown };
  if (name === "domain") {
    const high = (Array.isArray(d.flags) ? (d.flags as { level?: string; message?: string }[]) : []).filter((f) => f.level === "high");
    return { verdict: high.length ? "review" : "pass", shown: `${String(d.trust ?? "unknown")} trust`, reasons: high.map((f) => String(f.message ?? "")) };
  }
  const verdict = typeof d.verdict === "string" && WORDS.has(d.verdict) ? d.verdict : "unknown";
  let reasons = Array.isArray(d.reasons) ? (d.reasons as unknown[]).map(String) : [];
  if (name === "sanctions" && !reasons.length && verdict !== "pass") {
    const names = [...new Set((Array.isArray(d.matches) ? (d.matches as { name?: unknown }[]) : []).map((m) => String(m.name ?? "")).filter(Boolean))];
    reasons = [`sanctions list match${names.length ? `: ${names.slice(0, 5).join(", ")}` : ""}`];
  }
  return { verdict, shown: verdict, reasons };
}

/**
 * The pack's verdict only repeats its sections': block if any section blocks, review if any says review, else pass.
 * A section that did not answer is review too: a check with a gap must not read as a clean one. `partial` and `unknown`
 * from the payee record (no verified business record) are shown per section and do not change the verdict. No score.
 */
export function aggregateVerdict(sections: Record<string, unknown>, failed: Record<string, string>) {
  const sectionVerdicts: Record<string, string> = {};
  const words: string[] = [];
  const reasons: string[] = [];
  for (const [name, data] of Object.entries(sections)) {
    const v = sectionVerdict(name, data);
    sectionVerdicts[name] = v.shown;
    words.push(v.verdict);
    if (v.verdict === "block" || v.verdict === "review") reasons.push(...(v.reasons.length ? v.reasons : [v.verdict]).slice(0, 5).map((r) => `${name}: ${r}`));
  }
  for (const name of Object.keys(failed)) reasons.push(`${name}: this check did not answer, so the verdict has a gap; try again`);
  const verdict = words.includes("block") ? "block" : words.includes("review") || Object.keys(failed).length ? "review" : "pass";
  return { verdict, reasons, sectionVerdicts };
}

/** What each section keeps of its tool's answer: the verdict, its reasons and the facts behind them. `checks` names the tool for the whole record. */
const KEEP: Readonly<Record<string, readonly string[]>> = {
  wallet: ["verdict", "reasons", "sanctions", "account", "contract", "holdings", "limitations"],
  sanctions: ["verdict", "listed", "matches", "listDate"],
  seller: ["verdict", "reasons", "terms", "payees", "limitations"],
  payout: ["verdict", "status", "reasons", "live", "listing", "declaration", "limitations"],
  domain: ["trust", "summary", "flags", "facts"],
  payee: ["verdict", "reasons", "wallets", "record", "fresh"],
};
const keep = (o: unknown, keys: readonly string[]) => (o && typeof o === "object" ? Object.fromEntries(keys.filter((k) => k in (o as object)).map((k) => [k, (o as Record<string, unknown>)[k]])) : null);
function compact(name: string, data: unknown) {
  const out = keep(data, KEEP[name] ?? []);
  // The payee record's status and checks; its company, wallets and signed attestation are /payee/check's own answer.
  if (out && name === "payee" && out.record) out.record = keep(out.record, ["status", "verifiedAt", "checks"]);
  if (out && name === "domain" && out.facts) out.facts = keep(out.facts, ["registrar", "registeredAt", "ageDays"]);
  return out;
}

const FULL_NOTE = "The verdict repeats the checks' own verdicts; a check that did not answer makes it review. Screening aid, not legal advice and not a view on anyone's finances; a pass is not a guarantee the seller delivers. `checks` names the tool behind each part.";

export async function counterpartyFull(input: CounterpartyInput, run: RunTool) {
  const plan = counterpartySections(input);
  const { data, failed } = await runSections(Object.fromEntries(plan.map(([name, path, inputs]) => [name, run(path, inputs)])));
  return {
    pack: "counterparty-full",
    ...aggregateVerdict(data, failed),
    checks: Object.fromEntries(plan.map(([name, path]) => [name, path])),
    ...Object.fromEntries(plan.map(([name]) => [name, name in data ? compact(name, data[name]) : null])),
    failed,
    note: FULL_NOTE,
  };
}

// ---------- EU e-invoice check ----------
type Vies = Parameters<typeof invoiceChecks>[1];
const EINVOICE_NOTE = "A subset of the EN 16931 and XRechnung 3.0 rules ran (see coverage and notChecked); this is not the official KoSIT validator and not tax advice. VAT numbers: EU VIES. IBAN: format and check digits.";

/**
 * The pack's answer from the two tools' answers. fail: a broken rule, a VAT number VIES calls invalid, or an IBAN whose
 * check digits are wrong. review: VIES did not answer, the registered name differs, or the IBAN's country is not the
 * seller's. A VAT number or IBAN the file does not carry is reported as missing and judged by the rules alone.
 */
export async function einvoiceCheck(validation: Record<string, unknown>, parsed: Record<string, unknown>, vies: Vies) {
  const invoice = (parsed.invoice ?? {}) as { seller?: { name?: string; vatId?: string }; buyer?: { name?: string; vatId?: string }; payment?: { iban?: string } };
  const r = await invoiceChecks({
    seller_name: invoice.seller?.name, seller_vat_number: invoice.seller?.vatId,
    buyer_name: invoice.buyer?.name, buyer_vat_number: invoice.buyer?.vatId,
    iban: invoice.payment?.iban,
  }, vies);
  // invoiceChecks also judges totals, dates and the number for PDF invoices; here the rule set does that.
  const checks: Check[] = r.checks.filter((c) => c.check === "seller_vat" || c.check === "buyer_vat" || c.check === "iban");
  if (!checks.some((c) => c.check === "buyer_vat")) checks.splice(1, 0, { check: "buyer_vat", status: "missing", detail: "no buyer VAT number on the invoice" });
  const errors = Array.isArray(validation.errors) ? validation.errors.length : 0;
  const failing = checks.filter((c) => c.status === "fail").map((c) => c.check);
  const open = checks.filter((c) => c.status === "warn" || c.status === "unavailable").map((c) => c.check);
  const verdict = validation.valid !== true || failing.length ? "fail" : open.length ? "review" : "pass";
  const ruleText = `${validation.rulesChecked ?? 0} rules of our subset ran${errors ? `, ${errors} broken` : ", none broken"}`;
  const summary = verdict === "pass" ? `Every rule and check that ran passed (${ruleText}).`
    : verdict === "fail" ? `Failed: ${[...(validation.valid !== true ? ["rules"] : []), ...failing].join(", ")} (${ruleText}). Do not book or pay it before that is explained.`
    : `Look closer at: ${open.join(", ")} (${ruleText}).`;
  const { invoice: _brief, ...rules } = validation;
  return {
    pack: "einvoice-check", verdict, summary,
    ...rules,
    checks,
    seller: r.seller, buyer: r.buyer, iban: r.iban,
    invoice: parsed.invoice ?? null,
    note: EINVOICE_NOTE,
  };
}

const EX_ENDPOINT = "https://agent-data-tools.revmesh2074.workers.dev/btc-fees";

export const PACKS_BUSINESS: Entry[] = [
  entry("/pack/counterparty-full", "Counterparty check before paying: seller terms, payout wallet, payee record, sanctions, domain",
    "Check a counterparty before an agent pays it, in one call: give the paid endpoint's url, the payout address, the domain, or several. Runs the checks that fit: the seller's 402 terms, a changed payout wallet, its verified payee record, OFAC sanctions, wallet risk and domain age. Returns each result and block, review or pass taken from them. Screening aid, not legal advice. Use when an agent is about to pay a seller or wallet for the first time.",
    ["counterparty-check", "payee-screening", "x402", "seller-trust", "sanctions", "pack"], {
      url: { type: "string", description: "The paid endpoint you are about to pay, an absolute public https URL (give url, address, domain, or several)", example: EX_ENDPOINT },
      address: { type: "string", description: "The 0x payout address you are about to pay, e.g. 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045; adds the wallet check and a sanctions screen", example: "" },
      chain: { type: "string", description: "Network of the address: base (default), eth, arb, op or polygon", enum: FULL_CHAINS, example: "base" },
      domain: { type: "string", description: "The payee's domain when you have no paid endpoint URL, e.g. example.com", example: "" },
    },
    // A real answer for the published call, run on 16 Nov 2026 (scripts in the cloud report). Abridged so the quote
    // header stays small: the Base payment option, payee and wallet only, one domain flag, one payee reason, one wallet per list.
    {
      pack: "counterparty-full",
      verdict: "pass",
      reasons: [],
      sectionVerdicts: {"seller":"pass","payout":"pass","domain":"medium trust","payee":"partial"},
      checks: {"seller":"/check/x402-seller","payout":"/x402/payout-check","domain":"/domain-report","payee":"/payee/check"},
      seller: {"verdict":"pass","reasons":[],"terms":{"paywalled":true,"x402Version":2,"score":1,"accepts":[{"network":"eip155:8453","payTo":"0x6293ded2684F1A76E26bEcef87c137D691Fbf800","priceUsd":0.002,"assetIsNativeUsdc":true}]},"payees":[{"payTo":"0x6293ded2684F1A76E26bEcef87c137D691Fbf800","network":"eip155:8453","sanctioned":false,"sanctionMatches":[],"accountType":"eoa","accountNonce":6}],"limitations":[]},
      payout: {"verdict":"pass","status":"unchanged","reasons":[],"live":{"payTo":["0x6293ded2684F1A76E26bEcef87c137D691Fbf800"]},"listing":{"payTo":["0x6293ded2684F1A76E26bEcef87c137D691Fbf800"],"lastSettledAt":"2026-11-16T08:43:32.975Z","payers30d":4,"calls30d":8},"declaration":{"url":"https://agent-data-tools.revmesh2074.workers.dev/.well-known/paycheck.json","found":true,"payTo":["0x6293ded2684F1A76E26bEcef87c137D691Fbf800"]},"limitations":[]},
      domain: {"trust":"medium","summary":"medium trust: 0 high and 1 medium flag(s). Based on DNS, registration and email-authentication signals only.","flags":[{"level":"medium","code":"few_nameservers","message":"Fewer than two nameservers."}],"facts":{"registrar":"CloudFlare, Inc.","registeredAt":"2019-02-08T20:36:47.904Z","ageDays":2837}},
      payee: {"verdict":"partial","reasons":["no registered business is declared, so the payee is a domain and its wallets, not a verified company"],"wallets":[{"address":"0x6293ded2684F1A76E26bEcef87c137D691Fbf800","match":"declared","sanctions":"pass"}],"record":{"status":"partial","verifiedAt":"2026-11-16T12:12:40.620Z","checks":{"domain":"proven","company":"not-declared","wallets":[{"address":"0x6293ded2684F1A76E26bEcef87c137D691Fbf800","proof":"declared","sanctions":"pass"}],"einvoice":"not-declared"}},"fresh":true},
      failed: {},
      note: "The verdict repeats the checks' own verdicts; a check that did not answer makes it review. Screening aid, not legal advice and not a view on anyone's finances; a pass is not a guarantee the seller delivers. `checks` names the tool behind each part.",
    },
    async (env, q) => {
      const address = opt(q, "address", 100);
      if (address && !isAddress(address)) throw new HttpError(400, "address must be a 0x-prefixed 20-byte hex address, e.g. 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
      const rawUrl = opt(q, "url", 2_000);
      const url = rawUrl ? parseTarget(rawUrl).href : undefined;
      const domain = payeeDomain(opt(q, "domain", 300));
      if (!address && !url && !domain) throw new HttpError(400, "give url (the paid endpoint), address (the payout wallet) or domain");
      return counterpartyFull({ address, chain: address ? pick(q, "chain", FULL_CHAINS, "base") : undefined, url, domain }, local(env));
    }),
  entry("/pack/einvoice-check", "EU e-invoice check: rules, VAT numbers in VIES and IBAN for XRechnung, ZUGFeRD, UBL",
    "Check whether an EU e-invoice is usable, in one call: send XRechnung, ZUGFeRD / Factur-X or UBL XML by URL, as text or as a file. Runs a subset of the EN 16931 and XRechnung rules, looks up seller and buyer VAT numbers in EU VIES, checks the IBAN and returns the invoice as JSON with pass, review or fail. No AI; not the official validator. Use when an e-invoice arrives, before booking or paying it; PDF or scanned invoices: invoice_check.",
    ["e-invoice-check", "xrechnung", "zugferd", "factur-x", "vat-validation", "iban-validation", "accounts-payable", "pack"], {
      url: { type: "string", description: "Absolute public http(s) URL of the e-invoice: an XML file or a ZUGFeRD / Factur-X PDF (or send `xml`, or the file in a POST body)", example: SAMPLE_XRECHNUNG },
      xml: { type: "string", description: "The e-invoice XML as text (CII or UBL), up to 5 MB in a POST body", example: "" },
      profile: { type: "string", description: "auto (default: the German XRechnung rules run when the file names XRechnung), xrechnung or en16931", enum: ["auto", "xrechnung", "en16931"], example: "auto" },
    },
    // The real answer for the official XRechnung test-suite invoice 01.01a on 16 Nov 2026: it passes the rules that ran,
    // and VIES does not know its placeholder VAT number, so the verdict is fail. That is the point of the pack.
    // `invoice` is abridged here (first line, no contact fields) so the quote header stays small.
    {
      pack: "einvoice-check",
      verdict: "fail",
      summary: "Failed: seller_vat (103 rules of our subset ran, none broken). Do not book or pay it before that is explained.",
      url: "https://raw.githubusercontent.com/itplr-kosit/xrechnung-testsuite/master/src/test/business-cases/standard/01.01a-INVOICE_uncefact.xml",
      valid: true,
      syntax: "CII",
      standard: "XRechnung 3.0",
      profile: "xrechnung",
      errors: [],
      warnings: [],
      rulesChecked: 103,
      coverage: "A subset of EN 16931 and XRechnung 3.0 business rules for invoices with lines, VAT and bank-transfer payment. Not checked: the XML schema itself, code lists beyond the common codes, allowances and charges, attachments, card and direct-debit payments. A file that passes here can still fail the official KoSIT validator.",
      checks: [{"check":"seller_vat","status":"fail","detail":"VIES says DE123456789 is not a valid VAT number"},{"check":"buyer_vat","status":"missing","detail":"no buyer VAT number on the invoice"},{"check":"iban","status":"pass","detail":"IBAN DE79 0000 0000 1234 5678 90 is valid (DE)"}],
      seller: {"vat":"DE123456789","country":"DE","number":"123456789","valid":false,"name":null,"address":null,"checkedAt":"2026-11-16T11:37:37.589Z","source":"EU VIES (European Commission)"},
      buyer: null,
      iban: {"iban":"DE79000000001234567890","country":"DE","valid":true,"reasons":[],"formatted":"DE79 0000 0000 1234 5678 90"},
      invoice: {"specification":"urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0","businessProcess":"urn:fdc:peppol.eu:2017:poacc:billing:01:1.0","number":"123456XX","issueDate":"2016-04-04","typeCode":"380","currency":"EUR","buyerReference":"04011000-12345-03","seller":{"name":"[Seller name]","vatId":"DE 123456789","street":"[Seller address line 1]","city":"[Seller city]","postCode":"12345","country":"DE"},"buyer":{"name":"[Buyer name]","street":"[Buyer address line 1]","city":"[Buyer city]","postCode":"12345","country":"DE"},"lines":[{"id":"Zeitschrift [...]","name":"Zeitschrift [...]","description":"Zeitschrift Inland","quantity":1,"unit":"XPP","unitPrice":288.79,"netAmount":288.79,"vatCategory":"S","vatRate":7}],"vat":[{"category":"S","rate":7,"basis":314.86,"tax":22.04}],"totals":{"lineNet":314.86,"taxBasis":314.86,"tax":22.04,"grand":336.9,"payable":336.9},"payment":{"meansCode":"58","iban":"DE79000000001234567890","terms":"Zahlbar sofort ohne Abzug."}},
      note: "A subset of the EN 16931 and XRechnung 3.0 rules ran (see coverage and notChecked); this is not the official KoSIT validator and not tax advice. VAT numbers: EU VIES. IBAN: format and check digits.",
    },
    async (env, q) => {
      // The two tools' own handlers on the caller's own input (url, xml text or the uploaded file). One after the other:
      // a file by URL is fetched once and read from the edge cache the second time. A file that cannot be read or
      // parsed is the single tool's own 400 or 422, uncharged.
      const read = (path: string) => ENTRIES.find((e) => e.endpoint.path === path)!.run(env, q) as Promise<Record<string, unknown>>;
      const validation = await read("/einvoice/validate");
      const parsed = await read("/einvoice/to-json");
      return einvoiceCheck(validation, parsed, (parts) => viesCheck(parts) as Promise<Record<string, unknown>>);
    }),
];

export const __test = { sectionVerdict };
