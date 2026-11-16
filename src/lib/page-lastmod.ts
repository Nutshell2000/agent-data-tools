/**
 * <lastmod> for the sitemap (16 Nov 2026): the day a page's content last changed, from git history.
 *
 * The Worker cannot read git, so `node scripts/build-page-lastmod.mjs` writes src/data/page-lastmod.generated.ts
 * before a release. A page with no entry there gets no <lastmod>: search engines use the field only while it is
 * true, so an unknown date is left out rather than guessed. A date after today (a wrong clock at build time) is
 * left out too. Live results on a page never move its date.
 */
import { PAGE_LASTMOD } from "../data/page-lastmod.generated";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function lastmodOf(path: string, today: string = new Date().toISOString().slice(0, 10), dates: Readonly<Record<string, string>> = PAGE_LASTMOD): string | undefined {
  const day = Object.hasOwn(dates, path) ? dates[path] : undefined;
  return day !== undefined && DAY.test(day) && !Number.isNaN(Date.parse(day)) && day <= today ? day : undefined;
}

/** The sitemap element, or nothing. */
export function lastmodTag(path: string, today?: string, dates?: Readonly<Record<string, string>>): string {
  const day = lastmodOf(path, today, dates);
  return day ? `<lastmod>${day}</lastmod>` : "";
}
