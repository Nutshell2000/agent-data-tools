// LexGlyph's interface in six languages (16 Nov 2026: "even more user friendly and accessible than Exa").
// The legal texts themselves are never translated by us: results link to the official EUR-Lex text in the visitor's
// language, which is authentic, and the article shown on the page stays in English (the language of our index).
export const UI_LANGS = ["en", "sv", "de", "fr", "es", "pl"] as const;
export type UiLang = (typeof UI_LANGS)[number];
export const UI_LANG_NAMES: Record<UiLang, string> = { en: "English", sv: "Svenska", de: "Deutsch", fr: "Français", es: "Español", pl: "Polski" };

export interface Strings {
  lead: (acts: number) => string;
  question: string;
  placeholder: string;
  allActs: (n: number) => string;
  act: string;
  explain: string;
  search: string;
  help: string;
  tryOne: string;
  found: (n: number) => string;
  none: string;
  left: (n: number) => string;
  officialEn: string;
  officialIn: (language: string) => string;
  readWhole: (recital: boolean) => string;
  copyCite: string;
  copied: string;
  copyFail: string;
  readAloud: string;
  stop: string;
  share: string;
  shareCopied: string;
  plain: string;
  aiNote: string;
  limit: (n: number) => string;
  busy: string;
  failed: string;
  notAct: string;
  why: string;
  whyItems: (acts: number, perDay: number) => string[];
  shortcut: string;
  notAdvice: string;
  skip: string;
  language: string;
}

const en: Strings = {
  lead: (n) => `Find the exact EU law article. Ask in your own language: GDPR, the AI Act, NIS2, DORA, the DSA, MiCA, VAT and ${n - 7} more acts. Free, no account.`,
  question: "Your question",
  placeholder: "e.g. when must a company appoint a data protection officer",
  allActs: (n) => `All ${n} acts`,
  act: "Act",
  explain: "Explain in plain words",
  search: "Search",
  help: "Ask in any EU language. You get a short answer, the articles it rests on and a link to the official text in your language.",
  tryOne: "Try one",
  found: (n) => `${n} provisions found`,
  none: "No provision found: try other words, or choose an act.",
  left: (n) => `${n} free searches left today`,
  officialEn: "official text (English)",
  officialIn: (l) => `official text in ${l}`,
  readWhole: (r) => `Read the whole ${r ? "recital" : "article"} (English)`,
  copyCite: "Copy citation",
  copied: "Copied",
  copyFail: "Select the text to copy",
  readAloud: "Read aloud",
  stop: "Stop",
  share: "Copy link to this search",
  shareCopied: "Link copied",
  plain: "In plain words",
  aiNote: "Written by an AI model from the articles below only, which it cites as [1], [2]… Check the article before you rely on it.",
  limit: (n) => `You have used today's ${n} free searches. They come back tomorrow; for more, use the API with a free key.`,
  busy: "LexGlyph is busy right now; please try again in a minute.",
  failed: "Something went wrong with this search; please try again.",
  notAct: "That act is not in the index; choose one from the list.",
  why: "Why LexGlyph",
  whyItems: (n, d) => [
    `<strong>The article, not a page about it.</strong> On 102 compliance questions we had not seen before, the right article came first 76 times; a leading web search API managed 34. <a href="/benchmarks">Method and data</a>.`,
    `<strong>Your language.</strong> Ask in any EU language and open the official text in it; questions in Swedish, German, French, Spanish and Polish found the right article in the top five 13 times out of 15 in our test.`,
    `<strong>Official text, dated.</strong> ${n} acts article by article, from the EU's own publications office, with the version and a link to EUR-Lex.`,
    `<strong>No account, no cookies.</strong> ${d} free searches a day. Read aloud, share and copy a citation in one click.`,
  ],
  shortcut: "Press / to search",
  notAdvice: "Not legal advice.",
  skip: "Skip to results",
  language: "Language",
};

