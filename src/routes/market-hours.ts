// Is the stock market open right now? (19 Nov 2026). Computed locally from each exchange's published trading rules:
// regular hours in the exchange's time zone, its full-day holidays and its scheduled early closes. No outside source.
// Why: a Mercator job paid another seller $25.71 for 1,270 calls of exactly this question in 7 days (steady, $0.02 a
// call), and we were absent from that search. Unscheduled closures (a national day of mourning, a market-wide halt)
// cannot be computed and are stated in every answer.
import { entry, opt, type Entry } from "../family";
import { HttpError } from "../lib/env";
import { easter } from "./holidays";

const DAY = 86_400_000;
const utcDay = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);
const weekday = (t: number) => new Date(t).getUTCDay();
const nthWeekday = (y: number, m: number, wd: number, n: number) => {
  if (n > 0) { const first = utcDay(y, m, 1); return first + (((wd - weekday(first) + 7) % 7) + (n - 1) * 7) * DAY; }
  const last = utcDay(y, m + 1, 0); return last - ((weekday(last) - wd + 7) % 7) * DAY;
};

interface Exchange { name: string; zone: string; open: [number, number]; close: [number, number]; earlyClose: [number, number]; pre?: [number, number]; post?: [number, number]; closures: (y: number) => Map<string, string>; earlyCloses: (y: number) => Map<string, string> }

/** NYSE and Nasdaq share one calendar (NYSE Rule 7.2): a Saturday holiday closes the Friday before, a Sunday one the
 * Monday after, except New Year's Day on a Saturday, which closes nothing (the year-end close is kept). */
function usClosures(y: number): Map<string, string> {
  const out = new Map<string, string>();
  const add = (t: number, name: string, saturdayToFriday = true) => {
    const wd = weekday(t);
    if (wd === 6) { if (saturdayToFriday) out.set(ymd(t - DAY), `${name} (observed)`); }
    else if (wd === 0) out.set(ymd(t + DAY), `${name} (observed)`);
    else out.set(ymd(t), name);
  };
  add(utcDay(y, 1, 1), "New Year's Day", false);
  add(nthWeekday(y, 1, 1, 3), "Martin Luther King Jr. Day");
  add(nthWeekday(y, 2, 1, 3), "Washington's Birthday");
  out.set(ymd(easter(y).getTime() - 2 * DAY), "Good Friday");
  add(nthWeekday(y, 5, 1, -1), "Memorial Day");
  add(utcDay(y, 6, 19), "Juneteenth");
  add(utcDay(y, 7, 4), "Independence Day");
  add(nthWeekday(y, 9, 1, 1), "Labor Day");
  add(nthWeekday(y, 11, 4, 4), "Thanksgiving Day");
  add(utcDay(y, 12, 25), "Christmas Day");
  return out;
}
/** 1 p.m. Eastern closes: 3 July when it is Monday to Thursday, the day after Thanksgiving, 24 December Monday to Thursday. */
function usEarlyCloses(y: number): Map<string, string> {
  const out = new Map<string, string>();
  const jul3 = utcDay(y, 7, 3);
  if (weekday(jul3) >= 1 && weekday(jul3) <= 4) out.set(ymd(jul3), "Day before Independence Day");
  out.set(ymd(nthWeekday(y, 11, 4, 4) + DAY), "Day after Thanksgiving");
  const dec24 = utcDay(y, 12, 24);
  if (weekday(dec24) >= 1 && weekday(dec24) <= 4) out.set(ymd(dec24), "Christmas Eve");
  return out;
}
/** London Stock Exchange: England and Wales bank holidays (substitute days for weekend ones), 12:30 closes on the last
 * weekday before Christmas and before New Year. */
