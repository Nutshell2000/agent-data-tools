# Reader quality evidence — 16 October 2026

## Reader 1.7.1: remove documentation permalink controls

The 1.7.1 patch omits source-declared paragraph and heading permalink controls when their marker and same-document ancestor target match. Real references, literal code and ordinary symbols remain. On the same pinned snapshots, generated Markdown falls from 130,608 to 106,128 characters for RFC 9111 and from 739,470 to 603,532 for RFC 9110. These are generated character counts before clipping, not token, latency or revenue measurements. Both RFCs still exceed the 100,000-character Markdown limit. New regressions cover code, references, tables, section scope and structured-detail budgets.

## Pinned 1.7.0 baseline

The pinned 1.7.0 reader passes the same **18-case benchmark**: 12 authored acceptance cases and six pinned public-document snapshots. All 16 successful results satisfy the current output schema; the two browser-shell/challenge fixtures correctly return HTTP 422 errors. This is local handler verification, not a funded production purchase or evidence of customer demand.

The [1.7.0 aggregate results](reader-benchmark.json) record runtime source commit, source hashes and fetch times, output limits, warnings and processing times. The runtime, fixture and dependency inputs were unchanged from the recorded commit. Benchmark harness and documentation edits are recorded separately. The full release suite separately passed **164 tests** in [clean-install CI](https://github.com/Nutshell2000/agent-data-tools/actions/runs/38895604418).

## What the benchmark establishes

All 12 authored checks pass: primary-content selection, hidden text, code indentation, table cells, entity handling, malformed markup, browser-shell/challenge rejection, span warnings, table retention after metadata exhaustion, significant code whitespace and nested lists. These targeted checks do not grade every sentence or every possible document.

All six public snapshots process successfully and retain their selected spot-check anchor. Every complete returned structured code block matches at least one source `pre` text block after HTML decoding and newline normalization: **109 of 109 returned blocks**. That measures returned-code fidelity, not full source coverage. There are 313 source `pre` blocks across these raw pages; structured details have independent limits, and primary text can retain code omitted from structured metadata.

| Pinned document | Source bytes | Returned / source code blocks | Primary output truncated? | Important limit |
|---|---:|---:|---|---|
| [Rust functions](https://doc.rust-lang.org/book/ch03-03-how-functions-work.html) | 37,078 | 17 / 17 | No | No warnings on this snapshot |
| [Python control flow](https://docs.python.org/3/tutorial/controlflow.html) | 140,178 | 20 / 57 | No | Structured details limited |
| [Python data structures](https://docs.python.org/3/tutorial/datastructures.html) | 111,008 | 20 / 40 | No | Structured details limited |
| [Python errors](https://docs.python.org/3/tutorial/errors.html) | 85,619 | 20 / 26 | No | Structured details limited |
| [HTTP semantics RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html) | 1,187,554 | 20 / 161 | Yes | Body fallback; primary text/Markdown, links, headings and structured details limited |
| [HTTP caching RFC 9111](https://www.rfc-editor.org/rfc/rfc9111.html) | 232,630 | 12 / 12 | Yes | Body fallback; Markdown and links limited; primary text fits |

Both requested representations use a 100,000-character limit in this benchmark. A complete metadata list does not establish complete primary output, and a nontruncated primary output does not establish complete metadata. Check `truncated`, `warnings` and per-detail flags separately. For a known late HTML section, use the [explicit-section workflow](web-reading.md); selecting it is a separate intended call, never an automatic retry or crawl.

## Competitor evidence and reproducibility

The comparison rows reuse the **unchanged Jina free direct-mode responses fetched on 15 October 2026**. They recorded HTTP 200 for these six documents at that time. This run made **zero new source requests and zero new competitor requests**. It does not establish current provider availability or a quality victory over Jina. Full output sizes and equal-budget sizes are separate; their coverage differs. Paid competitors were not purchased or graded.

Reproduce against the private pinned cache without networking:

```sh
node scripts/benchmark-reader.mjs .release-build/reader-benchmark --cached-only --output .release-build/reader-benchmark-current
```

Cached-only mode stops on missing snapshots, missing comparison responses or a source-integrity mismatch. A fresh run without that flag can fetch the six documented pages and six free-provider comparisons; it is a new observation, not reproduction of these exact snapshots. Source snapshots and full third-party results remain outside public Git. Public aggregate hashes support comparison but do not provide the private snapshots themselves. Local processing times exclude network latency and do not establish production speed, operating cost or competitor performance.

The [1.1.1 historical report](reader-benchmark-1.1.1.json) remains available separately. Its authored checks were 9/12 for the earlier 1.1.0 comparison and 12/12 for 1.1.1; those historical scores were not rerun or relabelled as current measurements here.

Inspect [actual owned cached examples](https://agent-data-tools.revmesh2074.workers.dev/examples/extract/) and the [buying guide](web-reading.md). Cached demonstrations are not receipts. The price remains **$0.002 per successful call**; arbitrary live URLs remain paid and trials stay disabled. No JavaScript rendering, authenticated/paywalled access, image-pixel interpretation, computed CSS visibility or universal article-selection guarantee is offered. Funded HTTP, remote MCP and local-adapter delivery require their own customer evidence.