const sv: Strings = {
  lead: (n) => `Hitta exakt rätt artikel i EU-rätten. Fråga på ditt eget språk: GDPR, AI-förordningen, NIS2, DORA, DSA, MiCA, moms och ${n - 7} rättsakter till. Gratis, inget konto.`,
  question: "Din fråga",
  placeholder: "t.ex. när måste ett företag utse ett dataskyddsombud",
  allActs: (n) => `Alla ${n} rättsakter`,
  act: "Rättsakt",
  explain: "Förklara med enkla ord",
  search: "Sök",
  help: "Fråga på valfritt EU-språk. Du får ett kort svar, artiklarna det bygger på och en länk till den officiella texten på ditt språk.",
  tryOne: "Prova",
  found: (n) => `${n} bestämmelser hittade`,
  none: "Ingen bestämmelse hittades: prova andra ord eller välj en rättsakt.",
  left: (n) => `${n} gratis sökningar kvar i dag`,
  officialEn: "officiell text (engelska)",
  officialIn: (l) => `officiell text på ${l}`,
  readWhole: (r) => `Läs hela ${r ? "skälet" : "artikeln"} (engelska)`,
  copyCite: "Kopiera hänvisning",
  copied: "Kopierad",
  copyFail: "Markera texten för att kopiera",
  readAloud: "Läs upp",
  stop: "Stopp",
  share: "Kopiera länk till sökningen",
  shareCopied: "Länken kopierad",
  plain: "Med enkla ord",
  aiNote: "Skrivet av en AI-modell enbart utifrån artiklarna nedan, som den hänvisar till som [1], [2]… Kontrollera artikeln innan du förlitar dig på den.",
  limit: (n) => `Du har använt dagens ${n} gratis sökningar. De kommer tillbaka i morgon; för fler, använd API:et med en gratis nyckel.`,
  busy: "LexGlyph är upptaget just nu; försök igen om en minut.",
  failed: "Något gick fel med sökningen; försök igen.",
  notAct: "Den rättsakten finns inte i indexet; välj en i listan.",
  why: "Varför LexGlyph",
  whyItems: (n, d) => [
    `<strong>Själva artikeln, inte en sida om den.</strong> På 102 efterlevnadsfrågor vi inte sett förut kom rätt artikel först 76 gånger; ett ledande sök-API för webben klarade 34. <a href="/benchmarks">Metod och data</a>.`,
    `<strong>Ditt språk.</strong> Fråga på valfritt EU-språk och öppna den officiella texten på det; frågor på svenska, tyska, franska, spanska och polska hittade rätt artikel bland de fem första 13 gånger av 15 i vårt test.`,
    `<strong>Officiell text med datum.</strong> ${n} rättsakter artikel för artikel, från EU:s publikationsbyrå, med version och länk till EUR-Lex.`,
    `<strong>Inget konto, inga kakor.</strong> ${d} gratis sökningar per dag. Läs upp, dela och kopiera en hänvisning med ett klick.`,
  ],
  shortcut: "Tryck / för att söka",
  notAdvice: "Inte juridisk rådgivning.",
  skip: "Hoppa till resultaten",
  language: "Språk",
};

