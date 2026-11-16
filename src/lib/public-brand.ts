/**
 * The name people see on the pages written for them (the product site's front page, product, VAT and register pages,
 * docs): `PUBLIC_BRAND` when the owner has set one, otherwise the service name. Agent-facing surfaces (MCP, OpenAPI,
 * registries, payment terms) keep the service name: their records are keyed on it (rebrand plan of 11 Nov 2026: brand
 * layer only). Owner, 14 Nov 2026: the tool-call product is named Glyphcall; the variable is set in the release that
 * attaches its domain, not before.
 */
export const publicBrand = (env: { PUBLIC_BRAND?: string }, fallback: string): string => {
  const brand = env.PUBLIC_BRAND?.trim();
  return brand && /^[\p{L}\p{N} .&'-]{2,40}$/u.test(brand) ? brand : fallback;
};

/**
 * The brand in the service-level fields of payment terms and service cards (16 Nov 2026): the store products' and the
 * credit packs' `serviceName`, the pack description and the A2A agent card. A code constant, so a quote and its
 * settlement always agree. A tool's own listing name and description keep opening with the task buyers search for
 * (lib/bazaar-extension.ts listingName), and SERVICE_NAME, the MCP server name and the registry names stay.
 */
export const SERVICE_BRAND = "Glyphcall";
