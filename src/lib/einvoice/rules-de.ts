// German wording for the validation rules and the business terms (14 Nov 2026), for the pages under /de/e-rechnung.
// The people who get an XRechnung rejected are mostly German speakers, and they search the rule number together with
// German words ("BR-DE-15 Fehler", "Leitweg-ID fehlt"). Same rule: our own sentences, never the official text.
// tests/einvoice.test.cjs fails when a rule in validate.ts has no entry here.
import { RULES, type RuleDoc } from "./validate";

type De = readonly [rule: string, fix: string];

const CATEGORY_DE: Readonly<Record<string, { name: string; reason: boolean; buyerVat: boolean; code: string }>> = Object.freeze({
  S: { code: "S", name: "Normalsatz", reason: false, buyerVat: false },
  Z: { code: "Z", name: "Nullsatz", reason: false, buyerVat: false },
  E: { code: "E", name: "Steuerbefreit", reason: true, buyerVat: false },
  AE: { code: "AE", name: "Umkehrung der Steuerschuldnerschaft (Reverse Charge)", reason: true, buyerVat: true },
  IC: { code: "K", name: "Innergemeinschaftliche Lieferung", reason: true, buyerVat: true },
  G: { code: "G", name: "Ausfuhr in ein Drittland", reason: true, buyerVat: false },
});

function categoryRule(key: string, number: string): De | undefined {
  const c = CATEGORY_DE[key];
  if (!c) return undefined;
  const standard = c.code === "S";
  switch (number) {
    case "01": return [
      `Eine Rechnung mit einer Position der Umsatzsteuerkategorie „${c.name}“ (${c.code}) muss ${standard ? "mindestens eine" : "genau eine"} Zeile dieser Kategorie in der Umsatzsteueraufschlüsselung enthalten.`,
      `Ergänzen Sie in der Umsatzsteueraufschlüsselung eine Zeile mit der Kategorie ${c.code}${standard ? " je verwendetem Steuersatz" : ""}, oder korrigieren Sie die Kategorie der Position.`];
    case "02": return [
      `Eine Rechnung mit einer Position „${c.name}“ muss die Umsatzsteuer-Identifikationsnummer oder die Steuernummer des Verkäufers enthalten${c.buyerVat ? " sowie die Umsatzsteuer-Identifikationsnummer des Käufers" : ""}.`,
      c.buyerVat ? "Ergänzen Sie die USt-IdNr. (oder Steuernummer) des Verkäufers und die USt-IdNr. des Käufers." : "Ergänzen Sie die USt-IdNr. des Verkäufers oder, wenn es keine gibt, die Steuernummer."];
    case "05": return standard
      ? ["In einer Position mit Normalsatz muss der Umsatzsteuersatz größer als null sein.", "Tragen Sie den Steuersatz der Position ein (zum Beispiel 19), oder ändern Sie die Kategorie auf Z, E oder AE, wenn keine Umsatzsteuer anfällt."]
      : [`In einer Position „${c.name}“ muss der Umsatzsteuersatz 0 sein.`, "Setzen Sie den Steuersatz der Position auf 0, oder ändern Sie die Kategorie auf S, wenn Umsatzsteuer berechnet wird."];
    case "08": return [
      standard ? "Für jeden Normalsteuersatz muss der steuerpflichtige Betrag in der Umsatzsteueraufschlüsselung der Summe der Nettobeträge der Positionen mit diesem Satz entsprechen." : `Der steuerpflichtige Betrag der Aufschlüsselungszeile „${c.name}“ muss der Summe der Nettobeträge ihrer Positionen entsprechen.`,
      "Berechnen Sie den steuerpflichtigen Betrag der Zeile neu aus den Positionen (zuzüglich Zuschlägen, abzüglich Nachlässen dieser Kategorie)."];
    case "09": return standard
      ? ["Der Steuerbetrag einer Aufschlüsselungszeile mit Normalsatz muss dem steuerpflichtigen Betrag multipliziert mit dem Steuersatz entsprechen.", "Setzen Sie den Steuerbetrag der Zeile auf steuerpflichtiger Betrag x Satz / 100, auf zwei Nachkommastellen gerundet."]
      : [`Der Steuerbetrag der Aufschlüsselungszeile „${c.name}“ muss 0 sein.`, "Setzen Sie den Steuerbetrag der Zeile auf 0.00."];
    case "10": return c.reason
      ? [`Eine Aufschlüsselungszeile „${c.name}“ muss einen Befreiungsgrund enthalten (als Text oder als Code).`, "Ergänzen Sie den Befreiungsgrund, zum Beispiel die Rechtsgrundlage oder „Reverse Charge“."]
      : [`Eine Aufschlüsselungszeile „${c.name}“ darf keinen Befreiungsgrund enthalten.`, "Entfernen Sie den Befreiungsgrund aus dieser Zeile."];
    default: return undefined;
  }
}

