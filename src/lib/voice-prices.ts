// Our own voice prices, read from the catalog (never typed). Moved out of voice-compare.ts when the comparison pages
// were removed (owner, 17 Nov 2026: "we are gonna just have the better products"; no rival figures on glyphcall.com).
import { ENDPOINTS } from "../endpoints";

const priceOf = (path: string, fallback: string) => ENDPOINTS.find((e) => e.path === path)?.price ?? fallback;
const usd = (price: string) => Number(price.replace(/[^0-9.]/g, ""));

/** Our side, from the catalog. */
export function ourVoice() {
  const short = priceOf("/transcribe", "$0.01");
  const long = priceOf("/transcribe/long", "$0.05");
  const summary = priceOf("/transcribe/summary", "$0.05");
  const tts = priceOf("/text-to-speech", "$0.08");
  const lite = priceOf("/text-to-speech/lite", "$0.04");
  return {
    short, long, summary, tts, lite,
    longPerHour: usd(long), // one file of up to 60 minutes
    tts1k: usd(tts) / 2, // 2,000 characters a call
    lite1k: usd(lite) / 2,
  };
}
