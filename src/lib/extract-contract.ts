const nullableText = { type: ["string", "null"] };
export const EXTRACT_OUTPUT_SCHEMA = {
  type: "object",
  required: [
    "url",
    "finalUrl",
    "status",
    "contentType",
    "sourceFormat",
    "linkBaseUrl",
    "sourceMetadata",
    "title",
    "description",
    "lang",
    "canonical",
    "headings",
    "section",
    "links",
    "codeBlocks",
    "tables",
    "contentSelection",
    "warnings",
    "format",
    "textLength",
    "truncated",
    "contentHash",
    "hashFormat",
    "fetchedAt",
  ],
  properties: {
    url: { type: "string" },
    finalUrl: { type: "string" },
    status: { type: "integer" },
    contentType: { type: "string" },
    sourceMetadata: {
      type:"object",required:["verification","authors","dates","truncated"],
      description:"Page-level source declarations, not verified authorship or freshness. Head author/Open Graph date tags and bounded direct Schema.org JSON-LD Article/WebPage-like nodes only; exact-URL matches preferred, otherwise only one identity-free candidate. Author @id references resolve only to unambiguous local Person/Organization names, with both paths recorded. No external context/reference fetching or general JSON-LD expansion. Separate 2000-character value+provenance budget; 5 authors/10 dates. Original date strings are not normalized. Empty for Markdown/plain sources; unrelated entities and ambiguous nodes are omitted with warnings.",
      properties:{verification:{const:"not_verified"},truncated:{type:"boolean"},authors:{type:"array",maxItems:5,items:{type:"object",required:["value","source"],properties:{value:{type:"string",maxLength:256},source:{type:"string",maxLength:256}}}},dates:{type:"array",maxItems:10,items:{type:"object",required:["value","source","kind"],properties:{value:{type:"string",maxLength:128},source:{type:"string",maxLength:256},kind:{enum:["published","modified"]}}}}}
    },
    linkBaseUrl: { type: "string", description: "Effective source-derived HTTP(S) base for links: the first supported HTML base href outside inert/foreign subtrees, otherwise finalUrl. Credentials and non-HTTP(S) base values are ignored with a warning. HTML links/canonical use this base; raw Markdown keeps relative syntax and can be resolved using this field. No linked resource is fetched. This static interpretation does not evaluate scripts or Content Security Policy." },
    sourceFormat: { enum: ["html", "markdown", "plain"], description: "Source interpretation. Markdown is identified by text/markdown, or a .md/.markdown final path served as text/plain (warned). Markdown syntax is retained verbatim within the cap, not converted to HTML or parsed for structured details; text also retains that syntax. HTML section IDs are unsupported for Markdown/plain text." },
    title: nullableText,
    description: nullableText,
    lang: nullableText,
    canonical: nullableText,
    format: { enum: ["text", "markdown", "both"] },
    text: { type: "string", maxLength: 100000 },
    markdown: { type: "string", maxLength: 100000 },
    textLength: {
      type: "integer",
      minimum: 0,
      description:
        "Full extracted text length before the character cap, within the input limit.",
    },
    truncated: {
      type: "boolean",
      description:
        "Input or requested primary representation is incomplete. Structured detail limits are reported separately in warnings.",
    },
    contentSelection: { enum: ["main", "article", "body", "plain"] },
    contentHash: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    hashFormat: { enum: ["text", "markdown"] },
    fetchedAt: { type: "string" },
    warnings: { type: "array", items: { type: "string" } },
    headings: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        required: ["level", "text", "id"],
        properties: {
          level: { type: "integer", minimum: 1, maximum: 6 },
          text: { type: "string" },
          id: { type: ["string", "null"], maxLength: 500, description: "Source HTML heading ID or direct child anchor ID, when present and supported; not a generated slug." },
        },
      },
    },
    section: {
      description: "Null for full primary-content reading. Otherwise the explicitly requested scope; title/description/canonical remain page-level metadata. Heading scope ends before the next same/higher-level heading, including nested subsections; container scope is its subtree.",
      anyOf: [{type:"null"},{type:"object",required:["id","title","kind","headingLevel"],properties:{id:{type:"string",maxLength:500},title:nullableText,kind:{enum:["heading","container"]},headingLevel:{type:["integer","null"],minimum:1,maximum:6}}}]
    },
    links: {
      type: "array",
      maxItems: 200,
      items: {
        type: "object",
        required: ["href", "text"],
        properties: { href: { type: "string" }, text: { type: "string" } },
      },
    },
    codeBlocks: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        required: ["language", "text", "truncated"],
        properties: {
          language: nullableText,
          text: { type: "string", maxLength: 20000 },
          truncated: { type: "boolean" },
        },
      },
    },
    tables: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        required: ["caption", "rows", "headerRows", "hasSpans", "truncated"],
        properties: {
          caption: nullableText,
          rows: {
            type: "array",
            maxItems: 100,
            items: { type: "array", maxItems: 20, items: { type: "string" } },
          },
          headerRows: {
            type: "array",
            items: { type: "integer", minimum: 0, maximum: 99 },
          },
          hasSpans: { type: "boolean" },
          truncated: { type: "boolean" },
        },
      },
    },
  },
  oneOf: [
    {
      properties: { format: { const: "text" }, hashFormat: { const: "text" } },
      required: ["text"],
      not: { required: ["markdown"] },
    },
    {
      properties: {
        format: { const: "markdown" },
        hashFormat: { const: "markdown" },
      },
      required: ["markdown"],
      not: { required: ["text"] },
    },
    {
      properties: { format: { const: "both" }, hashFormat: { const: "text" } },
      required: ["text", "markdown"],
    },
  ],
};
