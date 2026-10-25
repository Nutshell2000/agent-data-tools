// BIC / SWIFT code check (1.56.0). Bazaar search on 24 Oct 2026: "swift code" 28 summed payers over the top 20, no listing
// of ours. ISO 9362 structure only, computed locally: no bank directory is consulted, and the copy says so.
import { entry, need, type Entry } from "../family";

const REGION = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["en"], { type: "region" }) : null;
/** Kosovo's XK is used by SWIFT though it is not an ISO code; everything else must be an ISO 3166 alpha-2 region. */
export function countryName(cc: string): string | null {
  if (cc === "XK") return "Kosovo";
  if (!/^[A-Z]{2}$/.test(cc) || ["EU", "EZ", "UN", "QO", "ZZ"].includes(cc)) return null;
  let name: string | undefined;
  try { name = REGION?.of(cc); } catch { return null; }
  return name && name !== cc && !/^Unknown/i.test(name) ? name : null;
}

export function bicInfo(raw: string) {
  const bic = raw.replace(/\s+/g, "").toUpperCase();
  const base = { input: raw, bic };
  if (!/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(bic)) return { ...base, valid: false, reason: "a BIC is 8 or 11 letters and digits" };
  const bank = bic.slice(0, 4), country = bic.slice(4, 6), location = bic.slice(6, 8), branch = bic.length === 11 ? bic.slice(8) : null;
  if (!/^[A-Z]{4}$/.test(bank)) return { ...base, valid: false, reason: "the first four characters (institution code) must be letters" };
  const countryLabel = countryName(country);
  if (!countryLabel) return { ...base, valid: false, reason: `${country} is not a country code` };
  return {
    ...base, valid: true, institutionCode: bank, countryCode: country, country: countryLabel, locationCode: location, branchCode: branch,
    // Location code second character: "0" marks a test BIC, "1" a passive participant (ISO 9362).
    headOffice: branch === null || branch === "XXX", testBic: location[1] === "0", passiveParticipant: location[1] === "1",
    bic11: branch ? bic : `${bic}XXX`, note: "structure check only (ISO 9362); it does not confirm the bank exists",
  };
}

export const BIC: Entry[] = [
  entry("/bic/validate", "SWIFT code, BIC validation: structure, country and branch",
    "Check a BIC (SWIFT code) against the ISO 9362 structure: institution code, a real country code with its name, location code, branch code, whether it is the head office (XXX or 8 characters), a test BIC or a passive participant, and the 11-character form. Computed locally; it checks the format and country, not whether the bank exists. Use before an international transfer or to clean payment data; for account numbers use validate_iban.",
    ["swift-code", "bic", "swift", "banking", "validation", "utility"], { bic: { type: "string", description: "BIC / SWIFT code, 8 or 11 characters", required: true, example: "DEUTDEFF500" } },
    { input: "DEUTDEFF500", bic: "DEUTDEFF500", valid: true, institutionCode: "DEUT", countryCode: "DE", country: "Germany", locationCode: "FF", branchCode: "500", headOffice: false, testBic: false, passiveParticipant: false, bic11: "DEUTDEFF500", note: "structure check only (ISO 9362); it does not confirm the bank exists" },
    (_e, q) => bicInfo(need(q, "bic", 40))),
];
