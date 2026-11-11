// @ts-nocheck
// GENERATED from C:\SpellzCode\02-Affarsomraden\G-Sann\sann-engine (scripts/copy-to-api.mjs). Edit there, not here.
// Sann lexicon v1: phrase patterns per language and rule.
// Patterns are regex sources (compiled with flags "giu" and Unicode word boundaries).
// An entry is a string, or { re, sev, tags } where sev overrides the rule's severity and tags steer the context checks:
//   social = also a social claim (an ecolabel alone does not justify it, recital 10)
//   energy = 'energy efficient' family (allowed with energy class A, recital 10)
//   both   = word means both sustainable and durable
const R = String.raw;

export const LEX = {
  en: {
    GENERIC: [
      R`eco[\s-]?friendl(?:y|ier|iest)`,
      R`environment(?:ally)?[\s-]+friendl(?:y|ier|iest)`,
      R`environmentally\s+(?:conscious|responsible|sound|safe|correct|kind|better|aware)`,
      R`(?:earth|planet|nature|climate|ocean|carbon)[\s-]+friendl(?:y|ier|iest)`,
      R`nature'?s\s+friend`,
      R`(?:kind|kinder|gentle|gentler|good|better|best|friendly)\s+(?:to|for|on)\s+(?:the\s+|our\s+)?(?:planet|earth|environment|nature|climate)`,
      R`eco[\s-]?(?:conscious|responsible|choice|option|alternative|products?|range|line|collection|design(?:ed)?|smart|warrior|living|lifestyle|brand|bags?|packaging)`,
      R`ecological(?:ly)?`,
      R`go(?:ing|es)?\s+green`,
      R`green(?:er)?\s+(?:choices?|alternatives?|options?|products?|living|lifestyle|packaging|shipping|delivery|future|planet|solutions?|brand|company|credentials|way|energy|electricity|power|materials?|technology|tech|world|tomorrow)`,
      R`greenest\s+(?:choice|option|way|brand|products?)`,
      { re: R`sustainab(?:le|ly|ility)`, tags: ["social"] },
      R`climate[\s-]+(?:smart|conscious|kind|safe)`,
      R`low[\s-]+(?:impact|carbon)`,
      R`minimal\s+(?:environmental\s+)?impact`,
      R`zero[\s-]+waste`,
      R`plastic[\s-]+neutral`,
      { re: R`energy[\s-]+efficient`, tags: ["energy"] },
      R`biodegradable`,
      R`bio[\s-]?based`,
      { re: R`conscious(?:ly)?[\s-]+(?:made|choice|collection|fashion|brand|design|consumer|shopping|living)`, tags: ["social"] },
      { re: R`responsibl[ey][\s-]+(?:made|sourced|produced|manufactured|fashion|production|materials?|choice|brand)`, tags: ["social"] },
      R`(?:planet|nature|earth)[\s-]+positive`,
    ],
    OFFSET: [
      R`(?:carbon|climate|co2|co₂|ghg|greenhouse\s+gas|emissions?)[\s-]*neutral(?:ity)?`,
      R`net[\s-]*zero`,
      R`(?:climate|carbon|co2|co₂)[\s-]+(?:positive|negative)`,
      R`carbon[\s-]+(?:offset(?:ting)?|compensated|balanced|free)`,
      R`climate[\s-]+compensated`,
      R`offset(?:s|ting)?\s+(?:(?:all|our|the|its|your)\s+)*(?:carbon|co2|co₂|emissions|footprint)`,
      { re: R`(?:reduced|lower|limited|low)\s+(?:climate\s+impact|carbon\s+footprint|co2\s+footprint|co₂\s+footprint)`, sev: "medium" },
      { re: R`zero[\s-]+(?:emissions?|carbon)`, sev: "medium" },
    ],
    LABEL: [
      R`(?:our|own|in[\s-]house)\s+(?:eco|green|sustainability|sustainable|environmental|climate|planet)[\s-]?(?:labels?|badges?|seals?|marks?|certifications?|tags?|stamps?|scores?)`,
      R`(?:eco|green|sustainability)[\s-]+(?:labels?|seals?|badges?)`,
      R`certified\s+(?:sustainable|green|eco[\s-]?friendly|environmentally\s+friendly|climate[\s-]?friendly)`,
    ],
    ORGANIC: [
      R`(?:certified\s+)?organic\s+(?:cotton|wool|linen|hemp|bamboo|silk|ingredients?|materials?|fabrics?|fibres?|fibers?|coffee|tea|cocoa|chocolate|food|produce|farming|skincare|oils?|herbs?|flour|sugar|honey|fruit|vegetables|beeswax|soap|cosmetics)`,
      R`100\s?%\s+organic`,
      R`certified\s+organic`,
    ],
    PART: [
      R`recycled`,
      R`recyclable`,
      R`compostable`,
      R`plastic[\s-]+free`,
      R`renewable\s+materials?`,
      R`upcycled`,
      R`made\s+(?:from|with|of)\s+(?:natural|renewable)\s+materials?`,
    ],
    COMPARISON: [
      R`(?:greener|cleaner|more\s+sustainable|more\s+eco[\s-]?friendly|more\s+environmentally\s+friendly|more\s+planet[\s-]friendly|better\s+for\s+the\s+(?:planet|environment|climate)|less\s+harmful(?:\s+to\s+the\s+(?:planet|environment))?|kinder\s+to\s+the\s+(?:planet|environment))\s+than`,
      R`\d+(?:[.,]\d+)?\s?(?:%|percent|per\s+cent)\s+(?:less|fewer|lower|reduced)\s+(?:co2|co₂|carbon|emissions|water|plastic|energy|waste)`,
      R`compared\s+(?:to|with)\s+(?:\p{L}+\s+){0,2}?(?:conventional|regular|traditional|ordinary|standard)`,
    ],
    LEGAL: [
      R`(?:cfc|freon|bpa|lead|mercury|phthalate|cadmium)[\s-]+free`,
      R`free\s+(?:from|of)\s+(?:microbeads|microplastics?|cfcs?|bpa|phthalates)`,
      R`(?:rohs|reach)[\s-]+(?:compliant|certified|approved)`,
    ],
    DURABILITY: [
      R`lasts?\s+(?:for\s+)?(?:a\s+)?(?:life[\s-]?time|forever)`,
      R`built\s+to\s+last\s+(?:forever|a\s+lifetime)`,
      R`indestructible`,
      R`never\s+wears?\s+out`,
      R`will\s+never\s+(?:break|wear\s+out)`,
      R`(?:easy|easily)\s+(?:to\s+)?repair(?:ed|able)?`,
      R`(?:fully\s+)?repairable`,
    ],
  },

  sv: {
    GENERIC: [
      R`miljövänlig\p{L}*`,
      R`ekovänlig\p{L}*`,
      R`(?:natur|klimat|jord|planet|hav|koldioxid)vänlig\p{L}*`,
      R`(?:miljö|klimat)(?:smart|klok|medveten|medvetna|anpassad|riktig|säker)\p{L}*`,
      R`miljömässigt\s+korrekt\p{L}*`,
      R`skonsam\p{L}*\s+mot\s+(?:miljön|naturen|planeten|klimatet|jorden)`,
      R`(?:bra|bättre|bäst|snäll\p{L}*|vänlig\p{L}*)\s+(?:för|mot)\s+(?:miljön|planeten|klimatet|naturen|jorden)`,
      { re: R`hållbar(?:t|a|are|aste)?`, tags: ["social", "both"] },
      { re: R`hållbarhet(?!stid)\p{L}*(?!\s*:?\s*\d)`, sev: "medium", tags: ["social", "both"] },
      R`(?:grön|grönt|gröna|grönare)\s+(?:val|alternativ|energi|el|livsstil|leverans|frakt|framtid|produkt|produkter|omställning|förpackning|förpackningar|teknik|lösning|lösningar|varumärke|profil|vardag|värld|sätt)`,
      R`(?:tänk|välj|lev|handla)\s+grönt`,
      { re: R`energieffektiv\p{L}*`, tags: ["energy"] },
      R`(?:biologiskt\s+)?nedbrytbar\p{L}*`,
      R`biobaserad\p{L}*`,
      { re: R`(?:medveten|medvetet|medvetna)\s+(?:val|mode|konsumtion|kollektion|design|livsstil|shopping)`, tags: ["social"] },
      { re: R`medvetet\s+(?:tillverkad|producerad|gjord)\p{L}*`, tags: ["social"] },
      { re: R`ansvarsfull\p{L}*\s+(?:tillverk\p{L}*|produ\p{L}*|mode|val|material|inköp)`, tags: ["social"] },
      R`noll\s*avfall`,
      R`(?:låg|minimal|liten)\s+miljöpåverkan`,
      R`plastneutral\p{L}*`,
    ],
    ORGANIC: [
      R`ekologisk\p{L}*`,
      R`eko[\s-]?(?:bomull|ull|linne|hampa|märkt|odlad\p{L}*|certifierad\p{L}*)`,
    ],
    OFFSET: [
      R`(?:klimat|koldioxid|co2|co₂|utsläpps)[\s-]?neutral\p{L}*`,
      R`(?:klimat|koldioxid|co2|co₂)[\s-]?positiv\p{L}*`,
      R`klimatkompenser\p{L}*`,
      R`netto[\s-]?noll\p{L}*`,
      R`kompenser\p{L}*\s+(?:(?:vi|för|alla|våra|era|hela)\s+)*(?:utsläpp\p{L}*|koldioxid\p{L}*|klimatavtryck\p{L}*|klimatpåverkan)`,
      { re: R`(?:minskad|lägre|begränsad|begränsat|låg|lågt)\s+(?:klimatpåverkan|koldioxidavtryck|klimatavtryck|co2-avtryck)`, sev: "medium" },
    ],
    LABEL: [
      R`(?:vår|vårt|egen|eget|egna)\s+(?:miljö|hållbarhets|klimat|eko)(?:märkning|märke|certifiering|stämpel|symbol|sigill)\p{L}*`,
      R`(?:miljö|hållbarhets|klimat)märk\p{L}*`,
      R`certifierad\p{L}*\s+(?:hållbar\p{L}*|miljövänlig\p{L}*|grön\p{L}*)`,
      R`(?:hållbarhets|miljö)certifierad\p{L}*`,
    ],
    PART: [
      R`återvunn\p{L}*`,
      R`återvinningsbar\p{L}*`,
      R`komposterbar\p{L}*`,
      R`plastfri\p{L}*`,
      R`förnybar\p{L}*`,
      R`fossilfri\p{L}*`,
      R`uppcykl\p{L}*`,
    ],
    COMPARISON: [
      R`(?:miljövänligare|grönare|klimatsmartare|hållbarare|mer\s+(?:hållbar\p{L}*|miljövänlig\p{L}*|klimatvänlig\p{L}*)|bättre\s+för\s+(?:miljön|planeten|klimatet|naturen))\s+än`,
      R`\d+(?:[.,]\d+)?\s?(?:%|procent)\s+(?:mindre|lägre|färre)\s+(?:utsläpp|koldioxid|co2|co₂|vatten|plast|energi|avfall|klimatpåverkan)`,
      R`jämfört\s+med\s+(?:vanlig\p{L}*|konventionell\p{L}*|traditionell\p{L}*)`,
    ],
    LEGAL: [
      R`(?:freon|cfc|bpa|kvicksilver|ftalat|kadmium|bly)[\s-]?fri\p{L}*`,
      R`fri\p{L}*\s+från\s+(?:mikroplast\p{L}*|freon|cfc|bpa|ftalater)`,
      R`(?:rohs|reach)[\s-]?(?:godkänd|kompatibel|certifierad|märkt)\p{L}*`,
    ],
    DURABILITY: [
      R`håller\s+(?:hela\s+)?livet\s+ut`,
      R`håller\s+(?:för\s+)?(?:evigt|i\s+evighet)`,
      R`oförstörbar\p{L}*`,
      R`slits\s+aldrig`,
      R`går\s+(?:lätt\s+|enkelt\s+)?att\s+(?:reparera|laga)`,
      R`reparerbar\p{L}*`,
      R`(?:lätt|enkel|enkelt)\s+att\s+(?:reparera|laga)`,
    ],
  },

  de: {
    GENERIC: [
      R`umwelt(?:freundlich|schonend|bewusst|gerecht|verträglich)\p{L}*`,
      R`(?:klima|natur|öko)[\s-]?(?:freundlich|schonend|verträglich|bewusst)\p{L}*`,
      R`ressourcenschonend\p{L}*`,
      { re: R`nachhaltig\p{L}*`, tags: ["social"] },
      R`grüne[nrs]?\s+(?:wahl|alternative|alternativen|lösung|lösungen|produkte|zukunft|energie|mode|verpackung|strom|technik)`,
      R`ökostrom`,
      R`(?:gut|besser|schonend)\s+für\s+(?:die\s+umwelt|das\s+klima|den\s+planeten|die\s+natur|unseren\s+planeten)`,
      { re: R`energieeffizient\p{L}*`, tags: ["energy"] },
      R`biologisch\s+abbaubar\p{L}*`,
      R`biobasiert\p{L}*`,
      R`(?:co2|co₂)[\s-]?arm\p{L}*`,
      { re: R`verantwortungsvoll\p{L}*\s+(?:hergestellt|produziert|gefertigt|bezogen)\p{L}*`, tags: ["social"] },
    ],
    ORGANIC: [
      R`ökologisch\p{L}*`,
      R`bio[\s-]?(?:baumwolle|qualität|anbau|zertifiziert\p{L}*)`,
      R`öko[\s-]?(?:baumwolle|qualität|textil\p{L}*|mode)`,
      R`kontrolliert\p{L}*\s+biologisch\p{L}*\s+anbau\p{L}*`,
    ],
    OFFSET: [
      R`(?:klima|co2|co₂|kohlenstoff|treibhausgas|emissions|umwelt)[\s-]?neutral\p{L}*`,
      R`(?:klima|co2|co₂)[\s-]?positiv\p{L}*`,
      R`klimakompensiert\p{L}*`,
      R`netto[\s-]?null`,
      R`kompensier\p{L}*\s+(?:(?:wir|alle|unsere|die)\s+)*(?:co2|co₂|emissionen|treibhausgas\p{L}*)`,
      { re: R`(?:reduziert\p{L}*|geringer\p{L}*|niedrig\p{L}*)\s+(?:klimawirkung|co2-fußabdruck|co₂-fußabdruck|klimabilanz|fußabdruck)`, sev: "medium" },
    ],
    LABEL: [
      R`(?:unser|unsere|eigene[snm]?)\s+(?:öko|umwelt|nachhaltigkeits|klima)[\s-]?(?:siegel|label|zeichen|zertifikat)\p{L}*`,
      R`(?:öko|umwelt|nachhaltigkeits|klima)siegel\p{L}*`,
      R`nachhaltig\s+zertifiziert\p{L}*`,
    ],
    PART: [
      R`recycel\p{L}*`,
      R`recycling(?:material|kunststoff|polyester|papier|karton|plastik)\p{L}*`,
      R`aus\s+recycling\p{L}*`,
      R`recyclingfähig\p{L}*`,
      R`kompostierbar\p{L}*`,
      R`(?:plastik|plast|kunststoff)[\s-]?frei\p{L}*`,
    ],
    COMPARISON: [
      R`(?:umweltfreundlicher|nachhaltiger|klimafreundlicher|grüner|ökologischer|besser\s+für\s+(?:die\s+umwelt|das\s+klima|den\s+planeten))\s+als`,
      R`\d+(?:[.,]\d+)?\s?(?:%|prozent)\s+weniger\s+(?:co2|co₂|emissionen|wasser|plastik|kunststoff|energie|abfall)`,
      R`im\s+vergleich\s+zu\s+(?:herkömmlich\p{L}*|konventionell\p{L}*)`,
    ],
    LEGAL: [
      R`(?:fckw|bpa|quecksilber|phthalat|cadmium|blei)[\s-]?frei\p{L}*`,
      R`frei\s+von\s+(?:mikroplastik|fckw|bpa|phthalaten)`,
      R`(?:rohs|reach)[\s-]?(?:konform|zertifiziert|compliant)\p{L}*`,
    ],
    DURABILITY: [
      R`hält\s+(?:ein\s+)?(?:(?:ganzes\s+)?leben\s+lang|ewig)`,
      R`unverwüstlich\p{L}*`,
      R`unzerstörbar\p{L}*`,
      R`reparierbar\p{L}*`,
      R`(?:leicht|einfach)\s+zu\s+reparieren`,
    ],
  },

  fr: {
    GENERIC: [
      R`écologique(?:s|ment)?`,
      R`éco[\s-]?responsab\p{L}*`,
      R`éco[\s-]?conçu\p{L}*`,
      R`respectueu(?:x|se|ses)\s+(?:de\s+l'environnement|de\s+la\s+planète|de\s+la\s+nature|du\s+climat)`,
      R`(?:bon|bonne|bons|bonnes|meilleur\p{L}*)\s+pour\s+(?:la\s+planète|l'environnement|le\s+climat|la\s+nature)`,
      R`(?:ami|amie)\s+de\s+(?:la\s+nature|l'environnement|la\s+planète)`,
      { re: R`durable(?:s|ment)?`, sev: "medium", tags: ["social", "both"] },
      R`(?:choix|alternative|énergie|solution|produit|geste|avenir|mode|emballage|électricité)s?\s+verte?s?`,
      R`écolos?`,
      R`zéro\s+déchet`,
      R`bas[\s-]+carbone`,
      R`faible\s+impact(?:\s+environnemental)?`,
      { re: R`(?:économe|économes)\s+en\s+énergie|basse\s+consommation`, tags: ["energy"] },
      R`biodégradable(?:s)?`,
      R`biosourcé(?:e|s|es)?`,
      { re: R`(?:mode|consommation|production|achat|choix|marque|matières?)\s+responsables?`, tags: ["social"] },
      { re: R`(?:fabriqué|produit|conçu)(?:e|s|es)?\s+de\s+manière\s+responsable`, tags: ["social"] },
    ],
    ORGANIC: [
      R`biologique(?:s)?`,
      R`(?:coton|laine|lin|chanvre|cuir|ingrédients?|agriculture)\s+bio(?:logique)?s?`,
      R`issu(?:e|s|es)?\s+de\s+l'agriculture\s+biologique`,
    ],
    OFFSET: [
      R`neutre(?:s)?\s+en\s+(?:carbone|co2|co₂|émissions)`,
      R`(?:carbone|climatiquement|climat)\s+neutre(?:s)?`,
      R`neutralité\s+(?:carbone|climatique)`,
      R`compens(?:é|ée|és|ées|ons|ation)\p{L}*\s+(?:(?:de|des|nos|les|en|notre|leur)\s+)*(?:carbone|émissions|co2|co₂|empreinte)`,
      R`zéro\s+émissions?\s+nettes?`,
      R`net\s+zéro|zéro\s+net`,
      R`(?:climat|carbone)\s+positifs?`,
      { re: R`(?:impact|empreinte)\s+(?:carbone\s+)?(?:réduite?|limitée?|faible)`, sev: "medium" },
    ],
    LABEL: [
      R`(?:notre|nos|propre)\s+(?:label|logo|badge|sceau)s?\s+(?:écologique|vert|verte|durable|environnemental|éco\p{L}*)s?`,
      R`label\s+(?:écologique|vert|durable|environnemental|éco\p{L}*)`,
      R`certifié(?:e|s|es)?\s+(?:durable|écologique|vert|verte|éco\p{L}*)`,
    ],
    PART: [
      R`recyclé(?:e|s|es)?`,
      R`recyclable(?:s)?`,
      R`compostable(?:s)?`,
      R`sans\s+plastique`,
      R`zéro\s+plastique`,
      R`(?:upcyclé|surcyclé)\p{L}*`,
    ],
    COMPARISON: [
      R`plus\s+(?:écologique|durable|verte?|propre|respectueu\p{L}*)s?\s+(?:\p{L}+\s+){0,3}?que`,
      R`\d+(?:[.,]\d+)?\s?(?:%|pour\s?cent)\s+(?:de\s+)?moins\s+(?:de\s+|d')?(?:co2|co₂|carbone|émissions|eau|plastique|énergie|déchets)`,
      R`par\s+rapport\s+(?:à|aux|au)\s+(?:\p{L}+\s+){0,2}?(?:classique|conventionnel|traditionnel|standard)\p{L}*`,
    ],
    LEGAL: [
      R`sans\s+(?:cfc|bpa|bisphénol\s+a|plomb|mercure|phtalates?|microplastiques?|cadmium)`,
      R`conformes?\s+(?:à\s+la\s+(?:directive\s+)?)?(?:rohs|reach)`,
    ],
    DURABILITY: [
      R`(?:dure|durera)\s+(?:toute\s+)?(?:une|la)\s+vie`,
      R`inusables?`,
      R`indestructibles?`,
      R`réparables?`,
      R`faciles?\s+à\s+réparer`,
    ],
  },

  es: {
    GENERIC: [
      R`respetuos[oa]s?\s+con\s+el\s+(?:medio\s*ambiente|planeta|entorno|clima)`,
      R`amigables?\s+con\s+el\s+(?:medio\s*ambiente|planeta)`,
      R`eco[\s-]?amigables?`,
      { re: R`sosten(?:ible|ibles|ibilidad)`, tags: ["social"] },
      { re: R`sustentables?`, tags: ["social"] },
      R`(?:opción|opciones|alternativa|alternativas|energía|solución|soluciones|producto|productos|futuro|moda|envase|envases|elección)\s+verdes?`,
      R`(?:bueno|buena|buenos|buenas|mejor|mejores)\s+para\s+el\s+(?:planeta|medio\s*ambiente|clima)`,
      R`residuos?\s+cero|cero\s+residuos`,
      R`bajo\s+en\s+carbono|bajas?\s+emisiones`,
      R`bajo\s+impacto(?:\s+ambiental)?`,
      { re: R`eficientes?\s+energéticamente|bajo\s+consumo`, tags: ["energy"] },
      R`biodegradables?`,
      R`de\s+origen\s+biológico`,
      { re: R`(?:fabricad|producid|elaborad)[oa]s?\s+de\s+(?:forma|manera)\s+(?:responsable|sostenible|consciente)`, tags: ["social"] },
      { re: R`(?:moda|consumo|compra)\s+(?:responsable|consciente)`, tags: ["social"] },
    ],
    ORGANIC: [
      R`ecológic(?:o|a|os|as)`,
      R`orgánic(?:o|a|os|as)`,
      R`(?:algodón|lana|lino|cáñamo)\s+bio`,
    ],
    OFFSET: [
      R`neutr(?:o|a|os|as|al|ales)\s+en\s+(?:carbono|co2|co₂|emisiones|clima)`,
      R`(?:carbono|climáticamente)\s+neutr(?:o|a|os|as|al|ales)`,
      R`neutralidad\s+(?:de\s+carbono|climática|en\s+carbono)`,
      R`compens(?:ad[oa]s?|amos|ación)\s+(?:(?:de|las|nuestras|todas|el|la|su)\s+)*(?:emisiones|co2|co₂|carbono|huella)`,
      R`cero\s+emisiones\s+netas|emisiones\s+netas\s+cero`,
      R`huella\s+(?:de\s+carbono\s+)?(?:cero|neutra|nula)`,
      R`(?:carbono|clima)\s+positiv[oa]s?`,
      { re: R`(?:reducid[oa]|menor|baj[oa])\s+(?:huella\s+de\s+carbono|impacto\s+climático)`, sev: "medium" },
    ],
    LABEL: [
      R`(?:nuestro|nuestra|propio|propia)\s+(?:sello|etiqueta|distintivo|certificado)\s+(?:ecológic[oa]|verde|sostenible|ambiental)`,
      R`sello\s+(?:ecológico|verde|sostenible|ambiental)`,
      R`certificad[oa]s?\s+(?:sostenible|ecológic[oa]|verde)s?`,
    ],
    PART: [
      R`reciclad[oa]s?`,
      R`reciclables?`,
      R`compostables?`,
      R`(?:sin|libre\s+de)\s+plásticos?`,
      R`cero\s+plásticos?`,
    ],
    COMPARISON: [
      R`más\s+(?:sostenible|ecológic[oa]|verde|limpi[oa]|respetuos[oa])s?\s+(?:\p{L}+\s+){0,3}?que`,
      R`\d+(?:[.,]\d+)?\s?(?:%|por\s+ciento)\s+menos\s+(?:de\s+)?(?:co2|co₂|carbono|emisiones|agua|plástico|energía|residuos)`,
      R`en\s+comparación\s+con\s+(?:\p{L}+\s+){0,2}?(?:convencional|tradicional|estándar)\p{L}*`,
    ],
    LEGAL: [
      R`(?:sin|libre\s+de)\s+(?:cfc|bpa|bisfenol\s+a|plomo|mercurio|ftalatos|microplásticos|cadmio)`,
      R`(?:cumple|conforme)\s+(?:con\s+)?(?:la\s+)?(?:normativa\s+)?(?:rohs|reach)`,
    ],
    DURABILITY: [
      R`dura\s+toda\s+la\s+vida`,
      R`para\s+toda\s+la\s+vida`,
      R`indestructibles?`,
      R`irrompibles?`,
      R`reparables?`,
      R`fáciles?\s+de\s+reparar`,
    ],
  },
};

