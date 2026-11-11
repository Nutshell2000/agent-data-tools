// @ts-nocheck
// GENERATED from C:\SpellzCode\02-Affarsomraden\G-Sann\sann-engine (scripts/copy-to-api.mjs). Edit there, not here.
// Sann rule set v1: environmental claims under Directive (EU) 2024/825 (amending the UCPD, Directive 2005/29/EC).
// Every citation was checked against the official EN and SV texts on EUR-Lex (CELEX 32024L0825) on 11 Nov 2026.
// Severity: "high" = a practice on the Annex I black list (banned in all circumstances when its conditions are met);
// "medium" = allowed only with evidence or a plan; "info" = looks fine, keep the proof.

export const RULESET_VERSION = "2026-11-11.1";

export const SEVERITY_ORDER = { info: 0, medium: 1, high: 2 };

export const RULES = {
  GENERIC: {
    severity: "high",
    ref: {
      en: "UCPD Annex I point 4a and Art. 2(p), added by Directive (EU) 2024/825",
      sv: "UCPD bilaga I punkt 4a och art. 2 p, införda genom direktiv (EU) 2024/825",
    },
    title: { en: "Generic environmental claim", sv: "Allmänt miljöpåstående" },
    why: {
      en: "Vague words such as 'eco-friendly', 'green', 'sustainable' or 'climate friendly' are banned in EU consumer marketing unless the product has recognised excellent environmental performance relevant to the claim (the EU Ecolabel, an officially recognised type I ecolabel such as the Nordic Swan, or top performance under EU law such as energy class A). The word is not generic if the exact specification stands clearly next to it.",
      sv: "Vaga ord som ”miljövänlig”, ”grön”, ”hållbar” eller ”klimatvänlig” är förbjudna i marknadsföring till konsumenter i EU, om inte produkten har erkänd utmärkt miljöprestanda som är relevant för påståendet (EU-miljömärket, en officiellt erkänd miljömärkning av typ I som Svanen, eller högsta prestanda enligt EU-rätten som energiklass A). Ordet räknas inte som allmänt om den exakta specifikationen står tydligt bredvid.",
    },
    fix: {
      en: "Remove the word, or replace it with the specific fact you can prove, shown right next to it, e.g. 'made from 70% recycled polyester (GRS certified)'. Sann never writes the fact for you.",
      sv: "Ta bort ordet, eller ersätt det med det konkreta faktum du kan bevisa och visa det direkt bredvid, t.ex. ”tillverkad av 70 % återvunnen polyester (GRS-certifierad)”. Sann hittar aldrig på faktumet åt dig.",
    },
  },
  OFFSET: {
    severity: "high",
    ref: {
      en: "UCPD Annex I point 4c, added by Directive (EU) 2024/825 (see recital 12)",
      sv: "UCPD bilaga I punkt 4c, införd genom direktiv (EU) 2024/825 (se skäl 12)",
    },
    title: { en: "Climate-neutral claim", sv: "Påstående om klimatneutralitet" },
    why: {
      en: "Claiming that a product is 'climate neutral', 'CO2 neutral', 'carbon positive' or has a reduced climate impact because greenhouse gas emissions are offset is banned. Such claims are allowed only when based on the product's actual life-cycle impact, not on offsetting outside its value chain.",
      sv: "Att påstå att en produkt är ”klimatneutral”, ”koldioxidneutral”, ”koldioxidpositiv” eller har minskad klimatpåverkan tack vare kompensation för växthusgasutsläpp är förbjudet. Sådana påståenden är tillåtna bara om de bygger på produktens faktiska livscykelpåverkan, inte på kompensation utanför värdekedjan.",
    },
    fix: {
      en: "Remove the claim. You may describe your climate-project funding separately as a contribution, without saying it makes the product neutral. Real life-cycle reductions may be stated with evidence.",
      sv: "Ta bort påståendet. Finansiering av klimatprojekt får beskrivas separat som ett bidrag, utan att säga att det gör produkten neutral. Verkliga minskningar under livscykeln får anges med bevis.",
    },
  },
  LABEL: {
    severity: "high",
    ref: {
      en: "UCPD Annex I point 2a and Art. 2(q)-(r), added by Directive (EU) 2024/825",
      sv: "UCPD bilaga I punkt 2a och art. 2 q–r, införda genom direktiv (EU) 2024/825",
    },
    title: { en: "Sustainability label without a certification scheme", sv: "Hållbarhetsmärkning utan certifieringssystem" },
    why: {
      en: "Displaying a sustainability label, badge or seal is banned unless it is based on a certification scheme with independent third-party checks, or was set up by a public authority. Self-made labels are not allowed.",
      sv: "Att visa en hållbarhetsmärkning, symbol eller stämpel är förbjudet om den inte grundas på ett certifieringssystem med oberoende kontroll av tredje part eller har fastställts av en offentlig myndighet. Egna märken är inte tillåtna.",
    },
    fix: {
      en: "Name the scheme and keep the certificate (e.g. the Nordic Swan licence number), or remove the label.",
      sv: "Ange systemet och spara certifikatet (t.ex. Svanens licensnummer), eller ta bort märkningen.",
    },
  },
  ORGANIC: {
    severity: "high",
    ref: {
      en: "UCPD Annex I point 4a (recital 9 lists 'ecological') and Regulation (EU) 2018/848 for farm products",
      sv: "UCPD bilaga I punkt 4a (skäl 9 nämner ”ekologisk”) och förordning (EU) 2018/848 för jordbruksprodukter",
    },
    title: { en: "Organic or 'ecological' claim", sv: "Påstående om ekologiskt" },
    why: {
      en: "For food and farm products 'organic' (ekologisk, bio, öko, ecológico) is protected by law and needs certification. For other products such as textiles it must be proven, normally with a certificate such as GOTS or OCS. Without one, the word works as a banned generic claim.",
      sv: "För livsmedel och jordbruksprodukter är ”ekologisk” (organic, bio, öko) skyddat i lag och kräver certifiering. För andra produkter, som textil, måste det kunna bevisas, normalt med ett certifikat som GOTS eller OCS. Utan certifikat blir ordet ett förbjudet allmänt miljöpåstående.",
    },
    fix: {
      en: "Name the certification (EU organic logo, KRAV, GOTS, OCS) and keep the certificate, or remove the word.",
      sv: "Ange certifieringen (EU:s ekologiska logotyp, KRAV, GOTS, OCS) och spara certifikatet, eller ta bort ordet.",
    },
  },
  PART: {
    severity: "medium",
    ref: {
      en: "UCPD Annex I point 4b and Art. 6(1)(b), as amended by Directive (EU) 2024/825 (see recital 11)",
      sv: "UCPD bilaga I punkt 4b och art. 6.1 b, i lydelsen enligt direktiv (EU) 2024/825 (se skäl 11)",
    },
    title: { en: "Specific claim without the details", sv: "Konkret påstående utan detaljer" },
    why: {
      en: "Words such as 'recycled', 'recyclable', 'compostable' or 'plastic-free' must be true for exactly the part they describe. A claim about the whole product when it concerns only one part (for example only the packaging) is banned.",
      sv: "Ord som ”återvunnen”, ”återvinningsbar”, ”komposterbar” eller ”plastfri” måste stämma för exakt den del de beskriver. Ett påstående om hela produkten när det bara gäller en del (till exempel bara förpackningen) är förbjudet.",
    },
    fix: {
      en: "Say how much (%), which part, and under which conditions (e.g. 'industrially compostable, EN 13432'). Keep the evidence.",
      sv: "Ange hur mycket (%), vilken del och under vilka villkor (t.ex. ”industriellt komposterbar, EN 13432”). Spara beviset.",
    },
  },
  FUTURE: {
    severity: "medium",
    ref: {
      en: "UCPD Art. 6(2)(d), added by Directive (EU) 2024/825 (see recital 4)",
      sv: "UCPD art. 6.2 d, infört genom direktiv (EU) 2024/825 (se skäl 4)",
    },
    title: { en: "Promise about future environmental performance", sv: "Löfte om framtida miljöprestanda" },
    why: {
      en: "Promises such as 'climate neutral by 2030' are allowed only with clear, public and verifiable commitments in a detailed, realistic implementation plan with measurable, time-bound targets, regularly verified by an independent expert whose findings are available to consumers.",
      sv: "Löften som ”klimatneutrala 2030” är tillåtna bara med tydliga, offentliga och kontrollerbara åtaganden i en detaljerad och realistisk genomförandeplan med mätbara och tidsbundna mål, som regelbundet kontrolleras av en oberoende expert vars slutsatser är tillgängliga för konsumenterna.",
    },
    fix: {
      en: "Link to the published plan and the independent expert's findings, or remove the promise.",
      sv: "Länka till den publicerade planen och den oberoende expertens slutsatser, eller ta bort löftet.",
    },
  },
  COMPARISON: {
    severity: "medium",
    ref: {
      en: "UCPD Art. 2(o) and 6(1)(b); an unspecified comparison is also a generic claim under Annex I point 4a",
      sv: "UCPD art. 2 o och 6.1 b; en ospecificerad jämförelse är också ett allmänt miljöpåstående enligt bilaga I punkt 4a",
    },
    title: { en: "Environmental comparison", sv: "Miljöjämförelse" },
    why: {
      en: "Saying a product is less damaging to the environment than others is an environmental claim. Without a specification ('greener than') it is a banned generic claim; with figures it must be accurate and say what is compared and how it was measured.",
      sv: "Att säga att en produkt är mindre skadlig för miljön än andra är ett miljöpåstående. Utan specifikation (”grönare än”) är det ett förbjudet allmänt påstående; med siffror måste det stämma och ange vad som jämförs och hur det har mätts.",
    },
    fix: {
      en: "State what you compare with, the figure, the method and the source, or remove the comparison.",
      sv: "Ange vad ni jämför med, siffran, metoden och källan, eller ta bort jämförelsen.",
    },
  },
  LEGAL: {
    severity: "medium",
    ref: {
      en: "UCPD Annex I point 10a, added by Directive (EU) 2024/825 (see recital 15)",
      sv: "UCPD bilaga I punkt 10a, införd genom direktiv (EU) 2024/825 (se skäl 15)",
    },
    title: { en: "Legal requirement shown as an advantage", sv: "Lagkrav framställt som en fördel" },
    why: {
      en: "Presenting something the law already requires of all products in the category on the EU market (for example 'RoHS compliant' electronics, or 'free from' a substance that is already banned) as a distinctive feature of your offer is banned.",
      sv: "Att framställa något som lagen redan kräver av alla produkter i kategorin på EU-marknaden (t.ex. ”RoHS-kompatibel” elektronik, eller ”fri från” ett ämne som redan är förbjudet) som utmärkande för ert erbjudande är förbjudet.",
    },
    fix: {
      en: "Check whether EU law requires it for every product in this category. If it does, remove it or state it neutrally as a legal requirement.",
      sv: "Kontrollera om EU-rätten kräver det av alla produkter i kategorin. Gör den det, ta bort det eller skriv neutralt att det är ett lagkrav.",
    },
  },
  DURABILITY: {
    severity: "medium",
    ref: {
      en: "UCPD Annex I points 23g and 23h, added by Directive (EU) 2024/825",
      sv: "UCPD bilaga I punkterna 23g och 23h, införda genom direktiv (EU) 2024/825",
    },
    title: { en: "Durability or repair claim", sv: "Påstående om livslängd eller reparation" },
    why: {
      en: "Falsely claiming that a product lasts a certain time or intensity under normal use, or presenting it as repairable when it is not, is banned.",
      sv: "Att felaktigt påstå att en vara under normal användning håller en viss tid eller intensitet, eller framställa den som reparerbar när den inte är det, är förbjudet.",
    },
    fix: {
      en: "State the tested lifetime or the real repair options (spare parts and how long they are available), or rewrite to what you can prove.",
      sv: "Ange testad livslängd eller de verkliga reparationsmöjligheterna (reservdelar och hur länge de finns), eller skriv om till det ni kan bevisa.",
    },
  },
  CERTIFIED: {
    severity: "info",
    ref: {
      en: "UCPD Annex I point 2a: labels based on a certification scheme or set up by a public authority are allowed",
      sv: "UCPD bilaga I punkt 2a: märkning som grundas på ett certifieringssystem eller fastställts av en myndighet är tillåten",
    },
    title: { en: "Certification named", sv: "Certifiering angiven" },
    why: {
      en: "Naming a real certification scheme is fine when the product holds the certificate and it covers this exact claim.",
      sv: "Att ange ett riktigt certifieringssystem är bra när produkten har certifikatet och det täcker just detta påstående.",
    },
    fix: {
      en: "Keep the certificate or licence number, and consider showing it on the page.",
      sv: "Spara certifikatet eller licensnumret och visa det gärna på sidan.",
    },
  },
};