function lseClosures(y: number): Map<string, string> {
  const out = new Map<string, string>();
  const sub = (t: number, name: string) => { let d = t; while (weekday(d) === 0 || weekday(d) === 6 || out.has(ymd(d))) d += DAY; out.set(ymd(d), d === t ? name : `${name} (substitute day)`); };
  sub(utcDay(y, 1, 1), "New Year's Day");
  out.set(ymd(easter(y).getTime() - 2 * DAY), "Good Friday");
  out.set(ymd(easter(y).getTime() + DAY), "Easter Monday");
  out.set(ymd(nthWeekday(y, 5, 1, 1)), "Early May bank holiday");
  out.set(ymd(nthWeekday(y, 5, 1, -1)), "Spring bank holiday");
  out.set(ymd(nthWeekday(y, 8, 1, -1)), "Summer bank holiday");
  sub(utcDay(y, 12, 25), "Christmas Day");
  sub(utcDay(y, 12, 26), "Boxing Day");
  return out;
}
function lseEarlyCloses(y: number): Map<string, string> {
  const out = new Map<string, string>();
  const closures = lseClosures(y);
  for (const [m, d, name] of [[12, 24, "Christmas Eve"], [12, 31, "New Year's Eve"]] as const) {
    let t = utcDay(y, m, d);
    while (weekday(t) === 0 || weekday(t) === 6 || closures.has(ymd(t))) t -= DAY;
    out.set(ymd(t), name);
  }
  return out;
}

export const EXCHANGES: Readonly<Record<string, Exchange>> = Object.freeze({
  NYSE: { name: "New York Stock Exchange", zone: "America/New_York", open: [9, 30], close: [16, 0], earlyClose: [13, 0], pre: [4, 0], post: [20, 0], closures: usClosures, earlyCloses: usEarlyCloses },
  NASDAQ: { name: "Nasdaq", zone: "America/New_York", open: [9, 30], close: [16, 0], earlyClose: [13, 0], pre: [4, 0], post: [20, 0], closures: usClosures, earlyCloses: usEarlyCloses },
  LSE: { name: "London Stock Exchange", zone: "Europe/London", open: [8, 0], close: [16, 30], earlyClose: [12, 30], closures: lseClosures, earlyCloses: lseEarlyCloses },
});
const ALIASES: Readonly<Record<string, string>> = Object.freeze({
  "US": "NYSE", "USA": "NYSE", "NEW YORK": "NYSE", "NYSE": "NYSE", "STOCK MARKET": "NYSE", "STOCKS": "NYSE", "US STOCKS": "NYSE",
  "NASDAQ": "NASDAQ", "NAS": "NASDAQ", "LSE": "LSE", "LONDON": "LSE", "UK": "LSE", "GB": "LSE", "FTSE": "LSE",
});
export function exchangeKey(raw: string | undefined): string {
  const k = (raw ?? "NYSE").trim().toUpperCase().replace(/[_-]+/g, " ");
  if (Object.hasOwn(ALIASES, k)) return ALIASES[k];
  throw new HttpError(400, `unknown exchange "${String(raw).slice(0, 40)}"; use NYSE, NASDAQ or LSE`);
}

/** Wall-clock parts of an instant in a time zone. */
function zoned(t: number, zone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  return { y: +parts.year, m: +parts.month, d: +parts.day, h: +parts.hour, mi: +parts.minute, s: +parts.second };
}
/** The instant at a wall-clock time in a zone (two passes settle daylight-saving changes). */
function instant(y: number, m: number, d: number, h: number, mi: number, zone: string): number {
  let guess = Date.UTC(y, m - 1, d, h, mi);
  for (let i = 0; i < 2; i++) {
    const z = zoned(guess, zone);
    const diff = Date.UTC(z.y, z.m - 1, z.d, z.h, z.mi) - Date.UTC(y, m - 1, d, h, mi);
    guess -= diff;
  }
  return guess;
}

interface DayHours { date: string; holiday: string | null; earlyClose: string | null; open: number | null; close: number | null }
function hoursOn(x: Exchange, day: number): DayHours {
  const date = ymd(day), y = new Date(day).getUTCFullYear(), m = new Date(day).getUTCMonth() + 1, d = new Date(day).getUTCDate();
  const wd = weekday(day);
  const holiday = x.closures(y).get(date) ?? null;
  if (wd === 0 || wd === 6) return { date, holiday: null, earlyClose: null, open: null, close: null };
  if (holiday) return { date, holiday, earlyClose: null, open: null, close: null };
  const early = x.earlyCloses(y).get(date) ?? null;
  const [ch, cm] = early ? x.earlyClose : x.close;
  return { date, holiday: null, earlyClose: early, open: instant(y, m, d, x.open[0], x.open[1], x.zone), close: instant(y, m, d, ch, cm, x.zone) };
}