const de: Strings = {
  lead: (n) => `Finden Sie genau den richtigen Artikel im EU-Recht. Fragen Sie in Ihrer Sprache: DSGVO, KI-Verordnung, NIS2, DORA, DSA, MiCA, Mehrwertsteuer und ${n - 7} weitere Rechtsakte. Kostenlos, ohne Konto.`,
  question: "Ihre Frage",
  placeholder: "z. B. wann muss ein Unternehmen einen Datenschutzbeauftragten benennen",
  allActs: (n) => `Alle ${n} Rechtsakte`,
  act: "Rechtsakt",
  explain: "In einfachen Worten erklären",
  search: "Suchen",
  help: "Fragen Sie in jeder EU-Sprache. Sie erhalten eine kurze Antwort, die Artikel, auf denen sie beruht, und einen Link zum amtlichen Text in Ihrer Sprache.",
  tryOne: "Probieren Sie",
  found: (n) => `${n} Bestimmungen gefunden`,
  none: "Keine Bestimmung gefunden: versuchen Sie andere Wörter oder wählen Sie einen Rechtsakt.",
  left: (n) => `heute noch ${n} kostenlose Suchen`,
  officialEn: "amtlicher Text (Englisch)",
  officialIn: (l) => `amtlicher Text auf ${l}`,
  readWhole: (r) => `${r ? "Ganzen Erwägungsgrund" : "Ganzen Artikel"} lesen (Englisch)`,
  copyCite: "Zitat kopieren",
  copied: "Kopiert",
  copyFail: "Text zum Kopieren markieren",
  readAloud: "Vorlesen",
  stop: "Stopp",
  share: "Link zu dieser Suche kopieren",
  shareCopied: "Link kopiert",
  plain: "In einfachen Worten",
  aiNote: "Von einem KI-Modell nur aus den Artikeln unten geschrieben, die es als [1], [2]… zitiert. Prüfen Sie den Artikel, bevor Sie sich darauf verlassen.",
  limit: (n) => `Sie haben die ${n} kostenlosen Suchen für heute verbraucht. Morgen gibt es neue; für mehr nutzen Sie die API mit einem kostenlosen Schlüssel.`,
  busy: "LexGlyph ist gerade ausgelastet; bitte versuchen Sie es in einer Minute erneut.",
  failed: "Bei dieser Suche ist etwas schiefgegangen; bitte erneut versuchen.",
  notAct: "Dieser Rechtsakt ist nicht im Index; wählen Sie einen aus der Liste.",
  why: "Warum LexGlyph",
  whyItems: (n, d) => [
    `<strong>Der Artikel selbst, keine Seite darüber.</strong> Bei 102 Compliance-Fragen, die wir vorher nicht kannten, kam der richtige Artikel 76-mal zuerst; eine führende Websuch-API schaffte 34. <a href="/benchmarks">Methode und Daten</a>.`,
    `<strong>Ihre Sprache.</strong> Fragen Sie in jeder EU-Sprache und öffnen Sie den amtlichen Text in ihr; Fragen auf Schwedisch, Deutsch, Französisch, Spanisch und Polnisch fanden den richtigen Artikel in unserem Test 13 von 15 Mal unter den ersten fünf.`,
    `<strong>Amtlicher Text mit Datum.</strong> ${n} Rechtsakte Artikel für Artikel, vom Amt für Veröffentlichungen der EU, mit Fassung und Link zu EUR-Lex.`,
    `<strong>Kein Konto, keine Cookies.</strong> ${d} kostenlose Suchen pro Tag. Vorlesen, teilen und ein Zitat mit einem Klick kopieren.`,
  ],
  shortcut: "Drücken Sie / zum Suchen",
  notAdvice: "Keine Rechtsberatung.",
  skip: "Zu den Ergebnissen springen",
  language: "Sprache",
};

const fr: Strings = {
  lead: (n) => `Trouvez l'article exact du droit de l'UE. Posez votre question dans votre langue : RGPD, règlement sur l'IA, NIS2, DORA, DSA, MiCA, TVA et ${n - 7} autres actes. Gratuit, sans compte.`,
  question: "Votre question",
  placeholder: "p. ex. quand une entreprise doit-elle désigner un délégué à la protection des données",
  allActs: (n) => `Les ${n} actes`,
  act: "Acte",
  explain: "Expliquer en termes simples",
  search: "Rechercher",
  help: "Posez votre question dans n'importe quelle langue de l'UE. Vous obtenez une réponse courte, les articles sur lesquels elle repose et un lien vers le texte officiel dans votre langue.",
  tryOne: "Essayez",
  found: (n) => `${n} dispositions trouvées`,
  none: "Aucune disposition trouvée : essayez d'autres mots ou choisissez un acte.",
  left: (n) => `encore ${n} recherches gratuites aujourd'hui`,
  officialEn: "texte officiel (anglais)",
  officialIn: (l) => `texte officiel en ${l}`,
  readWhole: (r) => `Lire ${r ? "tout le considérant" : "tout l'article"} (anglais)`,
  copyCite: "Copier la référence",
  copied: "Copié",
  copyFail: "Sélectionnez le texte pour le copier",
  readAloud: "Lire à voix haute",
  stop: "Arrêter",
  share: "Copier le lien de cette recherche",
  shareCopied: "Lien copié",
  plain: "En termes simples",
  aiNote: "Rédigé par un modèle d'IA uniquement à partir des articles ci-dessous, qu'il cite [1], [2]… Vérifiez l'article avant de vous y fier.",
  limit: (n) => `Vous avez utilisé les ${n} recherches gratuites d'aujourd'hui. Elles reviennent demain ; pour plus, utilisez l'API avec une clé gratuite.`,
  busy: "LexGlyph est très sollicité ; réessayez dans une minute.",
  failed: "Un problème est survenu lors de cette recherche ; veuillez réessayer.",
  notAct: "Cet acte n'est pas dans l'index ; choisissez-en un dans la liste.",
  why: "Pourquoi LexGlyph",
  whyItems: (n, d) => [
    `<strong>L'article lui-même, pas une page qui en parle.</strong> Sur 102 questions de conformité inédites, le bon article est arrivé en premier 76 fois ; une grande API de recherche web, 34 fois. <a href="/benchmarks">Méthode et données</a>.`,
    `<strong>Votre langue.</strong> Posez votre question dans n'importe quelle langue de l'UE et ouvrez le texte officiel dans cette langue ; des questions en suédois, allemand, français, espagnol et polonais ont trouvé le bon article parmi les cinq premiers 13 fois sur 15 dans notre test.`,
    `<strong>Texte officiel, daté.</strong> ${n} actes article par article, issus de l'Office des publications de l'UE, avec la version et un lien vers EUR-Lex.`,
    `<strong>Sans compte, sans cookies.</strong> ${d} recherches gratuites par jour. Lecture à voix haute, partage et référence copiée en un clic.`,
  ],
  shortcut: "Appuyez sur / pour rechercher",
  notAdvice: "Ceci n'est pas un conseil juridique.",
  skip: "Aller aux résultats",
  language: "Langue",
};