// Official type I ecolabels and the EU Ecolabel: "recognised excellent environmental performance" (Art. 2(s)).
export const TYPE1 = R`eu[\s-]?ecolabel|eu[\s-]?blomman|eu[\s-]?miljömärk\p{L}*|eu-umweltzeichen|eu[\s-]?écolabel|etiqueta\s+ecológica\s+(?:de\s+la\s+)?(?:ue|europea)|écolabel\s+(?:européen|de\s+l'ue)|svanen|svanenmärk\p{L}*|nordic\s+swan|nordic\s+ecolabel|nordiska\s+miljömärkningen|bra\s+miljöval|blau(?:e|er|en)?\s+engel|blue\s+angel|österreichisches\s+umweltzeichen|nf\s+environnement|aenor\s+medio\s+ambiente`;

// Organic certifications.
export const ORGANIC_SCHEMES = R`gots|global\s+organic\s+textile\s+standard|ocs|organic\s+content\s+standard|krav(?:-?märk\p{L}*)?|demeter|eu[\s-]?(?:organic|ekologisk\p{L}*|öko\p{L}*|bio)(?:[\s-]?(?:logo|logotyp|siegel|label))?|euro[\s-]?leaf|bio[\s-]?siegel|(?:label|logo)\s+ab|ab\s+agriculture\s+biologique|ecocert|cosmos\s+(?:organic|natural)|soil\s+association|naturland|bioland|ifoam`;

