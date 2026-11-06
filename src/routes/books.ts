/**
 * Book data (6 Nov 2026). Demand: an ISBN lookup with book metadata (x402-v2-mint-isbn-lookup) was paid by 7 of the 47
 * open shoppers in a two-day sample of Base transfers (107 calls); we only sold ISBN validation. Source: Open Library's
 * public Books and Search APIs (Internet Archive; catalogue data CC0), keyless, about 2 s. Google Books' keyless quota is
 * exhausted for shared callers, so it is not used.
 */
import { entry, getJson, need, num, opt, type Entry } from "../family";
import { HttpError } from "../lib/env";

const OL = "https://openlibrary.org";
const SOURCE = "Open Library (openlibrary.org), catalogue data CC0";

/** "978-0-14-032872-1", "ISBN 0140328726", "0-14-032872-X" -> digits; null when it is no ISBN-10 or ISBN-13. */
export function isbnOf(raw: string): string | null {
  const s = raw.toUpperCase().replace(/^ISBN(-1[03])?:?\s*/, "").replace(/[\s-]/g, "");
  if (/^\d{9}[\dX]$/.test(s)) {
    const sum = [...s].reduce((acc, c, i) => acc + (c === "X" ? 10 : Number(c)) * (10 - i), 0);
    return sum % 11 === 0 ? s : null;
  }
  if (/^97[89]\d{10}$/.test(s)) {
    const sum = [...s.slice(0, 12)].reduce((acc, c, i) => acc + Number(c) * (i % 2 ? 3 : 1), 0);
    return (10 - (sum % 10)) % 10 === Number(s[12]) ? s : null;
  }
  return null;
}

/** ISBN-10 to ISBN-13 (978 prefix); ISBN-13 unchanged. */
export function isbn13(isbn: string): string {
  if (isbn.length === 13) return isbn;
  const core = `978${isbn.slice(0, 9)}`;
  const sum = [...core].reduce((acc, c, i) => acc + Number(c) * (i % 2 ? 3 : 1), 0);
  return core + ((10 - (sum % 10)) % 10);
}

interface OlBook {
  url?: string; key?: string; title?: string; subtitle?: string; authors?: { name?: string }[]; publishers?: { name?: string }[];
  publish_date?: string; number_of_pages?: number; subjects?: { name?: string }[]; cover?: { small?: string; medium?: string; large?: string };
  identifiers?: Record<string, string[]>; languages?: { key?: string }[]; excerpts?: { text?: string }[]; publish_places?: { name?: string }[];
}

export function bookFromOpenLibrary(isbn: string, b: OlBook) {
  const names = (xs?: { name?: string }[]) => (xs ?? []).map((x) => x.name).filter((x): x is string => !!x);
  return {
    isbn13: b.identifiers?.isbn_13?.[0] ?? isbn13(isbn),
    isbn10: b.identifiers?.isbn_10?.[0] ?? (isbn.length === 10 ? isbn : null),
    title: b.title ?? null,
    subtitle: b.subtitle ?? null,
    authors: names(b.authors),
    publishers: names(b.publishers),
    publishDate: b.publish_date ?? null,
    pages: b.number_of_pages ?? null,
    subjects: names(b.subjects).slice(0, 15),
    languages: (b.languages ?? []).map((l) => l.key?.split("/").pop()).filter(Boolean),
    cover: b.cover?.large ?? b.cover?.medium ?? null,
    openLibraryUrl: b.url ?? (b.key ? `${OL}${b.key}` : null),
    otherIds: Object.fromEntries(Object.entries(b.identifiers ?? {}).filter(([k]) => !/^isbn_/.test(k)).map(([k, v]) => [k, v[0]])),
  };
}

