/**
 * Titles and descriptions for the pages search engines show (SEO audit of 21 Nov 2026): 970 of 993 titles were longer
 * than the 60 characters a result shows, 725 ended in the agent-facing service name, and 907 descriptions were longer
 * than 160 characters, cut mid-word by `.slice(0, 300)`. Google rewrote many of them.
 */

/** `text` cut at a word boundary so that it fits `max` characters, with "…" when something was cut. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const room = t.slice(0, max - 1);
  const cut = room.lastIndexOf(" ");
  const head = (cut > max * 0.5 ? room.slice(0, cut) : room).replace(/[\s,;:·|–—-]+$/u, "");
  return `${head}…`;
}

/**
 * The <title>: the first candidate that fits, with " | brand" when that still fits; the first one clipped when none
 * fits. Candidates go from the fullest wording to the shortest, so the words that are searched for come before the brand.
 */
export function seoTitle(candidates: string | readonly string[], brand: string, max = 60): string {
  const list = (typeof candidates === "string" ? [candidates] : candidates).map((c) => c.replace(/\s+/g, " ").trim()).filter(Boolean);
  for (const c of list) {
    if (`${c} | ${brand}`.length <= max) return `${c} | ${brand}`;
    if (c.length <= max) return c;
  }
  return clip(list[0] ?? brand, max);
}

/** A meta description of at most `max` characters, cut at a word boundary. */
export const metaDescription = (text: string, max = 160): string => clip(text, max);

/** schema.org BreadcrumbList from the home page down; `trail` is [name, path] below the home page. */
export function breadcrumbs(origin: string, brand: string, trail: readonly (readonly [string, string])[]) {
  const items: (readonly [string, string])[] = [[brand, "/"], ...trail];
  return { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: `${origin}${path}` })) };
}
