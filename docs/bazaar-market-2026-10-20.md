# Coinbase Bazaar market snapshot, 20 October 2026

Read from the public CDP discovery API (`/platform/v2/x402/discovery/resources`, all 26,139 items). The figures are the Bazaar's own 30-day `quality` fields. Self-payments are not filtered out, so counts of 1 or 2 are mostly seeds.

## What the market looks like

- **26,139 listed endpoints:** 73,247 summed unique payers and 856,969 paid calls in 30 days.
- **Payers per endpoint:**

  | Payers | Endpoints |
  |---|---|
  | 0 | 213 |
  | 1 | 10,385 |
  | 2 | 8,103 |
  | 3–9 | 7,037 |
  | 10–49 | 314 |
  | 50–199 | 69 |
  | 200+ | 18 |

- **The median listing gets 2 payers.** Being listed brings the pay-once bots, worth a few tenths of a cent per tool per month, and little more.
- **`curated` (75 listings) is not what drives volume.** Their median is 4 payers, and only 2 of the top 30 are curated.

## Our listings

Only 2 of our 176 tools are listed:

| Tool | Payers (30 days) | Last paid | Drops out around |
|---|---|---|---|
| `/btc-fees` | 2 | 14 Oct | 13 Nov |
| `/package` | 1 | 10 Oct | 9 Nov |

## Where repeat buyers are (calls per payer well above 1)

| Category | Leader (30 days) | Leader's price | Our tool and price |
|---|---|---|---|
| LLM chat | blockrun `/v1/chat/completions`: 82,976 calls, 273 payers. Across all 416 LLM endpoints: 94,336 calls | $0.002 | `/v1/chat/completions` → `/ai/chat`, $0.003 |
| Web page reading | oneshotagent `web-read`: 11,894 calls, 14 payers | $0.002 | `/extract`, $0.002 |
| Token and smart-money data | sniperx smart traders: 22,923 calls, 17 payers. `svm402 /price`: 2,434 calls | $0.01 | `/token`, `/price/token`, `/wallet/portfolio` |
| Token price | apitoll `/crypto/price`: 75 payers (most for a price endpoint) | $0.001 | `/price/token`, $0.003 |

Chain reads (onesource: 200–316 payers per endpoint at $0.001–0.005) draw many payers, but each pays about once.

## Implications

1. **Repeat revenue needs a listing in the three repeat categories.**
   - Seeding `/extract`, `/ai/chat`, `/price/token` and `/wallet/portfolio` once costs $0.011. That is the highest-value seed per cent.
   - Chain reads come next: they bring breadth, but buyers pay once.
2. **Price matters in LLM chat,** where blockrun's $0.002 holds the volume. `/ai/chat` at $0.003 runs on the Workers AI free allowance (503 when it runs out). Repeat volume would need the paid Workers AI plan, at about $0.011 per 1,000 neurons.
3. **Without seeding,** expect about the median: 1–2 payers per tool, and only on tools that some bot finds by other means.