export const BOOKS: Entry[] = [
  entry("/book/isbn", "ISBN lookup, book by ISBN",
    "Look up a book by its ISBN-10 or ISBN-13 (hyphens and spaces allowed): title, subtitle, authors, publishers, publish date, page count, subjects, language, cover image and Open Library link, from Open Library's catalogue (CC0). The ISBN check digit is verified first; an invalid or unknown ISBN is refused uncharged. Use to enrich a reading list, a product listing or a citation.",
    ["isbn-lookup", "book-lookup", "isbn", "books", "book-metadata"], {
      isbn: { type: "string", description: "ISBN-10 or ISBN-13, with or without hyphens", required: true, example: "9780140328721" },
    },
    {
      isbn13: "9780140328721", isbn10: "0140328726", title: "Fantastic Mr. Fox", subtitle: null, authors: ["Roald Dahl"], publishers: ["Puffin"],
      publishDate: "October 1, 1988", pages: 96, subjects: ["Animals", "Hunger"], languages: ["eng"], cover: "https://covers.openlibrary.org/b/id/8739161-L.jpg",
      openLibraryUrl: "http://openlibrary.org/books/OL7353617M/Fantastic_Mr._Fox", otherIds: { goodreads: "1507552", openlibrary: "OL7353617M" }, source: SOURCE,
    },
    async (_env, q) => {
      const raw = need(q, "isbn", 40);
      const isbn = isbnOf(raw);
      if (!isbn) throw new HttpError(400, "isbn must be a valid ISBN-10 or ISBN-13 (the check digit did not match)");
      const data = await getJson<Record<string, OlBook>>(`${OL}/api/books?${new URLSearchParams({ bibkeys: `ISBN:${isbn}`, format: "json", jscmd: "data" })}`, { timeoutMs: 10_000 });
      let book = data[`ISBN:${isbn}`];
      // Open Library files some editions under the other form of the number.
      if (!book && isbn.length === 10) book = (await getJson<Record<string, OlBook>>(`${OL}/api/books?${new URLSearchParams({ bibkeys: `ISBN:${isbn13(isbn)}`, format: "json", jscmd: "data" })}`, { timeoutMs: 8_000 }))[`ISBN:${isbn13(isbn)}`];
      if (!book) throw new HttpError(404, `no book with ISBN ${isbn} in Open Library; nothing was charged`);
      return { ...bookFromOpenLibrary(isbn, book), source: SOURCE };
    }),

  entry("/book/search", "Book search, find books by title or author",
    "Search books by title, author or any words: up to 20 works with title, authors, first publish year, edition count, ISBNs (up to 5), publishers, languages, cover image and Open Library link, from Open Library's catalogue (CC0). Filter by author or title alone if you like. Use to find a book's ISBN, an author's works or editions before an ISBN lookup.",
    ["book-search", "books", "find-books", "author-search", "isbn"], {
      q: { type: "string", description: "Words to search for (title, author, subject)", example: "dune frank herbert" },
      title: { type: "string", description: "Search the title only", example: "Dune" },
      author: { type: "string", description: "Search the author only", example: "Frank Herbert" },
      limit: { type: "integer", description: "Number of works (1-20, default 10)", example: 5 },
    },
    {
      query: { q: "dune frank herbert" }, total: 279, count: 1,
      results: [{ title: "Dune", authors: ["Frank Herbert"], firstPublishYear: 1965, editions: 155, isbns: ["9780425043769", "9780575122796"], publishers: ["Ace Books"], languages: ["eng"], cover: "https://covers.openlibrary.org/b/id/11481354-L.jpg", openLibraryUrl: "https://openlibrary.org/works/OL893415W" }],
      source: SOURCE,
    },
    async (_env, q) => {
      const words = opt(q, "q", 200), title = opt(q, "title", 200), author = opt(q, "author", 120);
      if (!words && !title && !author) throw new HttpError(400, "give q, title or author");
      const limit = num(q, "limit", { min: 1, max: 20, fallback: 10, integer: true });
      const params = new URLSearchParams({ limit: String(limit), fields: "key,title,author_name,first_publish_year,edition_count,isbn,publisher,language,cover_i" });
      if (words) params.set("q", words);
      if (title) params.set("title", title);
      if (author) params.set("author", author);
      const data = await getJson<{ numFound?: number; docs?: { key?: string; title?: string; author_name?: string[]; first_publish_year?: number; edition_count?: number; isbn?: string[]; publisher?: string[]; language?: string[]; cover_i?: number }[] }>(`${OL}/search.json?${params}`, { timeoutMs: 10_000 });
      const results = (data.docs ?? []).map((d) => ({
        title: d.title ?? null, authors: d.author_name ?? [], firstPublishYear: d.first_publish_year ?? null, editions: d.edition_count ?? null,
        isbns: (d.isbn ?? []).filter((x) => x.length === 13).slice(0, 5).concat((d.isbn ?? []).filter((x) => x.length === 10).slice(0, Math.max(0, 5 - (d.isbn ?? []).filter((x) => x.length === 13).length))),
        publishers: (d.publisher ?? []).slice(0, 5), languages: (d.language ?? []).slice(0, 5),
        cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : null, openLibraryUrl: d.key ? `${OL}${d.key}` : null,
      }));
      if (!results.length) throw new HttpError(404, "no books found; nothing was charged");
      return { query: Object.fromEntries(Object.entries({ q: words, title, author }).filter(([, v]) => v)), total: data.numFound ?? results.length, count: results.length, results, source: SOURCE };
    }),
];
