# Bazaar seeding

Owner decision, 19 October 2026: the Coinbase Bazaar is where the only paying agents found us (both buyer
bots of the week pay almost exclusively Bazaar-listed resources: 99% and 78% of their payees), and Coinbase
indexes a resource only after its first payment settles through the CDP facilitator. So each tool is paid
for once by the owner, from a buyer wallet he funds, into our own `PAY_TO`. Nothing leaves the business:
the USDC moves from one owner wallet to the other and the facilitator pays the gas.

These settlements are never revenue or demand. The buyer wallet is listed in `OWNED_WALLETS`
(`src/lib/settlement-ledger.ts`), so the ledger records them as `selfPayment: true` and `/revenue` excludes
them from `grossAtomic`; the weekly review and the daily report ignore self-payments.

## Steps (Peter, once per batch)

1. `node scripts/seed-bazaar.mjs wallet` creates the buyer wallet (`.seed-bazaar-wallet.json`, git-ignored, never the
   payout wallet's key) and prints its address. Send that address about 1 USDC on Base from Coinbase Wallet.
2. The local session adds the address to `OWNED_WALLETS`, deploys through the guard, and confirms with
   `/revenue` that it is live.
3. In a terminal in `C:\MoneyWallet\x402-canonical` (the key is read from `.seed-bazaar-wallet.json`; `BUYER_KEY` in
   the environment overrides it):

   ```sh
   node scripts/seed-bazaar.mjs
   ```

   reads the plan for the `prices` and `compliance` sections (23 payments, 0.477 USDC at current prices, of
   which `/package-audit` alone is 0.20; drop it with `--only` if you prefer), checks
   each tool's live 402 terms (our address, Base USDC, the catalog price) and pays nothing. Then:

   ```sh
   node scripts/seed-bazaar.mjs --pay --ledger-excluded
   ```

   pays each tool once, prints the transaction per tool and any Bazaar `EXTENSION-RESPONSES` outcome, and
   writes a private git-ignored log `.seed-bazaar-<time>.json`. Tools already listed are skipped, so a re-run
   only retries failures. Other sections: `--set chain`, `--set web,everyday`; named tools: `--only /ens,/btc-address`.
   The run refuses to spend more than `--max-total` (default 1.00 USD).

4. After about ten minutes, `node scripts/bazaar-listings.mjs` (in `C:\MoneyWallet\x402-api\scripts`) lists
   what the Bazaar now shows for our address. Agentic.Market and the 402 Index "bazaar" entries follow from it.

## Rehearsal on staging (no real money)

The same script runs against the Base Sepolia staging Worker with the faucet test wallet (already in
`OWNED_WALLETS`), which proves the paying path before Peter uses it: set `SEED_ORIGIN` to the staging URL,
`SEED_NETWORK=eip155:84532`, `SEED_USDC=0x036CbD53842c5426634e7929541eC2318f3dCF7e` and `BUYER_KEY` to the
test wallet key, then `node scripts/seed-bazaar.mjs --only /fx,/btc-price --pay --ledger-excluded`.

## What to expect

From the measurement of 15–19 October: bot B pays each new payee once or twice and already paid us; bot A
returns to crypto risk checks, tweet search, funding screeners, scam checks and chain reads, at $0.01–0.05
per call. Listing is the gate, not a guarantee: watch `/revenue` (`distinctExternalWallets`) and
`/metrics/callers` for a week before seeding further sections.
