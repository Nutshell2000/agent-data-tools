## Motivation

Agent Data Tools sells single calls to 175 data tools for AI agents, most at $0.003 per successful call:
web pages, PDFs and feeds as clean text; OFAC sanctions screening and a one-call counterparty check;
token prices, wallet and chain reads on Base, Ethereum, Arbitrum, Optimism and Polygon; domain, email and
company checks; Bitcoin, FX, weather, time and small AI text tools. No account; failed calls are never
charged. It is useful to MPP agents as one payee for many everyday lookups instead of one service per task.

- **Service name:** Agent Data Tools
- **Live service URL:** https://agent-data-tools.revmesh2074.workers.dev
- **Provider URL:** https://agent-data-tools.revmesh2074.workers.dev
- **OpenAPI or API reference URL:** https://agent-data-tools.revmesh2074.workers.dev/openapi.json

## Summary

- [x] The service is live and accepts MPP payments (every tool's 402 offers `WWW-Authenticate: Payment`
      tempo/charge in USDC.e and evm/charge in USDC on Base; listed on MPPScan, 183 of 183 routes).
- [x] This PR adds or updates its entry in `schemas/services.ts`.
- [x] Listed endpoints, prices, and payment methods match the live service.
- [x] Public documentation and icon URLs are stable and accessible (`/llms.txt`, `/openapi.json`, `/logo.png`).
- [ ] `pnpm generate:discovery` succeeds. Fails on the author's Windows checkout, also on unmodified main;
      not reproducible from our Linux sandbox because `pkg.pr.new` is unreachable there. CI on Linux should confirm.
- [ ] `pnpm check:types` passes (same note).
- [ ] `pnpm build` succeeds (same note).

## Key design considerations

- **Integration:** first-party.
- **Payment methods and intents:** `charge` with `tempo` (USDC.e, `TEMPO_PAYMENT`) and `evm` (USDC on Base).
  Each request pays for one successful call; the payment is broadcast or settled only after the tool returns
  a result, so failed calls are never charged.
- **Provider relationship:** we own and operate the service (SpellzCode).
- **Directory fit:** in production since September 2026 with a public reliability page (`/status`); no
  existing entry covers sanctions screening, counterparty checks and chain reads together with web and PDF
  reading behind one MPP payee.
