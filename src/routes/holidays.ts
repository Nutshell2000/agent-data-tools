// Public holidays computed from each country's statutory rules (fixed dates, Easter offsets
// and nth-weekday rules), so no data provider's terms apply. Nationwide holidays only;
// one-off holidays proclaimed for a single year (coronations, jubilees) are not included.
// Years start at 2024 so earlier rule changes (Juneteenth 2021, Denmark's Store Bededag
// abolished in 2024) never need special cases.

interface Rule { name: string; local: string; on: (y: number) => Date }
interface Country { name: string; rules: Rule[]; observe?: "us" | "gb" }

const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));
const addDays = (date: Date, n: number) => new Date(date.getTime() + n * 864e5);
const iso = (date: Date) => date.toISOString().slice(0, 10);

/** Gregorian Easter Sunday (anonymous Gregorian algorithm). */
export function easter(y: number): Date {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, dd = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - dd - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return d(y, month, day);
}
const fromEaster = (n: number) => (y: number) => addDays(easter(y), n);
const fixed = (m: number, day: number) => (y: number) => d(y, m, day);
/** n-th given weekday (0 = Sunday) of a month; n = -1 is the last one. */
const nth = (m: number, weekday: number, n: number) => (y: number) => {
  if (n > 0) {
    const first = d(y, m, 1);
    return addDays(first, ((weekday - first.getUTCDay() + 7) % 7) + (n - 1) * 7);
  }
  const last = d(y, m + 1, 0);
  return addDays(last, -((last.getUTCDay() - weekday + 7) % 7));
};
/** The given weekday falling within [day, day + 6] of a month (e.g. Swedish Midsummer Day). */
const weekdayFrom = (m: number, day: number, weekday: number) => (y: number) => {
  const start = d(y, m, day);
  return addDays(start, (weekday - start.getUTCDay() + 7) % 7);
};
const r = (name: string, local: string, on: Rule["on"]): Rule => ({ name, local, on });
const MON = 1, THU = 4, SAT = 6;

