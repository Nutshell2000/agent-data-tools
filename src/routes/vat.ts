import { HttpError } from "../lib/env";

const VIES = "https://ec.europa.eu/taxation_customs/vies/rest-api/ms/";
// EU member states as VIES names them (EL is Greece) plus XI for Northern Ireland.
const COUNTRIES = new Set("AT BE BG CY CZ DE DK EE EL ES FI FR HR HU IE IT LT LU LV MT NL PL PT RO SE SI SK XI".split(" "));
// Errors that mean the national registry could not answer, not that the number is bad.
const UNAVAILABLE = /MS_UNAVAILABLE|MS_MAX_CONCURRENT_REQ|SERVICE_UNAVAILABLE|TIMEOUT|GLOBAL_MAX_CONCURRENT_REQ|SERVER_BUSY/;

interface ViesResponse {
  isValid?: boolean;
  requestDate?: string;
  userError?: string;
  name?: string;
  address?: string;
  vatNumber?: string;
  errorWrappers?: { error?: string; message?: string }[];
}

/** Splits "DE 123.456.789" into country DE and number 123456789. */
export function parseVat(input: string, countryInput?: string): { country: string; number: string } {
  let value = input.toUpperCase().replace(/[\s.\-/]/g, "");
  let country = (countryInput ?? "").trim().toUpperCase();
  const prefix = value.slice(0, 2);
  if (COUNTRIES.has(prefix) || prefix === "GR" || prefix === "GB") {
    country = value.slice(0, 2);
    value = value.slice(2);
  }
  if (country === "GR") country = "EL";
  if (!country) throw new HttpError(400, "number must start with its country code, e.g. SE556703748501, or pass country");
  if (country === "GB") throw new HttpError(400, "UK (GB) VAT numbers are not in the EU VIES system since Brexit; only Northern Ireland (XI) numbers are");
  if (!COUNTRIES.has(country)) throw new HttpError(400, `${country} is not an EU VAT country; use one of ${[...COUNTRIES].join(", ")}`);
  if (!/^[0-9A-Z+*]{2,12}$/.test(value)) throw new HttpError(400, "the VAT number must be 2 to 12 letters and digits after the country code");
  return { country, number: value };
}

const clean = (s: string | undefined) => (s && s.trim() && !/^-+$/.test(s.trim()) ? s.trim() : null);

/** Validates an EU VAT number live against the European Commission's VIES service. */
export async function vatCheck(input: string, countryInput?: string) {
  if (!input.trim()) throw new HttpError(400, "missing required query parameter: number");
  const { country, number } = parseVat(input, countryInput);

  let res: Response;
  try {
    res = await fetch(`${VIES}${country}/vat/${encodeURIComponent(number)}`, {
      headers: { accept: "application/json", "user-agent": "AgentDataTools/1.0" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new HttpError(503, "the EU VIES service did not respond; you were not charged, try again shortly");
  }
  const data = (await res.json().catch(() => ({}))) as ViesResponse;
  const error = data.userError ?? data.errorWrappers?.[0]?.error ?? "";
  if (UNAVAILABLE.test(error) || res.status >= 500) {
    throw new HttpError(503, `the ${country} VAT registry is not answering through VIES right now (${error || `HTTP ${res.status}`}); you were not charged`);
  }
  if (error === "INVALID_INPUT") throw new HttpError(400, "VIES rejected the number as malformed for this country");
  if (!res.ok || typeof data.isValid !== "boolean") throw new HttpError(502, `the EU VIES service returned an unexpected answer (HTTP ${res.status})`);

  const name = clean(data.name);
  const address = clean(data.address)?.replace(/\s*\n\s*/g, ", ") ?? null;
  return {
    vatNumber: `${country}${number}`,
    country,
    valid: data.isValid,
    name,
    address,
    summary: data.isValid
      ? `${country}${number} is a valid, active EU VAT number${name ? ` registered to ${name}` : ""}.`
      : `${country}${number} is not a valid EU VAT number, or it is not active for cross-border trade.`,
    note: name ? null : data.isValid ? "This country's registry does not share the company name and address through VIES." : null,
    source: "European Commission VIES (live check against the national registry)",
    requestDate: data.requestDate ?? null,
    checkedAt: new Date().toISOString(),
  };
}