const es: Strings = {
  lead: (n) => `Encuentra el artículo exacto del Derecho de la UE. Pregunta en tu idioma: RGPD, Reglamento de IA, NIS2, DORA, DSA, MiCA, IVA y ${n - 7} actos más. Gratis, sin cuenta.`,
  question: "Tu pregunta",
  placeholder: "p. ej. cuándo debe una empresa designar un delegado de protección de datos",
  allActs: (n) => `Los ${n} actos`,
  act: "Acto",
  explain: "Explicar con palabras sencillas",
  search: "Buscar",
  help: "Pregunta en cualquier idioma de la UE. Recibes una respuesta breve, los artículos en que se basa y un enlace al texto oficial en tu idioma.",
  tryOne: "Prueba",
  found: (n) => `${n} disposiciones encontradas`,
  none: "No se encontró ninguna disposición: prueba otras palabras o elige un acto.",
  left: (n) => `te quedan ${n} búsquedas gratis hoy`,
  officialEn: "texto oficial (inglés)",
  officialIn: (l) => `texto oficial en ${l}`,
  readWhole: (r) => `Leer ${r ? "todo el considerando" : "todo el artículo"} (inglés)`,
  copyCite: "Copiar cita",
  copied: "Copiado",
  copyFail: "Selecciona el texto para copiarlo",
  readAloud: "Leer en voz alta",
  stop: "Detener",
  share: "Copiar enlace a esta búsqueda",
  shareCopied: "Enlace copiado",
  plain: "Con palabras sencillas",
  aiNote: "Escrito por un modelo de IA solo a partir de los artículos de abajo, que cita como [1], [2]… Comprueba el artículo antes de basarte en él.",
  limit: (n) => `Has usado las ${n} búsquedas gratis de hoy. Vuelven mañana; para más, usa la API con una clave gratuita.`,
  busy: "LexGlyph está ocupado ahora mismo; inténtalo de nuevo en un minuto.",
  failed: "Algo salió mal con esta búsqueda; inténtalo de nuevo.",
  notAct: "Ese acto no está en el índice; elige uno de la lista.",
  why: "Por qué LexGlyph",
  whyItems: (n, d) => [
    `<strong>El artículo, no una página sobre él.</strong> En 102 preguntas de cumplimiento que no habíamos visto, el artículo correcto salió primero 76 veces; una gran API de búsqueda web, 34. <a href="/benchmarks">Método y datos</a>.`,
    `<strong>Tu idioma.</strong> Pregunta en cualquier idioma de la UE y abre el texto oficial en él; preguntas en sueco, alemán, francés, español y polaco encontraron el artículo correcto entre los cinco primeros 13 de 15 veces en nuestra prueba.`,
    `<strong>Texto oficial, con fecha.</strong> ${n} actos artículo por artículo, de la Oficina de Publicaciones de la UE, con la versión y un enlace a EUR-Lex.`,
    `<strong>Sin cuenta, sin cookies.</strong> ${d} búsquedas gratis al día. Lectura en voz alta, compartir y copiar una cita con un clic.`,
  ],
  shortcut: "Pulsa / para buscar",
  notAdvice: "No es asesoramiento jurídico.",
  skip: "Saltar a los resultados",
  language: "Idioma",
};

