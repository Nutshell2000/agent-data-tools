import { HttpError } from "../lib/env";

// IBAN length per country, from the SWIFT IBAN registry.
const LENGTHS: Record<string, number> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BI: 27, BR: 29, BY: 28, CH: 21, CR: 22, CY: 28,
  CZ: 24, DE: 22, DJ: 27, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FK: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23,
  GL: 18, GR: 27, GT: 28, HN: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28,
  LC: 32, LI: 21, LT: 20, LU: 20, LV: 21, LY: 25, MC: 27, MD: 24, ME: 22, MK: 19, MN: 20, MR: 27, MT: 31, MU: 30, NI: 28,
  NL: 18, NO: 15, OM: 23, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, RU: 33, SA: 24, SC: 31, SD: 18, SE: 24,
  SI: 19, SK: 24, SM: 27, SO: 23, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20, YE: 30,
};

// Long-standing SEPA members: the EU, the EEA, Switzerland, the UK and the European microstates.
const SEPA = new Set(
  "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO CH GB MC SM VA AD".split(" "),
);

// Where the bank and branch codes sit inside the BBAN (the part after the 4-character prefix).
const BANK: Record<string, { bank: [number, number]; branch?: [number, number] }> = {
  AT: { bank: [0, 5] }, BE: { bank: [0, 3] }, BG: { bank: [0, 4], branch: [4, 8] }, CH: { bank: [0, 5] }, CZ: { bank: [0, 4] },
  DE: { bank: [0, 8] }, DK: { bank: [0, 4] }, EE: { bank: [0, 2] }, ES: { bank: [0, 4], branch: [4, 8] }, FI: { bank: [0, 3] },
  FR: { bank: [0, 5], branch: [5, 10] }, GB: { bank: [0, 4], branch: [4, 10] }, GR: { bank: [0, 3], branch: [3, 7] },
  HR: { bank: [0, 7] }, HU: { bank: [0, 3], branch: [3, 7] }, IE: { bank: [0, 4], branch: [4, 10] }, IT: { bank: [1, 6], branch: [6, 11] },
  LT: { bank: [0, 5] }, LU: { bank: [0, 3] }, LV: { bank: [0, 4] }, NL: { bank: [0, 4] }, NO: { bank: [0, 4] }, PL: { bank: [0, 8] },
  PT: { bank: [0, 4], branch: [4, 8] }, RO: { bank: [0, 4] }, SE: { bank: [0, 3] }, SI: { bank: [0, 5] }, SK: { bank: [0, 4] },
};

/** ISO 13616 check: move the first four characters to the end, letters to numbers, remainder mod 97 must be 1. */
export function mod97(iban: string): number {
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (let i = 0; i < digits.length; i += 7) rest = Number(String(rest) + digits.slice(i, i + 7)) % 97;
  return rest;
}

export async function ibanCheck(input: string) {
  const iban = input.toUpperCase().replace(/^IBAN/, "").replace(/[\s\-.]/g, "");
  if (!iban) throw new HttpError(400, "missing required query parameter: iban");
  const country = iban.slice(0, 2);
  const errors: string[] = [];

  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) errors.push("An IBAN is a two-letter country code, two check digits, then letters and digits.");
  const expected = LENGTHS[country];
  if (!expected) errors.push(`${country} does not use IBANs.`);
  else if (iban.length !== expected) errors.push(`A ${country} IBAN has ${expected} characters; this one has ${iban.length}.`);
  if (errors.length === 0 && mod97(iban) !== 1) errors.push("The check digits do not match: there is a typo or a swapped character.");

  const valid = errors.length === 0;
  const bban = iban.slice(4);
  const layout = valid ? BANK[country] : undefined;
  return {
    iban,
    valid,
    errors,
    formatted: iban.replace(/(.{4})(?=.)/g, "$1 "),
    country: expected ? country : null,
    checkDigits: iban.slice(2, 4),
    bban: valid ? bban : null,
    bankCode: layout ? bban.slice(...layout.bank) : null,
    branchCode: layout?.branch ? bban.slice(...layout.branch) : null,
    sepa: valid ? SEPA.has(country) : null,
    note: valid ? "Structure and check digits are valid. This does not prove the account is open or who holds it." : null,
  };
}
