# Reader 1.1.1 quality and buying checks — 15 October 2026

The current release passes 80 automated tests. It fixes metadata-dependent loss of table text, code whitespace normalization, nested list structure and clipped code fences. Output variants are checked against the published OpenAPI schema. CLI tests cover pinned terms, explicit caps, one authorization, redirects, uncertain outcomes and standalone execution. No production payment was made.

The [18-case benchmark](reader-benchmark.json) uses 12 authored cases and six pinned public documentation snapshots. The authored checks improve from 9/12 on 1.1.0 to 12/12 on 1.1.1. All six public documents process successfully; all 109 complete returned structured code blocks match source whitespace. Declared metadata caps omit additional blocks, and long outputs remain truncated. Public-document anchors are spot checks, not exhaustive factual verification.

Jina free direct mode also returns HTTP 200 for all six pages. Its full outputs and our bounded outputs have different coverage. Local processing times exclude network latency and do not establish production speed or operating cost. Paid competitors were not purchased or graded. There is no universal-superiority claim. Reproduce with node scripts/benchmark-reader.mjs; source snapshots and third-party results stay in the ignored private build directory.

Inspect [real owned cached samples](https://agent-data-tools.revmesh2074.workers.dev/examples/extract/) and the [bundled CLI buying guide](web-reading.md). Cached results have generation times, source/result hashes and clear truncation flags. They are build-time demonstrations, not paid receipts. The entry price remains $0.002; arbitrary live URLs remain paid and trials stay disabled.

## Earlier 1.1.0 compatibility evidence

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
