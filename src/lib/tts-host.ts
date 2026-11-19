/**
 * tts.glyphcall.com (1.260.0, 19 Nov 2026): a host that answers ONLY the text-to-speech tools.
 *
 * Why: Mercator (the router behind our biggest buyer) imports sellers from the Coinbase Bazaar as one service per host
 * and names the service after one of its listings. All 700+ of our tools share one host, so the service is named "Web,
 * crypto and security data", and the reranker puts endpoints whose service name does not fit the task below lower-scored
 * ones: /ai/speech is #8 for "text to speech" (relevance 0.38 vs 0.73 at the top). In 14 days Mercator's gateway paid
 * another seller $39.80 for generic text to speech at $0.10 a call. A host that lists nothing but speech becomes its own
 * service, named after a speech listing.
 *
 * The tools, prices, payment terms and wallet are the same as on every other host (the 402 resource URL follows the
 * request host). Every other path answers 404 here with the address that serves it, so no other listing can ever be
 * settled on this host and change the service's name. The host is listed only after a tool's first settlement on it.
 */
export const TTS_HOST = "tts.glyphcall.com";

/** The only paths this host serves: the speech tools and the OpenAI-shaped speech front. */
export const TTS_HOST_PATHS: ReadonlySet<string> = new Set(["/ai/speech", "/ai/tts", "/text-to-speech", "/text-to-speech/lite", "/v1/audio/speech"]);

/** Where everything else lives. */
export const TTS_HOST_ELSEWHERE = "https://api.glyphcall.com";

/**
 * What the TTS host answers before anything else runs, or null to let the request through unchanged.
 * Only requests to TTS_HOST are touched; on any other host this always returns null.
 */
export function ttsHostAnswer(requestUrl: string): Response | null {
  const url = new URL(requestUrl);
  if (url.hostname !== TTS_HOST) return null;
  if (TTS_HOST_PATHS.has(url.pathname)) return null;
  const tools = [...TTS_HOST_PATHS].map((p) => `https://${TTS_HOST}${p}`);
  if (url.pathname === "/") {
    return Response.json({
      service: "Text to speech",
      about: "Text to speech API: natural voices, MP3 audio from text, paid per call with x402 (USDC) or a prepaid key. Call a tool URL without payment to get its price and payment terms.",
      tools,
      docs: "https://glyphcall.com/text-to-speech-api",
      everythingElse: TTS_HOST_ELSEWHERE,
    }, { headers: { "Cache-Control": "public, max-age=3600" } });
  }
  return Response.json({
    error: `${TTS_HOST} serves text to speech only; this path is served at ${TTS_HOST_ELSEWHERE}${url.pathname}`,
    code: "NOT_ON_THIS_HOST",
    tools,
    use: `${TTS_HOST_ELSEWHERE}${url.pathname}${url.search}`,
  }, { status: 404, headers: { "Cache-Control": "public, max-age=3600" } });
}