export const COUNTRIES: Record<string, Country> = {
  US: { name: "United States (federal)", observe: "us", rules: [
    r("New Year's Day", "New Year's Day", fixed(1, 1)), r("Martin Luther King Jr. Day", "Martin Luther King Jr. Day", nth(1, MON, 3)),
    r("Washington's Birthday", "Washington's Birthday", nth(2, MON, 3)), r("Memorial Day", "Memorial Day", nth(5, MON, -1)),
    r("Juneteenth National Independence Day", "Juneteenth", fixed(6, 19)), r("Independence Day", "Independence Day", fixed(7, 4)),
    r("Labor Day", "Labor Day", nth(9, MON, 1)), r("Columbus Day", "Columbus Day", nth(10, MON, 2)),
    r("Veterans Day", "Veterans Day", fixed(11, 11)), r("Thanksgiving Day", "Thanksgiving Day", nth(11, THU, 4)),
    r("Christmas Day", "Christmas Day", fixed(12, 25)),
  ] },
  GB: { name: "United Kingdom (England and Wales bank holidays)", observe: "gb", rules: [
    r("New Year's Day", "New Year's Day", fixed(1, 1)), r("Good Friday", "Good Friday", fromEaster(-2)), r("Easter Monday", "Easter Monday", fromEaster(1)),
    r("Early May bank holiday", "Early May bank holiday", nth(5, MON, 1)), r("Spring bank holiday", "Spring bank holiday", nth(5, MON, -1)),
    r("Summer bank holiday", "Summer bank holiday", nth(8, MON, -1)), r("Christmas Day", "Christmas Day", fixed(12, 25)), r("Boxing Day", "Boxing Day", fixed(12, 26)),
  ] },
  SE: { name: "Sweden", rules: [
    r("New Year's Day", "Nyårsdagen", fixed(1, 1)), r("Epiphany", "Trettondedag jul", fixed(1, 6)), r("Good Friday", "Långfredagen", fromEaster(-2)),
    r("Easter Sunday", "Påskdagen", fromEaster(0)), r("Easter Monday", "Annandag påsk", fromEaster(1)), r("May Day", "Första maj", fixed(5, 1)),
    r("Ascension Day", "Kristi himmelsfärdsdag", fromEaster(39)), r("Whit Sunday", "Pingstdagen", fromEaster(49)), r("National Day", "Sveriges nationaldag", fixed(6, 6)),
    r("Midsummer Day", "Midsommardagen", weekdayFrom(6, 20, SAT)), r("All Saints' Day", "Alla helgons dag", weekdayFrom(10, 31, SAT)),
    r("Christmas Day", "Juldagen", fixed(12, 25)), r("Boxing Day", "Annandag jul", fixed(12, 26)),
  ] },
  DE: { name: "Germany (nationwide)", rules: [
    r("New Year's Day", "Neujahr", fixed(1, 1)), r("Good Friday", "Karfreitag", fromEaster(-2)), r("Easter Monday", "Ostermontag", fromEaster(1)),
    r("Labour Day", "Tag der Arbeit", fixed(5, 1)), r("Ascension Day", "Christi Himmelfahrt", fromEaster(39)), r("Whit Monday", "Pfingstmontag", fromEaster(50)),
    r("German Unity Day", "Tag der Deutschen Einheit", fixed(10, 3)), r("Christmas Day", "Erster Weihnachtstag", fixed(12, 25)), r("St. Stephen's Day", "Zweiter Weihnachtstag", fixed(12, 26)),
  ] },
  FR: { name: "France (metropolitan)", rules: [
    r("New Year's Day", "Jour de l'an", fixed(1, 1)), r("Easter Monday", "Lundi de Pâques", fromEaster(1)), r("Labour Day", "Fête du Travail", fixed(5, 1)),
    r("Victory in Europe Day", "Victoire 1945", fixed(5, 8)), r("Ascension Day", "Ascension", fromEaster(39)), r("Whit Monday", "Lundi de Pentecôte", fromEaster(50)),
    r("Bastille Day", "Fête nationale", fixed(7, 14)), r("Assumption Day", "Assomption", fixed(8, 15)), r("All Saints' Day", "Toussaint", fixed(11, 1)),
    r("Armistice Day", "Armistice 1918", fixed(11, 11)), r("Christmas Day", "Noël", fixed(12, 25)),
  ] },
  NO: { name: "Norway", rules: [
    r("New Year's Day", "Første nyttårsdag", fixed(1, 1)), r("Maundy Thursday", "Skjærtorsdag", fromEaster(-3)), r("Good Friday", "Langfredag", fromEaster(-2)),
    r("Easter Sunday", "Første påskedag", fromEaster(0)), r("Easter Monday", "Andre påskedag", fromEaster(1)), r("Labour Day", "Arbeidernes dag", fixed(5, 1)),
    r("Constitution Day", "Grunnlovsdag", fixed(5, 17)), r("Ascension Day", "Kristi himmelfartsdag", fromEaster(39)), r("Whit Sunday", "Første pinsedag", fromEaster(49)),
    r("Whit Monday", "Andre pinsedag", fromEaster(50)), r("Christmas Day", "Første juledag", fixed(12, 25)), r("St. Stephen's Day", "Andre juledag", fixed(12, 26)),
  ] },
  DK: { name: "Denmark", rules: [
    r("New Year's Day", "Nytårsdag", fixed(1, 1)), r("Maundy Thursday", "Skærtorsdag", fromEaster(-3)), r("Good Friday", "Langfredag", fromEaster(-2)),
    r("Easter Sunday", "Påskedag", fromEaster(0)), r("Easter Monday", "Anden påskedag", fromEaster(1)), r("Ascension Day", "Kristi himmelfartsdag", fromEaster(39)),
    r("Whit Sunday", "Pinsedag", fromEaster(49)), r("Whit Monday", "Anden pinsedag", fromEaster(50)), r("Christmas Day", "Juledag", fixed(12, 25)),
    r("St. Stephen's Day", "Anden juledag", fixed(12, 26)),
  ] },
  FI: { name: "Finland", rules: [
    r("New Year's Day", "Uudenvuodenpäivä", fixed(1, 1)), r("Epiphany", "Loppiainen", fixed(1, 6)), r("Good Friday", "Pitkäperjantai", fromEaster(-2)),
    r("Easter Sunday", "Pääsiäispäivä", fromEaster(0)), r("Easter Monday", "2. pääsiäispäivä", fromEaster(1)), r("May Day", "Vappu", fixed(5, 1)),
    r("Ascension Day", "Helatorstai", fromEaster(39)), r("Whit Sunday", "Helluntaipäivä", fromEaster(49)), r("Midsummer Day", "Juhannuspäivä", weekdayFrom(6, 20, SAT)),
    r("All Saints' Day", "Pyhäinpäivä", weekdayFrom(10, 31, SAT)), r("Independence Day", "Itsenäisyyspäivä", fixed(12, 6)),
    r("Christmas Day", "Joulupäivä", fixed(12, 25)), r("St. Stephen's Day", "Tapaninpäivä", fixed(12, 26)),
  ] },
};

/**
 * Day off when a holiday falls on a weekend. US federal: Saturday moves to Friday, Sunday to Monday.
 * England and Wales: the substitute is the next weekday not already a holiday (so Christmas and
 * Boxing Day on a weekend become Monday 27 and Tuesday 28).
 */
function observedDates(dates: Date[], style: Country["observe"]): (string | null)[] {
  const taken = new Set(dates.map(iso));
  return dates.map((date) => {
    const wd = date.getUTCDay();
    if (wd !== 0 && wd !== 6) return null;
    if (style === "us") return iso(addDays(date, wd === 6 ? -1 : 1));
    let sub = addDays(date, 1);
    while ([0, 6].includes(sub.getUTCDay()) || taken.has(iso(sub))) sub = addDays(sub, 1);
    taken.add(iso(sub));
    return iso(sub);
  });
}

export function holidaysFor(code: string, year: number) {
  const c = COUNTRIES[code];
  if (!c) return null;
  const list = c.rules.map((rule) => ({ rule, date: rule.on(year) })).sort((a, b) => a.date.getTime() - b.date.getTime());
  const observed = c.observe ? observedDates(list.map((h) => h.date), c.observe) : list.map(() => null);
  return {
    country: code, countryName: c.name, year, count: list.length,
    holidays: list.map((h, i) => ({ date: iso(h.date), localName: h.rule.local, name: h.rule.name, nationwide: true, types: ["Public"], observed: observed[i] })),
    note: "Computed from statutory rules; nationwide holidays only. Regional holidays and one-off proclamations are not included.",
  };
}