// Notes attached to individual findings when the context changes the assessment.
export const NOTES = {
  specified: {
    en: "A specification seems to follow in the same sentence. If it is clear, prominent and true, the word is not a generic claim; keep the evidence.",
    sv: "En specifikation verkar följa i samma mening. Är den tydlig, väl synlig och sann räknas ordet inte som allmänt; spara beviset.",
  },
  type1: {
    en: "An official ecolabel is named in the same sentence. The word is allowed only if that label covers this exact claim.",
    sv: "En officiell miljömärkning anges i samma mening. Ordet är tillåtet bara om märkningen täcker just detta påstående.",
  },
  classA: {
    en: "An energy class is named. 'Energy efficient' is allowed only with class A on the EU energy label.",
    sv: "En energiklass anges. ”Energieffektiv” är tillåtet bara med klass A på EU:s energimärkning.",
  },
  social: {
    en: "Words like 'sustainable', 'conscious' or 'responsible' also cover social aspects, so an ecolabel alone does not justify them.",
    sv: "Ord som ”hållbar”, ”medveten” eller ”ansvarsfull” omfattar även sociala aspekter, så en miljömärkning räcker inte ensam.",
  },
  offsetWord: {
    en: "The sentence mentions offsetting or compensation, which makes this a banned claim.",
    sv: "Meningen nämner kompensation, vilket gör detta till ett förbjudet påstående.",
  },
  bothMeanings: {
    en: "This word means both 'sustainable' and 'durable'. Either meaning needs evidence.",
    sv: "Ordet betyder både ”hållbar” i miljömening och ”slitstark”. Båda betydelserna kräver bevis.",
  },
};

export function ruleText(id, lang = "en") {
  const r = RULES[id];
  if (!r) return null;
  const l = lang === "sv" ? "sv" : "en";
  return { id, severity: r.severity, title: r.title[l], why: r.why[l], fix: r.fix[l], ref: r.ref[l] };
}

export function noteText(key, lang = "en") {
  const n = NOTES[key];
  return n ? n[lang === "sv" ? "sv" : "en"] : null;
}