const pl: Strings = {
  lead: (n) => `Znajdź dokładnie właściwy artykuł prawa UE. Pytaj we własnym języku: RODO, akt w sprawie AI, NIS2, DORA, DSA, MiCA, VAT i ${n - 7} innych aktów. Za darmo, bez konta.`,
  question: "Twoje pytanie",
  placeholder: "np. kiedy firma musi wyznaczyć inspektora ochrony danych",
  allActs: (n) => `Wszystkie akty (${n})`,
  act: "Akt",
  explain: "Wyjaśnij prostymi słowami",
  search: "Szukaj",
  help: "Pytaj w dowolnym języku UE. Otrzymasz krótką odpowiedź, artykuły, na których się opiera, i link do oficjalnego tekstu w Twoim języku.",
  tryOne: "Wypróbuj",
  found: (n) => `Znalezione przepisy: ${n}`,
  none: "Nie znaleziono przepisu: spróbuj innych słów albo wybierz akt.",
  left: (n) => `pozostało dziś bezpłatnych wyszukiwań: ${n}`,
  officialEn: "oficjalny tekst (angielski)",
  officialIn: (l) => `oficjalny tekst: ${l}`,
  readWhole: (r) => `Przeczytaj ${r ? "cały motyw" : "cały artykuł"} (angielski)`,
  copyCite: "Kopiuj przypis",
  copied: "Skopiowano",
  copyFail: "Zaznacz tekst, aby go skopiować",
  readAloud: "Przeczytaj na głos",
  stop: "Zatrzymaj",
  share: "Kopiuj link do wyszukiwania",
  shareCopied: "Link skopiowany",
  plain: "Prostymi słowami",
  aiNote: "Napisane przez model AI wyłącznie na podstawie poniższych artykułów, które cytuje jako [1], [2]… Sprawdź artykuł, zanim na nim polegasz.",
  limit: (n) => `Wykorzystano dzisiejsze bezpłatne wyszukiwania (${n}). Wrócą jutro; aby mieć więcej, użyj API z bezpłatnym kluczem.`,
  busy: "LexGlyph jest teraz zajęty; spróbuj ponownie za minutę.",
  failed: "Coś poszło nie tak z tym wyszukiwaniem; spróbuj ponownie.",
  notAct: "Tego aktu nie ma w indeksie; wybierz akt z listy.",
  why: "Dlaczego LexGlyph",
  whyItems: (n, d) => [
    `<strong>Sam artykuł, a nie strona o nim.</strong> Na 102 nowych pytaniach o zgodność właściwy artykuł był pierwszy 76 razy; czołowe API wyszukiwania w sieci — 34 razy. <a href="/benchmarks">Metoda i dane</a>.`,
    `<strong>Twój język.</strong> Pytaj w dowolnym języku UE i otwieraj oficjalny tekst w tym języku; pytania po szwedzku, niemiecku, francusku, hiszpańsku i polsku znalazły właściwy artykuł w pierwszej piątce 13 razy na 15 w naszym teście.`,
    `<strong>Oficjalny tekst z datą.</strong> ${n} aktów artykuł po artykule, z Urzędu Publikacji UE, z wersją i linkiem do EUR-Lex.`,
    `<strong>Bez konta, bez plików cookie.</strong> ${d} bezpłatnych wyszukiwań dziennie. Czytanie na głos, udostępnianie i kopiowanie przypisu jednym kliknięciem.`,
  ],
  shortcut: "Naciśnij /, aby szukać",
  notAdvice: "To nie jest porada prawna.",
  skip: "Przejdź do wyników",
  language: "Język",
};

export const STRINGS: Record<UiLang, Strings> = { en, sv, de, fr, es, pl };

/** ?lang= first, then the browser's Accept-Language, then English. */
export function pickUiLang(param: string | null, acceptLanguage: string | undefined): UiLang {
  const ok = (x: string | null | undefined): UiLang | null => {
    const two = (x ?? "").toLowerCase().slice(0, 2);
    return (UI_LANGS as readonly string[]).includes(two) ? (two as UiLang) : null;
  };
  if (ok(param)) return ok(param)!;
  for (const part of (acceptLanguage ?? "").split(",")) {
    const hit = ok(part.trim());
    if (hit) return hit;
  }
  return "en";
}

/** A language's name in the interface language ("svenska" in Swedish, "Swedish" in English), for the official-text link. */
export function languageName(code: string, inLang: string): string {
  try { return new Intl.DisplayNames([inLang], { type: "language" }).of(code) ?? code.toUpperCase(); } catch { return code.toUpperCase(); }
}
