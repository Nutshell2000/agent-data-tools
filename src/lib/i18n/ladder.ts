// The three pricing cards (Free, one job, Transcribe Pro) in another language: the same steps, prices and checkout links
// as lib/voice-pro.ts offerLadder, which the English page uses. Every figure comes from lib/credits.ts and the live
// price of /transcribe/long; the words come from lib/i18n/home-strings.ts.
import { VOICE_HOURS_PACK_CREDITS, VOICE_HOURS_PACK_URL, VOICE_PRO_CENTS, VOICE_PRO_URL } from "../credits";
import { hoursFor, largerPlan, voicePrices, voiceProHours } from "../voice-pro";
import type { LadderStrings } from "./home-strings";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function localLadder(L: LadderStrings, brand: string, browserVoices: number): string {
  const prices = voicePrices();
  const price = `$${VOICE_PRO_CENTS / 100}`;
  const hours = voiceProHours(prices.long);
  const pack = hoursFor(VOICE_HOURS_PACK_CREDITS, prices.long);
  const more = largerPlan();
  const li = (items: readonly string[]) => items.map((x) => `<li>${x}</li>`).join("");
  return `<div class="ladder"><div class="tier"><h3>${esc(L.freeName(brand))}</h3><p class="for">${esc(L.freeFor)}</p><div class="p">$0<small> ${esc(L.forever)}</small></div>
<ul>${li(L.freeItemsHtml(browserVoices))}</ul><a class="btn" href="#try" data-ev="free_start">${esc(L.freeGo)}</a></div>
<div class="tier"><h3>${esc(L.onceName)}</h3><p class="for">${esc(L.onceFor)}</p><div class="p">$1<small> ${esc(L.once)}</small></div>
<ul>${li(L.onceItemsHtml(pack))}</ul><a class="btn" href="${esc(VOICE_HOURS_PACK_URL)}" data-ev="pack_click">${esc(L.onceGo(pack))}</a><p class="fine">${esc(L.onceFine)}</p></div>
<div class="tier hot"><span class="tag">${esc(L.proTag)}</span><h3>Transcribe Pro</h3><p class="for">${esc(L.proFor)}</p><div class="p">${esc(price)}<small> ${esc(L.month)}</small></div>
<ul>${li(L.proItemsHtml(hours))}</ul><a class="btn primary" href="${esc(VOICE_PRO_URL)}" data-ev="pro_click">${esc(L.proGo(price))}</a><p class="fine">${esc(L.proFine)}</p></div></div>
<p class="packs" style="justify-content:center">${more ? `<span>${esc(L.moreAsk)}</span><a href="${esc(more.url as string)}">${esc(L.more(`$${more.usdCents / 100}`, hoursFor(more.credits, prices.long)))}</a>` : ""}<a href="/credits">${esc(L.api)}</a></p>`;
}
