/** ISO 3166-1 alpha-2 code for an English country name (Intl's own names), or null. Shared by holidays and packs. */
const REGION = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["en"], { type: "region" }) : null;
const NAME_TO_CODE = new Map<string, string>();
if (REGION) {
  for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b);
    try { const n = REGION.of(code); if (n && n !== code && !/^Unknown/i.test(n)) NAME_TO_CODE.set(n.toLowerCase(), code); } catch { /* not a region */ }
  }
}
// What people write instead of Intl's names.
const EXTRA: Record<string, string> = { uk: "GB", "united kingdom": "GB", england: "GB", britain: "GB", "great britain": "GB", usa: "US", "united states": "US", america: "US", "the netherlands": "NL", holland: "NL", "south korea": "KR", "north korea": "KP", russia: "RU", czechia: "CZ", "czech republic": "CZ", uae: "AE", "ivory coast": "CI" };
export const countryCode = (name: unknown): string | null => {
  if (typeof name !== "string") return null;
  const key = name.trim().toLowerCase().replace(/\s+/g, " ");
  // EXTRA first: Intl knows "UK" as an alias of GB and would hand back UK itself.
  if (Object.hasOwn(EXTRA, key)) return EXTRA[key];
  if (/^[a-z]{2}$/.test(key) && REGION) { try { const n = REGION.of(key.toUpperCase()); if (n && n !== key.toUpperCase()) return key.toUpperCase(); } catch { /* not a code */ } }
  return NAME_TO_CODE.get(key) ?? null;
};
export const countryName = (code: string): string | null => { try { return REGION?.of(code.toUpperCase()) ?? null; } catch { return null; } };