// Any recognised certification scheme or public label (Annex I point 2a allows these).
export const SCHEMES = TYPE1 + "|" + ORGANIC_SCHEMES + "|" + R`grs|global\s+recycled\s+standard|rcs|recycled\s+claim\s+standard|fsc|pefc|fairtrade|oeko[\s-]?tex|bluesign|cradle\s+to\s+cradle|c2c|rainforest\s+alliance|msc|asc|tco\s+certified|energy\s+star|epeat|möbelfakta|responsible\s+wool\s+standard|rws|responsible\s+down\s+standard|rds|better\s+cotton|leather\s+working\s+group|lwg|en\s?13432|ok\s+compost\p{L}*|din\s+certco`;

export const ENERGY_A = R`(?:energy\s+class|energiklass|energieeffizienzklasse|effizienzklasse|classe\s+(?:énergétique|énergie)|clase\s+energética)\s*:?\s*a(?![\p{L}+])`;

export const OFFSET_WORD = R`offset\p{L}*|kompens\p{L}*|compens\p{L}*|carbon\s+credits?|klimatkredit\p{L}*|koldioxidkredit\p{L}*|crédits?\s+carbone|créditos?\s+de\s+carbono|klimaprojekt\p{L}*|klimatprojekt\p{L}*|climate\s+projects?|tree[\s-]planting|plant(?:ing)?\s+trees?|planterar\s+träd|trädplanter\p{L}*|bäume\s+pflanzen|aufforstung\p{L}*|reforestation|reforestación|plantons\s+des\s+arbres|plantamos\s+árboles`;