export function marketStatus(code: string, now: number) {
  const x = EXCHANGES[code];
  const local = zoned(now, x.zone);
  const today = utcDay(local.y, local.m, local.d);
  const h = hoursOn(x, today);
  const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());
  const isOpen = h.open !== null && h.close !== null && now >= h.open && now < h.close;
  let session: "regular" | "pre-market" | "after-hours" | "closed" = isOpen ? "regular" : "closed";
  if (!isOpen && h.open !== null && x.pre && x.post) {
    const pre = instant(local.y, local.m, local.d, x.pre[0], x.pre[1], x.zone), post = instant(local.y, local.m, local.d, x.post[0], x.post[1], x.zone);
    if (now >= pre && now < h.open) session = "pre-market";
    else if (h.close !== null && now >= h.close && now < post && !h.earlyClose) session = "after-hours";
  }
  // Next open and next close: today's if still ahead, else the next trading day's (at most three weeks ahead).
  let nextOpen: number | null = null, nextClose: number | null = isOpen ? h.close : null;
  for (let i = 0; i < 21 && nextOpen === null; i++) {
    const dh = hoursOn(x, today + i * DAY);
    if (dh.open !== null && dh.open > now) { nextOpen = dh.open; if (nextClose === null) nextClose = dh.close; }
  }
  const reason = isOpen ? (h.earlyClose ? `open, early close today (${h.earlyClose})` : "open: regular trading hours")
    : h.holiday ? `closed for ${h.holiday}` : h.open === null ? "closed: weekend"
    : now < (h.open ?? 0) ? "closed: before the opening bell" : "closed: after the closing bell";
  return {
    exchange: code, name: x.name, open: isOpen, session, reason,
    now: iso(now), timezone: x.zone, localTime: `${ymd(today)}T${String(local.h).padStart(2, "0")}:${String(local.mi).padStart(2, "0")}`,
    today: { date: h.date, tradingDay: h.open !== null, holiday: h.holiday, earlyClose: h.earlyClose, opens: iso(h.open), closes: iso(h.close) },
    nextOpen: iso(nextOpen), nextClose: iso(nextClose),
    minutesUntilChange: isOpen ? Math.round(((h.close ?? now) - now) / 60_000) : nextOpen ? Math.round((nextOpen - now) / 60_000) : null,
    note: "Computed from the exchange's published hours, holidays and scheduled early closes. Unscheduled closures (a day of mourning, a market-wide halt) are not known in advance.",
  };
}

export const MARKET_HOURS: Entry[] = [
  entry("/market/is-open", "Is the stock market open right now: NYSE, Nasdaq, LSE",
    "Is the stock market open right now? For the NYSE and Nasdaq (default) or the London Stock Exchange: open or closed, the session (regular, pre-market, after-hours) and why (weekend, holiday by name, early close), today's open and close, the next open and close in UTC and minutes until the next change. From each exchange's published hours, holidays and early closes, daylight saving included; `at` asks about another moment.",
    ["market-hours", "stock-market-open", "market-status", "trading-hours", "nyse-hours", "stocks", "finance"],
    {
      exchange: { type: "string", description: "NYSE (default), NASDAQ or LSE; also accepts US, UK, London", example: "NYSE" },
      at: { type: "string", description: "Moment to ask about, ISO 8601 (default: now)", example: "2026-11-27T17:30:00Z" },
    },
    { exchange: "NYSE", name: "New York Stock Exchange", open: true, session: "regular", reason: "open, early close today (Day after Thanksgiving)", now: "2026-11-27T17:30:00.000Z", timezone: "America/New_York", localTime: "2026-11-27T12:30", today: { date: "2026-11-27", tradingDay: true, holiday: null, earlyClose: "Day after Thanksgiving", opens: "2026-11-27T14:30:00.000Z", closes: "2026-11-27T18:00:00.000Z" }, nextOpen: "2026-11-30T14:30:00.000Z", nextClose: "2026-11-27T18:00:00.000Z", minutesUntilChange: 30 },
    (_e, q) => {
      const code = exchangeKey(opt(q, "exchange", 40));
      const at = opt(q, "at", 40);
      const now = at ? Date.parse(at) : Date.now();
      if (Number.isNaN(now)) throw new HttpError(400, "at must be an ISO 8601 date and time, for example 2026-11-27T17:30:00Z");
      if (Math.abs(now - Date.now()) > 3_660 * DAY) throw new HttpError(400, "at must be within ten years of today");
      return marketStatus(code, now);
    }),
];
