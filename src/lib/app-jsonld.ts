/**
 * schema.org WebApplication data for the pages that are a web app's own page: the front page and the product pages
 * (16 Nov 2026). The free browser tools live on other hosts (voice.glyphcall.com, studio.glyphcall.com) and are not
 * served by this Worker, so they get nothing from here.
 *
 * WebApplication, not plain SoftwareApplication: it is the schema.org subtype for software that runs in a browser,
 * and Google's software-app guidance accepts it. Google shows a software-app rich result only with a rating or a
 * review; there are none, so none is published and the pages are not eligible for that result. The data still names
 * the product, its maker and its real prices.
 *
 * Every value comes from what the page shows: its name, its own meta description, and the plan and pack prices of
 * `productOffers`. Never add aggregateRating or review here.
 */
export const MAKER = "SpellzCode";

/** A price the page shows: the label as printed ("$9 a month", "$5 once") and, where the page says it, what it buys. */
export interface ShownOffer { label: string; note?: string }

/** "$9 a month" -> "9.00"; undefined when the label carries no amount (then no offer is published for it). */
export function offerPrice(label: string): string | undefined {
  const amount = /\$(\d+(?:\.\d+)?)/.exec(label)?.[1];
  return amount === undefined ? undefined : Number(amount).toFixed(2);
}

export function webApplicationLd(o: { name: string; url: string; description: string; brand: string; offers: readonly ShownOffer[] }) {
  const offers = o.offers.flatMap(({ label, note }) => {
    const price = offerPrice(label);
    return price === undefined ? [] : [{ "@type": "Offer", price, priceCurrency: "USD", description: note ? `${label}: ${note}` : label }];
  });
  const maker = { "@type": "Organization", name: MAKER, brand: { "@type": "Brand", name: o.brand } };
  return {
    "@context": "https://schema.org", "@type": "WebApplication", name: o.name, url: o.url, description: o.description,
    applicationCategory: "DeveloperApplication", operatingSystem: "Any",
    ...(offers.length ? { offers } : {}),
    provider: maker, publisher: maker,
  };
}

/** JSON for a <script type="application/ld+json"> block: "<", ">" and "&" escaped, so no string can close the tag or open a comment. */
export const ldJson = (value: unknown) => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);

/** The block for the page head. `data-ld="app"` lets withPublicCanonical (public-site.ts) point its URLs at the public site. */
export const webApplicationScript = (o: Parameters<typeof webApplicationLd>[0]) => `<script type="application/ld+json" data-ld="app">${ldJson(webApplicationLd(o))}</script>`;
