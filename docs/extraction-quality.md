# Extraction quality checks — 15 October 2026

The `/extract` upgrade keeps the $0.002 price and adds optional Markdown, bounded structured code/tables, semantic-region selection and content hashes. The default continues returning text. See [the buying guide](web-reading.md) for formats, limits and payment behavior.

Validation: 61 automated tests pass, including 11 extraction quality cases. These are authored acceptance cases, not a comparison with competing services or proof of customer demand. Tests run in the Workers runtime. Payment-flow fixtures use a fake facilitator with no signer, funds or on-chain transactions.

Coverage includes short articles, hidden content, exactly-once entity decoding, safe scoped links, malformed closing tags, code indentation/language, table cells/captions/header rows, span warnings, ordered steps, deterministic hashes, input/format validation, empty pages, browser challenges, complexity rejection and output/detail budgets. Real HTTP and MCP payment wrappers return errors without settlement for an empty static page. MCP successful results provide structuredContent plus the compatible JSON text block. Every invocation is marked non-idempotent because it can incur another payment.

Selected current primary documentation was fetched and processed locally without a production purchase:

| Page | Input bytes | Selected region | Code blocks returned | Tables returned | Limits reported |
|---|---:|---|---:|---:|---|
| [Python control flow](https://docs.python.org/3/tutorial/controlflow.html) | 140,178 | main | 20 | 0 | Structured detail limit |
| [Rust functions](https://doc.rust-lang.org/book/ch03-03-how-functions-work.html) | 37,078 | main | 17 | 0 | None |
| [HTTP semantics RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html) | 1,187,554 | body fallback | 20 | 13 | Text/Markdown and structured detail limits |

This is a three-page compatibility check. It does not establish universal extraction quality, production latency, operating cost, or funded production delivery. Code indentation was inspected in the Rust result. Long documents require callers to check truncation and warnings. CSS-computed visibility, browser rendering, authenticated/paywalled access, full table-span expansion and perfect article selection are outside this tool's scope.

Bitcoin fees also validate upstream JSON/required values and include the source, 141-vB transaction-size assumption and estimation limits. Invalid source data returns an execution error rather than a successful paid result. Fee estimates do not guarantee confirmation time.
