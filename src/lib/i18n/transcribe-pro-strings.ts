// /transcribe-pro in other languages, step B of the i18n plan: the search title (<= 60 characters) and description
// (<= 160) first, so the page can join the hreflang cluster as soon as its body is translated. English is the source,
// as lib/voice-pro.ts writes it today; hours and price are computed by the page (voiceProHours, VOICE_PRO_CENTS).
// tests/i18n.test.cjs checks the lengths with a three-digit hour count and the owner's rules per language.
import type { Lang } from "./locales";

export interface ProMeta { title: (brand: string, hours: number, price: string) => string; description: (hours: number, price: string) => string }

export const TRANSCRIBE_PRO_META: Record<Lang, ProMeta> = {
  en: {
    title: (b, h, p) => `${b} Transcribe Pro: ${h} hours a month for ${p}`,
    description: (h, p) => `Audio and video to text on our servers, with SRT and VTT subtitles in 90+ languages. ${p} a month is about ${h} hours. No account, cancel any time.`,
  },
  es: {
    title: (b, h, p) => `Transcribe Pro: ${h} horas al mes por ${p} | ${b}`,
    description: (h, p) => `Audio y vídeo a texto en nuestros servidores, con subtítulos SRT y VTT en más de 90 idiomas. ${p} al mes, unas ${h} horas. Sin cuenta; cancela cuando quieras.`,
  },
  de: {
    title: (b, h, p) => `Transcribe Pro: ${h} Stunden im Monat für ${p} | ${b}`,
    description: (h, p) => `Audio und Video in Text auf unseren Servern, mit SRT- und VTT-Untertiteln in über 90 Sprachen. ${p} im Monat, etwa ${h} Stunden. Ohne Konto, jederzeit kündbar.`,
  },
  fr: {
    title: (b, h, p) => `Transcribe Pro : ${h} heures par mois pour ${p} | ${b}`,
    description: (h, p) => `Audio et vidéo en texte sur nos serveurs, sous-titres SRT et VTT en plus de 90 langues. ${p} par mois : environ ${h} heures. Sans compte, sans engagement.`,
  },
};