// A clear environmental specification in the same sentence (recital 9: then the claim is not generic).
export const ENV_SPEC = R`\d+(?:[.,]\d+)?\s?(?:%|procent|percent|per\s+cent|prozent|pour\s?cent|por\s+ciento)\s+(?:\p{L}+\s+){0,3}?(?:recycl\p{L}*|återvunn\p{L}*|recycel\p{L}*|reciclad\p{L}*|renewabl\p{L}*|förnybar\p{L}*|erneuerbar\p{L}*|renouvelabl\p{L}*|renovabl\p{L}*|organic|ekologisk\p{L}*|less|lower|fewer|mindre|lägre|weniger|moins|menos|co2|co₂|emission\p{L}*|utsläpp\p{L}*|emisiones)`;

export const PERCENT = R`\d+(?:[.,]\d+)?\s?(?:%|procent|percent|per\s+cent|prozent|pour\s?cent|por\s+ciento)`;

// Words that make a sentence about environmental performance (for future-performance promises).
export const FUTURE_ENV = R`neutral\p{L}*|neutre\p{L}*|neutr[oa]\p{L}*|net[\s-]?zero|netto[\s-]?noll\p{L}*|netto[\s-]?null|nettonoll\p{L}*|net\s+zéro|emission\p{L}*|émission\p{L}*|utsläpp\p{L}*|emisiones|carbon\p{L}*|koldioxid\p{L}*|kohlenstoff\p{L}*|carbone|carbono|co2|co₂|klimat\p{L}*|klima\p{L}*|climat\p{L}*|clima\p{L}*|fossil\p{L}*|plastic[\s-]?free|plastfri\p{L}*|plastikfrei\p{L}*|recycl\p{L}*|återvunn\p{L}*|recycel\p{L}*|sustainab\p{L}*|hållbar\p{L}*|nachhaltig\p{L}*|sostenib\p{L}*|renewable\p{L}*|förnybar\p{L}*|erneuerbar\p{L}*|renouvelable\p{L}*|renovable\p{L}*|zero[\s-]waste`;

