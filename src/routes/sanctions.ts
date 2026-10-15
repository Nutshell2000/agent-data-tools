import { HttpError } from "../lib/env";
import { normalizeAddress, SANCTIONS_SOURCE, sanctionsIndex } from "../lib/sanctions";

const MAX_ADDRESSES = 25;

function addressFormat(a: string): string {
  if (/^0x[0-9a-fA-F]{40}$/.test(a)) return "evm";
  if (/^(bc1|tb1)[02-9ac-hj-np-z]{8,87}$/i.test(a) || /^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(a)) return "bitcoin";
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a)) return "tron";
  if (/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(a)) return "xrp";
  if (/^[48][0-9AB][1-9A-HJ-NP-Za-km-z]{93}$/.test(a)) return "monero";
  if (/^(ltc1|[LM])/.test(a)) return "litecoin";
  if (/^[qp][02-9ac-hj-np-z]{41}$/i.test(a)) return "bitcoin-cash";
  if (/^t[13][1-9A-HJ-NP-Za-km-z]{33}$/.test(a)) return "zcash";
  if (/^X[1-9A-HJ-NP-Za-km-z]{33}$/.test(a)) return "dash";
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) return "solana";
  return "other";
}

/** Screens one or more crypto addresses against the OFAC SDN list. */
export async function sanctionsCheck(input: string) {
  const addresses = [...new Set(input.split(",").map((a) => a.trim().replace(/^bitcoincash:/i, "")).filter(Boolean))];
  if (addresses.length === 0) throw new HttpError(400, "address is required: one crypto address, or up to 25 separated by commas");
  if (addresses.length > MAX_ADDRESSES) throw new HttpError(400, `address accepts at most ${MAX_ADDRESSES} addresses per call`);
  if (addresses.some((a) => a.length < 20 || a.length > 120 || !/^[0-9A-Za-z]+$/.test(a))) {
    throw new HttpError(400, "each address must be 20 to 120 letters and digits, such as 0x... or bc1...");
  }

  const { index, size } = await sanctionsIndex();
  const results = addresses.map((address) => {
    const assets = index.get(normalizeAddress(address)) ?? [];
    return { address, format: addressFormat(address), sanctioned: assets.length > 0, listedUnder: assets };
  });
  const hits = results.filter((r) => r.sanctioned).length;
  return {
    sanctioned: hits > 0,
    summary:
      hits > 0
        ? `${hits} of ${results.length} address(es) are on the OFAC SDN list. Do not send funds to or accept funds from them.`
        : `None of the ${results.length} address(es) are on the OFAC SDN list.`,
    results,
    listedAddresses: size,
    source: SANCTIONS_SOURCE,
    note: "Exact-match screening of the addresses themselves. It does not trace funds or cover other sanctions programs, and it is not legal advice.",
    checkedAt: new Date().toISOString(),
  };
}
