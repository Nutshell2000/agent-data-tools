# Bazaar seeding

Owner decision, 19 October 2026: the Coinbase Bazaar is where the only paying agents found us (both buyer
bots of the week pay almost exclusively Bazaar-listed resources: 99% and 78% of their payees), and Coinbase
indexes a resource only after its first payment settles through the CDP facilitator. So each tool is paid
for once by the owner, from a buyer wallet he funds, into our own `PAY_TO`. Nothing leaves the business:
the USDC moves from one owner wallet to the other and the facilitator pays the gas.

**Active since 22 Oct 2026 (Peter):** the buyer wallet is funded from Peter's own Binance USDC and he runs the seeding himself with `C:\MoneyWallet\Seed Bazaar listings.cmd` (it waits for the deposit, shows the dry-run plan and pays only after he types YES). The Base buyer-bot analysis of 15-22 Oct (`business/agentic/reports/base-bots-2026-10-22.md`) showed why: 76-78% of real buyer payments go to Bazaar-listed sellers, explorer bots buy listed tools only, and sellers with 21+ listings are bought 2-3x more often.

These settlements are never revenue or demand. The buyer wallet is listed in `OWNED_WALLETS`
(`src/lib/settlement-ledger.ts`), so the ledger records them as `selfPayment: true` and `/revenue` excludes
them from `grossAtomic`; the weekly review and the daily report ignore self-payments.

## Demand order and what each budget buys (catalog of 20 Oct 2026)

Without `--set` or `--only`, the script seeds in demand order (Tanod Labs' Bazaar snapshot of 9 Oct: chain reads
are the most-paid category, with 400-700 one-call payers per endpoint like ours; bot A buys crypto-risk checks):

| Budget | Tools listed |
|---|---|
| 0.011 USD | 4 repeat-buyer tools: /extract, /ai/chat (also serves /v1/chat/completions), /price/token, /wallet/portfolio |
| 0.20 USD | + 63 chain reads: /base, /eth, /arb, /op, /polygon families, /base-*, /btc-*, /ens, /wallet* |
| 0.41 USD | + 8 crypto-risk checks: contract-risk, token-report, wallet-audit, liquidity-pool-audit, check/counterparty, token, trade-insight, mev-simulator |
| 0.67 USD | + prices, compliance, web reading and every other tool up to $0.005 (156 tools) |

Never seeded: `/package-audit` ($0.20) and the capacity-limited AI, media and rendering tools.

## Steps (Peter, once per batch)

1. `node scripts/seed-bazaar.mjs wallet` creates the buyer wallet (`.seed-bazaar-wallet.json`, git-ignored, never the
   payout wallet's key) and prints its address. Send that address about 1 USDC on Base from Coinbase Wallet.
2. The local session adds the address to `OWNED_WALLETS`, deploys through the guard, and confirms with
   `/revenue` that it is live.
3. In a terminal in `C:\MoneyWallet\x402-canonical` (the key is read from `.seed-bazaar-wallet.json`; `BUYER_KEY` in
   the environment overrides it):

   ```sh
   node scripts/seed-bazaar.mjs --budget <earned USD>
   ```

   plans the demand order up to that budget, checks each tool's live 402 terms (our address, Base USDC, the
   catalog price) and pays nothing. Then:

   ```sh
   node scripts/seed-bazaar.mjs --budget <earned USD> --pay --ledger-excluded
   ```

   pays each tool once, prints the transaction per tool and any Bazaar `EXTENSION-RESPONSES` outcome, and
   writes a private git-ignored log `.seed-bazaar-<time>.json`. Tools already listed are skipped, so the next
   budget continues down the demand order. Named sections instead: `--set web,everyday`; named tools: `--only /ens,/btc-address`.
   The run refuses to spend more than `--max-total` (default 1.00 USD).

4. After about ten minutes, `node scripts/bazaar-listings.mjs` (in `C:\MoneyWallet\x402-api\scripts`) lists
   what the Bazaar now shows for our address. Agentic.Market and the 402 Index "bazaar" entries follow from it.

## Rehearsal on staging (no real money)

The same script runs against the Base Sepolia staging Worker with the faucet test wallet (already in
`OWNED_WALLETS`), which proves the paying path before Peter uses it: set `SEED_ORIGIN` to the staging URL,
`SEED_NETWORK=eip155:84532`, `SEED_USDC=0x036CbD53842c5426634e7929541eC2318f3dCF7e` and `BUYER_KEY` to the
test wallet key, then `node scripts/seed-bazaar.mjs --only /fx,/btc-price --pay --ledger-excluded`.

Before each release, run the whole demand order there (same variables, no `--only`, about 0.67 faucet USDC):
every tool must settle on testnet with its published example. A failure is a first payment we would lose in
production; fix the example or the tool first. `npm run smoke:examples` is the quicker check without payment.

## What to expect

From the measurement of 15–19 October: bot B pays each new payee once or twice and already paid us; bot A
returns to crypto risk checks, tweet search, funding screeners, scam checks and chain reads, at $0.01–0.05
per call. Listing is the gate, not a guarantee: watch `/revenue` (`distinctExternalWallets`) and
`/metrics/callers` for a week before seeding further sections.
