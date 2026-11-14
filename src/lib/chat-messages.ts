/**
 * An OpenAI `messages` input as a JSON array, whatever shape the caller sent it in (14 Nov 2026). Chat buyers and routers
 * send `messages` three ways: the array OpenAI documents, ONE message object ({"role":"user","content":"Hi"}), or plain
 * text (messages=Hi). The last two were refused "messages must be valid JSON" / "a JSON array" after the payment had
 * verified. A role-less object and a malformed array are left as sent, so they are still refused (uncharged) with the
 * reason, never guessed at.
 */
export function messagesAsArray(raw: string | undefined): string | undefined {
  const text = raw?.trim();
  if (!text) return undefined;
  if (text.startsWith("[")) return text;
  if (text.startsWith("{")) {
    try {
      const one = JSON.parse(text) as { role?: unknown };
      return one && typeof one === "object" && !Array.isArray(one) && typeof one.role === "string" ? JSON.stringify([one]) : text;
    } catch { return text; }
  }
  return JSON.stringify([{ role: "user", content: text }]);
}