const TWO_DECIMALS = "Runden Sie den Betrag auf zwei Nachkommastellen.";

const WRITTEN: Readonly<Record<string, De>> = Object.freeze({
  "BR-01": ["Eine Rechnung muss eine Spezifikationskennung enthalten.", "Ergänzen Sie die Kennung des Standards, dem die Datei folgt, zum Beispiel urn:cen.eu:en16931:2017 oder die XRechnung-Kennung."],
  "BR-02": ["Eine Rechnung muss eine Rechnungsnummer enthalten.", "Ergänzen Sie die Rechnungsnummer."],
  "BR-03": ["Eine Rechnung muss ein Rechnungsdatum enthalten.", "Ergänzen Sie das Rechnungsdatum (CII: Format 102, JJJJMMTT; UBL: JJJJ-MM-TT)."],
  "BR-04": ["Eine Rechnung muss einen Code für den Rechnungstyp enthalten.", "Ergänzen Sie den Code: 380 für eine Rechnung, 381 für eine Gutschrift, 384 für eine Rechnungskorrektur."],
  "BR-05": ["Eine Rechnung muss einen Währungscode enthalten.", "Ergänzen Sie den Währungscode nach ISO 4217, zum Beispiel EUR."],
  "BR-06": ["Eine Rechnung muss den Namen des Verkäufers enthalten.", "Ergänzen Sie den vollständigen Namen des Verkäufers."],
  "BR-07": ["Eine Rechnung muss den Namen des Käufers enthalten.", "Ergänzen Sie den Namen des Käufers."],
  "BR-08": ["Eine Rechnung muss die Postanschrift des Verkäufers enthalten.", "Ergänzen Sie die Anschrift des Verkäufers, mindestens mit dem Ländercode."],
  "BR-09": ["Die Postanschrift des Verkäufers muss einen Ländercode enthalten.", "Ergänzen Sie den zweistelligen Ländercode des Verkäufers nach ISO 3166-1, zum Beispiel DE."],
  "BR-10": ["Eine Rechnung muss die Postanschrift des Käufers enthalten.", "Ergänzen Sie die Anschrift des Käufers, mindestens mit dem Ländercode."],
  "BR-11": ["Die Postanschrift des Käufers muss einen Ländercode enthalten.", "Ergänzen Sie den zweistelligen Ländercode des Käufers nach ISO 3166-1."],
  "BR-12": ["Eine Rechnung muss die Summe der Nettobeträge aller Rechnungspositionen ausweisen.", "Ergänzen Sie die Summe der Positionsnettobeträge."],
  "BR-13": ["Eine Rechnung muss den Gesamtbetrag ohne Umsatzsteuer ausweisen.", "Ergänzen Sie den Gesamtbetrag ohne Umsatzsteuer."],
  "BR-14": ["Eine Rechnung muss den Gesamtbetrag einschließlich Umsatzsteuer ausweisen.", "Ergänzen Sie den Bruttobetrag."],
  "BR-15": ["Eine Rechnung muss den fälligen Zahlungsbetrag ausweisen.", "Ergänzen Sie den Zahlbetrag."],
  "BR-16": ["Eine Rechnung muss mindestens eine Rechnungsposition enthalten.", "Ergänzen Sie mindestens eine Position mit Bezeichnung, Menge, Einheit, Nettopreis und Nettobetrag."],
  "BR-21": ["Jede Rechnungsposition muss eine Positionskennung haben.", "Nummerieren Sie die Positionen (1, 2, 3 …)."],
  "BR-22": ["Jede Rechnungsposition muss eine berechnete Menge enthalten.", "Ergänzen Sie die Menge der Position."],
  "BR-23": ["Jede Rechnungsposition muss einen Code für die Maßeinheit der Menge enthalten.", "Ergänzen Sie einen Einheitencode nach UN/ECE-Empfehlung 20: C62 (Stück), HUR (Stunde), DAY, KGM, LTR, MTR …"],
  "BR-24": ["Jede Rechnungsposition muss einen Nettobetrag enthalten.", "Ergänzen Sie den Nettobetrag der Position (Menge x Nettopreis)."],
  "BR-25": ["Jede Rechnungsposition muss eine Artikelbezeichnung enthalten.", "Ergänzen Sie eine Bezeichnung für den Artikel oder die Leistung."],
  "BR-26": ["Jede Rechnungsposition muss den Nettopreis des Artikels enthalten.", "Ergänzen Sie den Nettopreis je Einheit."],
  "BR-27": ["Der Nettopreis des Artikels darf nicht negativ sein.", "Verwenden Sie einen positiven Preis; stellen Sie einen Abzug als negative Menge oder als Gutschrift dar."],
  "BR-45": ["Jede Zeile der Umsatzsteueraufschlüsselung muss einen steuerpflichtigen Betrag enthalten.", "Ergänzen Sie den steuerpflichtigen Betrag (Bemessungsgrundlage) der Zeile."],
  "BR-46": ["Jede Zeile der Umsatzsteueraufschlüsselung muss einen Steuerbetrag enthalten.", "Ergänzen Sie den Steuerbetrag der Zeile (0.00, wenn keine Umsatzsteuer berechnet wird)."],
  "BR-47": ["Jede Zeile der Umsatzsteueraufschlüsselung muss einen Code für die Umsatzsteuerkategorie enthalten.", "Ergänzen Sie den Kategoriecode: S, Z, E, AE, K, G oder O."],
  "BR-48": ["Jede Zeile der Umsatzsteueraufschlüsselung muss einen Steuersatz enthalten, außer wenn die Rechnung nicht der Umsatzsteuer unterliegt.", "Ergänzen Sie den Satz in Prozent (19, 7, 0)."],
  "BR-61": ["Bei Zahlung per Überweisung (Codes 30 und 58) muss die Kennung des Zahlungskontos angegeben sein.", "Ergänzen Sie die IBAN des Kontos, auf das gezahlt werden soll, oder ändern Sie den Code für das Zahlungsmittel."],
  "BR-62": ["Die elektronische Adresse des Verkäufers muss eine Schema-Kennung haben.", "Ergänzen Sie das Schema, zum Beispiel EM für eine E-Mail-Adresse."],
  "BR-63": ["Die elektronische Adresse des Käufers muss eine Schema-Kennung haben.", "Ergänzen Sie das Schema, zum Beispiel EM für eine E-Mail-Adresse."],
  "BR-CO-04": ["Jede Rechnungsposition muss einen Code für die Umsatzsteuerkategorie enthalten.", "Ergänzen Sie die Umsatzsteuerkategorie der Position (S für den Normalsatz)."],
  "BR-CO-09": ["Eine Umsatzsteuer-Identifikationsnummer muss mit dem zweistelligen Ländercode des Mitgliedstaats beginnen, der sie vergeben hat (EL für Griechenland).", "Schreiben Sie die USt-IdNr. mit Länderpräfix, zum Beispiel DE123456789."],
  "BR-CO-10": ["Die Summe der Positionsnettobeträge muss der Summe der Nettobeträge der einzelnen Positionen entsprechen.", "Berechnen Sie die Summe neu aus den Positionen, oder korrigieren Sie die abweichende Position."],
  "BR-CO-13": ["Der Gesamtbetrag ohne Umsatzsteuer muss der Summe der Positionsnettobeträge abzüglich der Nachlässe und zuzüglich der Zuschläge auf Dokumentenebene entsprechen.", "Berechnen Sie neu: Summe der Positionen - Nachlässe + Zuschläge."],
  "BR-CO-14": ["Der Gesamtbetrag der Umsatzsteuer muss der Summe der Steuerbeträge aller Zeilen der Umsatzsteueraufschlüsselung entsprechen.", "Berechnen Sie den Steuergesamtbetrag neu aus den Zeilen der Aufschlüsselung."],
  "BR-CO-15": ["Der Gesamtbetrag einschließlich Umsatzsteuer muss dem Gesamtbetrag ohne Umsatzsteuer zuzüglich des Umsatzsteuergesamtbetrags entsprechen.", "Berechnen Sie neu: Gesamtbetrag ohne Umsatzsteuer + Umsatzsteuergesamtbetrag."],
  "BR-CO-16": ["Der fällige Zahlungsbetrag muss dem Gesamtbetrag einschließlich Umsatzsteuer abzüglich des bereits gezahlten Betrags und zuzüglich des Rundungsbetrags entsprechen.", "Berechnen Sie neu: Bruttobetrag - Vorauszahlung + Rundung."],
  "BR-CO-17": ["Der Steuerbetrag einer Aufschlüsselungszeile muss dem steuerpflichtigen Betrag multipliziert mit dem Steuersatz entsprechen, auf zwei Nachkommastellen gerundet.", "Berechnen Sie die Zeile neu: steuerpflichtiger Betrag x Satz / 100."],
  "BR-CO-18": ["Eine Rechnung muss mindestens eine Zeile in der Umsatzsteueraufschlüsselung enthalten.", "Ergänzen Sie eine Umsatzsteueraufschlüsselung mit Kategorie, Satz, steuerpflichtigem Betrag und Steuerbetrag."],
  "BR-CO-25": ["Ist der fällige Zahlungsbetrag positiv, muss das Fälligkeitsdatum oder müssen die Zahlungsbedingungen angegeben sein.", "Ergänzen Sie ein Fälligkeitsdatum oder einen Text zu den Zahlungsbedingungen."],
  "BR-CO-26": ["Der Verkäufer muss identifizierbar sein: eine Verkäuferkennung, eine Registernummer oder eine Umsatzsteuer-Identifikationsnummer muss angegeben sein.", "Ergänzen Sie die USt-IdNr. oder die Handelsregisternummer des Verkäufers."],
  "BR-DEC-09": ["Die Summe der Positionsnettobeträge darf höchstens 2 Nachkommastellen haben.", TWO_DECIMALS],
  "BR-DEC-12": ["Der Gesamtbetrag ohne Umsatzsteuer darf höchstens 2 Nachkommastellen haben.", TWO_DECIMALS],
  "BR-DEC-13": ["Der Gesamtbetrag der Umsatzsteuer darf höchstens 2 Nachkommastellen haben.", TWO_DECIMALS],
  "BR-DEC-14": ["Der Gesamtbetrag einschließlich Umsatzsteuer darf höchstens 2 Nachkommastellen haben.", TWO_DECIMALS],
  "BR-DEC-18": ["Der fällige Zahlungsbetrag darf höchstens 2 Nachkommastellen haben.", TWO_DECIMALS],
  "BR-DEC-19": ["Der steuerpflichtige Betrag einer Aufschlüsselungszeile darf höchstens 2 Nachkommastellen haben.", TWO_DECIMALS],
  "BR-DEC-20": ["Der Steuerbetrag einer Aufschlüsselungszeile darf höchstens 2 Nachkommastellen haben.", TWO_DECIMALS],
  "BR-DEC-23": ["Der Nettobetrag einer Rechnungsposition darf höchstens 2 Nachkommastellen haben.", "Runden Sie den Nettobetrag der Position auf zwei Nachkommastellen."],
  "BR-DE-1": ["Eine XRechnung muss Zahlungsanweisungen enthalten.", "Ergänzen Sie den Code für das Zahlungsmittel (58 für eine SEPA-Überweisung) und die Kontodaten."],
  "BR-DE-2": ["Eine XRechnung muss die Gruppe „Kontakt des Verkäufers“ enthalten.", "Ergänzen Sie den Kontakt des Verkäufers: Name, Telefonnummer und E-Mail-Adresse."],
  "BR-DE-3": ["Der Ort des Verkäufers muss angegeben sein.", "Ergänzen Sie den Ort in der Anschrift des Verkäufers."],
  "BR-DE-4": ["Die Postleitzahl des Verkäufers muss angegeben sein.", "Ergänzen Sie die Postleitzahl in der Anschrift des Verkäufers."],
  "BR-DE-5": ["Die Kontaktstelle des Verkäufers (ein Name oder eine Abteilung) muss angegeben sein.", "Ergänzen Sie einen Ansprechpartner des Verkäufers."],
  "BR-DE-6": ["Die Telefonnummer des Verkäuferkontakts muss angegeben sein.", "Ergänzen Sie eine Telefonnummer für den Kontakt des Verkäufers."],
  "BR-DE-7": ["Die E-Mail-Adresse des Verkäuferkontakts muss angegeben sein.", "Ergänzen Sie eine E-Mail-Adresse für den Kontakt des Verkäufers."],
  "BR-DE-8": ["Der Ort des Käufers muss angegeben sein.", "Ergänzen Sie den Ort in der Anschrift des Käufers."],
  "BR-DE-9": ["Die Postleitzahl des Käufers muss angegeben sein.", "Ergänzen Sie die Postleitzahl in der Anschrift des Käufers."],
  "BR-DE-14": ["Jede Zeile der Umsatzsteueraufschlüsselung muss ihren Steuersatz angeben.", "Ergänzen Sie den Satz in jeder Zeile der Aufschlüsselung, auch wenn er 0 ist."],
  "BR-DE-15": ["Die Käuferreferenz muss angegeben sein.", "Ergänzen Sie die Käuferreferenz. Bei öffentlichen Auftraggebern in Deutschland ist das die Leitweg-ID, die Sie vom Auftraggeber erhalten haben; bei anderen Käufern verwenden Sie deren Bestell- oder Kundenreferenz."],
  "BR-DE-16": ["Wird eine der Umsatzsteuerkategorien S, Z, E, AE, K, G, L oder M verwendet, muss die Umsatzsteuer-Identifikationsnummer oder die Steuernummer des Verkäufers angegeben sein.", "Ergänzen Sie die USt-IdNr. oder die Steuernummer des Verkäufers."],
  "BR-DE-17": ["Als Rechnungstyp soll einer der Codes 326, 380, 384, 389, 381, 875, 876 oder 877 verwendet werden.", "Verwenden Sie 380 für eine Rechnung, 381 für eine Gutschrift oder 384 für eine Rechnungskorrektur."],
  "BR-DE-19": ["Beim Zahlungsmittel 58 (SEPA-Überweisung) soll das Zahlungskonto eine korrekte IBAN sein.", "Prüfen Sie die IBAN: Ländercode, Länge und Prüfziffern."],
  "BR-DE-21": ["Die Spezifikationskennung soll der Kennung des Standards XRechnung entsprechen.", "Setzen Sie sie auf urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0."],
  "BR-DE-23-a": ["Ist das Zahlungsmittel eine Überweisung (Code 30 oder 58), müssen die Angaben zur Überweisung übermittelt werden.", "Ergänzen Sie die IBAN (und wahlweise BIC und Kontoinhaber)."],
  "BR-DE-27": ["Die Telefonnummer des Verkäufers soll mindestens drei Ziffern enthalten.", "Geben Sie eine echte Telefonnummer an."],
  "BR-DE-28": ["Die E-Mail-Adresse des Verkäufers soll genau ein @ enthalten, mit mindestens zwei Zeichen auf jeder Seite.", "Korrigieren Sie die E-Mail-Adresse."],
});