export const FUTURE_PHRASE = R`(?:by|until|before|in)\s+(20[2-9]\d)|(?:till|senast|före|innan|år)\s+(?:år\s+)?(20[2-9]\d)|bis\s+(?:zum\s+jahr\s+)?(20[2-9]\d)|d'ici\s+(?:à\s+)?(?:l'horizon\s+)?(20[2-9]\d)|(?:para|antes\s+de|en)\s+(?:el\s+)?(?:año\s+)?(20[2-9]\d)|we\s+(?:aim|plan|intend|pledge|commit|promise|will|are\s+committed|have\s+committed)\s+to|our\s+(?:goal|target|ambition|aim|mission|commitment)\s+is|on\s+(?:our|the)\s+way\s+to|committed\s+to\s+(?:becoming|reaching|achieving|being)|vårt\s+mål\s+är|vi\s+ska\s+(?:bli|vara|nå)|vi\s+siktar\s+på|vi\s+har\s+som\s+mål|på\s+väg\s+(?:mot|att\s+bli)|unser\s+ziel\s+ist|wir\s+wollen|wir\s+werden|auf\s+dem\s+weg\s+zu|notre\s+objectif\s+est|nous\s+visons|nous\s+nous\s+engageons|nuestro\s+objetivo\s+es|nos\s+comprometemos|en\s+camino\s+(?:hacia|a)`;

// Stopwords for language detection.
export const STOPWORDS = {
  en: ["the", "and", "with", "for", "of", "is", "our", "this", "to", "made", "from", "your", "are", "it", "you", "that", "in", "on"],
  sv: ["och", "med", "för", "av", "är", "vår", "våra", "vårt", "det", "ett", "som", "till", "från", "din", "ditt", "dina", "på", "inte", "har", "eller"],
  de: ["und", "mit", "für", "der", "die", "das", "ist", "unser", "unsere", "aus", "ein", "eine", "zu", "von", "nicht", "sie", "auf", "dem", "den"],
  fr: ["et", "avec", "pour", "le", "les", "est", "notre", "nos", "des", "une", "du", "dans", "sur", "vous", "votre", "au", "aux", "qui"],
  es: ["y", "con", "para", "el", "los", "las", "es", "nuestro", "nuestra", "del", "una", "por", "su", "sus", "que", "muy", "al"],
};
