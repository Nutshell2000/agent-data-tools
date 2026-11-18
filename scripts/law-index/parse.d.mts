// Types for parse.mjs, which the Worker also uses (src/lib/law-versions.ts reads past versions of an act with it).
export interface ParsedItem { kind: "article" | "recital"; num: string; heading: string | null; text: string }
export interface Parsed { title: string | null; items: ParsedItem[]; anchors?: boolean }
export function decode(s: string): string;
export function plain(html: string): string;
export function parseAct(html: string): Parsed;
export function parsePlainLayout(html: string): Parsed;
export function paragraphOfLines(text: string): (string | null)[];
export function chunksWithParagraph(text: string, max?: number): { text: string; para: string | null }[];
export function chunks(text: string, max?: number): string[];