/** A rule's German sentence and fix, or undefined when none is written yet. */
export function ruleDe(r: RuleDoc): De | undefined {
  if (Object.hasOwn(WRITTEN, r.id)) return WRITTEN[r.id];
  const m = /^BR-(S|Z|E|AE|IC|G)-(\d\d)$/.exec(r.id);
  return m ? categoryRule(m[1], m[2]) : undefined;
}
export const RULES_WITHOUT_GERMAN = () => RULES.filter((r) => !ruleDe(r)).map((r) => r.id);

/** German names of the business terms the rules name. */
export const TERMS_DE: Readonly<Record<string, string>> = Object.freeze({
  "BT-1": "Rechnungsnummer", "BT-2": "Rechnungsdatum", "BT-3": "Code für den Rechnungstyp", "BT-5": "Code für die Rechnungswährung",
  "BT-9": "Fälligkeitsdatum der Zahlung", "BT-10": "Käuferreferenz (Leitweg-ID)", "BT-20": "Zahlungsbedingungen", "BT-24": "Spezifikationskennung",
  "BT-27": "Name des Verkäufers", "BT-29": "Kennung des Verkäufers", "BT-30": "Registernummer des Verkäufers", "BT-31": "Umsatzsteuer-Identifikationsnummer des Verkäufers",
  "BT-32": "Steuernummer des Verkäufers", "BT-34": "Elektronische Adresse des Verkäufers", "BG-5": "Postanschrift des Verkäufers", "BT-37": "Ort des Verkäufers",
  "BT-38": "Postleitzahl des Verkäufers", "BT-40": "Ländercode des Verkäufers", "BG-6": "Kontakt des Verkäufers", "BT-41": "Kontaktstelle des Verkäufers",
  "BT-42": "Telefonnummer des Verkäuferkontakts", "BT-43": "E-Mail-Adresse des Verkäuferkontakts", "BT-44": "Name des Käufers", "BT-48": "Umsatzsteuer-Identifikationsnummer des Käufers",
  "BT-49": "Elektronische Adresse des Käufers", "BG-8": "Postanschrift des Käufers", "BT-52": "Ort des Käufers", "BT-53": "Postleitzahl des Käufers", "BT-55": "Ländercode des Käufers",
  "BG-16": "Zahlungsanweisungen", "BT-81": "Code für das Zahlungsmittel", "BG-17": "Überweisung", "BT-84": "Kennung des Zahlungskontos (IBAN)",
  "BT-106": "Summe der Nettobeträge aller Rechnungspositionen", "BT-109": "Gesamtbetrag ohne Umsatzsteuer", "BT-110": "Gesamtbetrag der Umsatzsteuer",
  "BT-112": "Gesamtbetrag einschließlich Umsatzsteuer", "BT-115": "Fälliger Zahlungsbetrag", "BG-23": "Umsatzsteueraufschlüsselung",
  "BT-116": "Steuerpflichtiger Betrag der Kategorie", "BT-117": "Steuerbetrag der Kategorie", "BT-118": "Code der Umsatzsteuerkategorie", "BT-119": "Steuersatz der Kategorie",
  "BT-120": "Befreiungsgrund (Text)", "BT-121": "Befreiungsgrund (Code)", "BG-25": "Rechnungsposition", "BT-126": "Kennung der Rechnungsposition", "BT-129": "Berechnete Menge",
  "BT-130": "Code der Maßeinheit der Menge", "BT-131": "Nettobetrag der Rechnungsposition", "BT-146": "Nettopreis des Artikels", "BT-151": "Umsatzsteuerkategorie des Artikels",
  "BT-152": "Umsatzsteuersatz des Artikels", "BT-153": "Artikelbezeichnung",
});
