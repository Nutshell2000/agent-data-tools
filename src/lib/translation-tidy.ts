/**
 * M2M100 (Workers AI @cf/meta/m2m100-1.2b) returns its tokenizer's spacing: "Hola , mundo !" and "( así )". Seen on the
 * 1.204.0 staging proofs of /subtitles/translate and /dub (16 Nov 2026). This puts punctuation back against the word.
 * French keeps its space before ; : ! ? and inside « », which is correct French typography.
 */
export function tidyTranslation(text: string, to?: string): string {
  const french = /^fr/i.test(to ?? "");
  let t = text.replace(/[ \t]+([,.)\]}%…])/g, "$1").replace(/([(\[{¿¡])[ \t]+/g, "$1");
  if (!french) t = t.replace(/[ \t]+([;:!?»])/g, "$1").replace(/(«)[ \t]+/g, "$1");
  // A stray space inside an apostrophe contraction: "l ' homme", "don ' t".
  t = t.replace(/(\p{L})[ \t]*(['’])[ \t]*(\p{L})/gu, "$1$2$3");
  return t.replace(/[ \t]{2,}/g, " ").trim();
}
