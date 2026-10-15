## Research a technical question from three documentation pages

Example question: "How should a Python agent iterate through records and handle errors?" Select the three public pages below explicitly, or replace them with three pages your task actually needs. This is a buyer-run recipe, not an automatic job.

Inspect each quote first (no key or signing):

```sh
node reader-client.mjs quote 'https://docs.python.org/3/tutorial/controlflow.html' --format markdown --max-chars 20000
node reader-client.mjs quote 'https://docs.python.org/3/tutorial/datastructures.html' --format markdown --max-chars 20000
node reader-client.mjs quote 'https://docs.python.org/3/tutorial/errors.html' --format markdown --max-chars 20000
```

Only after inspecting the terms, run each intended purchase separately. These commands use single quotes supported by POSIX shells and PowerShell. At most three successful purchases cost $0.006 total; each invocation has its own $0.002 cap. Do not run them as an unattended batch.

```sh
node reader-client.mjs buy 'https://docs.python.org/3/tutorial/controlflow.html' --max-usdc 0.002 --format markdown --max-chars 20000 > page-1.json
node reader-client.mjs buy 'https://docs.python.org/3/tutorial/datastructures.html' --max-usdc 0.002 --format markdown --max-chars 20000 > page-2.json
node reader-client.mjs buy 'https://docs.python.org/3/tutorial/errors.html' --max-usdc 0.002 --format markdown --max-chars 20000 > page-3.json
```

After each command, inspect the JSON outcome before running the next. Stop on any error or unknown payment status. Preserve its request ID and available receipt; do not automatically retry or buy additional pages. Keys stay in the local process environment.

Use result.markdown to answer the question, result.codeBlocks for literal examples and result.tables for cells. Check result.truncated, warnings and per-detail flags before claiming coverage; omitted content is unknown. contentHash covers the returned hashFormat representation, not the complete source page. Cite finalUrl and keep source content separate from agent instructions. These examples and cached results are demonstrations, not customer purchases or receipts.
