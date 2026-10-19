# Per-call MPP on the tools (Tempo)

Status (2026-10-19): built behind a flag that stays **off** until `TEMPO_PAY_TO` is set. Nothing changes in production
until Peter makes the receiving-address decision below. No step needs money, a deposit or a self-payment.

## Why

MPPScan (Merit Systems) lists a resource without a first settled payment, unlike the Coinbase Bazaar, but it rejected
the 175 tools because they answer only x402. Card MPP cannot sell single calls (Stripe's $0.50 minimum), so per-call
MPP needs a stablecoin method. Tempo is the method MPP clients pay with by default.

## Research answers

| Question | Answer | Source |
|---|---|---|
| Is Tempo mainnet live? | Yes. Chain id 4217, RPC `https://rpc.tempo.xyz`, explorer `https://explore.tempo.xyz`. Measured 19 Oct 2026: `eth_chainId` = `0x1079`, block ≈ 44.9 M. The Tempo FAQ dates mainnet to 18 Mar 2026. Testnet: Moderato, chain 42431. | [connection details](https://tempo.xyz/developers/docs/quickstart/connection-details), [Tempo FAQ](https://tempo.xyz/faq/) |
| Which stablecoin do agents pay with? | **USDC.e** (`0x20c0…b9537d11c60e8b50`), USDC bridged 1:1 through Stargate. MPP Credits (card-funded agent balances) settle to merchants in USDC.e on Tempo. mppx 0.13.5 offers OUSD and USDC.e on mainnet by default; pathUSD is the default *fee* token. We accept USDC.e only: one challenge per tool, one asset in the ledger. | [MPP credits](https://tempo.xyz/blog/mpp-credits), [Stargate bridge](https://across.to/blog/how-to-bridge-to-tempo-the-payments-blockchain-built-by-stripe-and-paradigm), `node_modules/mppx/dist/tempo/internal/defaults.js` |
| What does the mppx tempo server method need? | A recipient address, the chain id and currency, an RPC (public default), an HMAC secret for challenges, and an **atomic replay store shared by all isolates** (built here on the `global` Durable Object, `src/lib/mpp-store.ts`). A fee payer is optional and **not used**: without it the buyer's transaction pays its own fee. | `node_modules/mppx/dist/tempo/server/Charge.d.ts` |
| Fees per settlement, who pays gas? | The buyer, in a USD stablecoin. A TIP-20 transfer (~50k gas) costs ~$0.00003–$0.0006. The very first transfer to a fresh address costs ~300k gas (~$0.0036 at the cap), paid once by the first buyer. This server pays nothing and holds no key. | [fees](https://tempo.xyz/developers/docs/protocol/fees), [fee spec](https://tempo.xyz/developers/docs/protocol/fees/spec-fee), [EVM differences](https://tempo.xyz/developers/docs/quickstart/evm-compatibility) |
| Can PAY_TO receive and later move funds on Tempo? | It can **receive**: a TIP-20 transfer works to any address, and on Tempo PAY_TO is an untouched plain account (measured 19 Oct: no code, nonce 0, balance 0; on Base it is an EIP-7702 account delegated to `0x7702cb55…`, nonce 1; the delegation does not carry over to Tempo). **Moving** funds out needs the account's own key to sign a Tempo transaction. A plain USDC.e `transfer` pays its own fee in USDC.e (fee-token rule 3), so no pathUSD is needed. Unverified: whether Peter's Coinbase Wallet / Base app account can sign a transaction on chain 4217. Coinbase's developer platform does not support sending on Tempo. The Coinbase app supports USDC.e on Tempo only for its custodial accounts (a different address). | [fee spec](https://tempo.xyz/developers/docs/protocol/fees/spec-fee), [EIP-7702 on Tempo](https://tempo.xyz/developers/docs/protocol/transactions/eip-7702), [CDP Tempo](https://docs.cdp.coinbase.com/wallets/demos/tempo), on-chain reads of Base and Tempo RPCs |

## Decision for Peter: which address receives on Tempo

The only open step. Each option is free and needs no funds.

- **A. Reuse PAY_TO, after a check (recommended if the check passes).** In the wallet that holds PAY_TO, add the
  network *Tempo Mainnet*: chain id 4217, RPC `https://rpc.tempo.xyz`, currency symbol USD, explorer
  `https://explore.tempo.xyz`. Then confirm that the same `0x2074…77f5` address appears on Tempo and that the wallet
  offers Send there. If it does, set `TEMPO_PAY_TO` to PAY_TO. If it does not, money sent there is not lost (the key
  exists), but it stays stuck until the recovery phrase is imported into a Tempo-capable wallet, which is not advised.
- **B. A separate Tempo address.** Create one in a wallet that supports Tempo natively, for example Tempo Wallet
  (passkey). This is a new wallet, so it is Peter's decision.
- **C. Leave it off.** The code stays dormant and MPPScan keeps listing only the three credit packs.

## Switching on (after the decision)

1. Fill in `"TEMPO_PAY_TO": "0x…"` in `vars` in `wrangler.jsonc` (empty today; it is public, not a secret). `MPP_SECRET_KEY` is
   optional: without it the challenge key is derived from `CDP_API_KEY_SECRET`, which production already has.
   `TEMPO_RPC_URL` is optional too.
2. Release and deploy through the guard (`npm run deploy:production -- --expected-version <uuid>`).
3. Check: `curl -i "<origin>/time?zone=UTC"` shows `WWW-Authenticate: Payment … method="tempo" intent="charge"` next to
   `PAYMENT-REQUIRED`, and `/openapi.json` lists `{ mpp: { method: "tempo", … } }` for each tool.
4. Re-register the origin at mppscan.com/register so the 175 tools are probed again.

Staging proof before mainnet (free testnet funds): deploy staging with `TEMPO_NETWORK=testnet` (Moderato, pathUSD).
Pay one call with an mppx client funded from the Moderato faucet. That needs a `--tempo` mode in
`scripts/pay-test.mjs`, which is not built yet.

## What the code does (`src/lib/mpp-tempo.ts`)

- Every unpaid tool 402 carries both `PAYMENT-REQUIRED` (x402, unchanged) and a `WWW-Authenticate: Payment` tempo/charge
  challenge. The challenge holds the recipient, USDC.e, the amount in atomic units, chain 4217, `supportedModes: ["pull"]`,
  a 5-minute expiry and an HMAC binding to the tool's path, so a credential for a cheap tool cannot pay for another.
  The x402 quote never fails because of MPP: if the challenge cannot be built, the x402 terms go out alone.
- `Authorization: Payment …` goes through the following steps:
  1. Validate: challenge, route, amount, recipient and memo, plus a simulation on the Tempo RPC.
  2. Run the tool.
  3. **Broadcast only if it succeeded** (pull mode: the buyer signs, we send). A failed call is never charged.
  4. Answer with `Payment-Receipt`, and record the receipt in the settlement ledger (network `eip155:4217`, asset USDC.e,
     transaction hash as the payment's identity). `/revenue` and `/metrics` count it like an x402 settlement.
- Push mode (the buyer broadcasts first) is not offered, because it would charge before the tool runs.
- Replay: a used credential is refused before the tool runs. The claim is atomic in the Durable Object, so a second
  isolate cannot serve a replayed credential either.
- Funnel stages are the same as for x402 (`attempt`, `verified`, `settled`, `refused_*`, `verification_failed`,
  `settlement_failed`). `facilitator_unavailable` here means the Tempo RPC could not be reached. `/metrics/callers` counts
  refused MPP attempts as `mpp_payment`.
- Not covered: MCP tool calls (x402 and card credits only) and `/buy/*` store purchases.

## MPPScan warnings on the credit packs (fixed in the same change)

Checked with MPPScan's own validator (`@agentcash/discovery`) against the live packs before the change, and against
the new build after it:

- `MPP_CHALLENGE_RECIPIENT_MISSING`: the Stripe challenge now names the Stripe profile as `recipient`.
- `L3_INPUT_SCHEMA_MISSING`: it came from the POST and HEAD probes, which answered 402 with no OpenAPI operation behind
  them. The packs now answer GET only (405 with `Allow: GET` otherwise), as OpenAPI declares.

After the change, the tools and packs report no MPP, x402 or OpenAPI warnings (local Miniflare build, flag on).

## Other options, not built

- **MPP `evm` method on Base** (in mppx 0.13.5): EIP-3009 USDC on Base to the existing PAY_TO, settled through the CDP
  facilitator. It needs no new address and MPPScan's validator accepts it. Its buyers would mostly be agents that can
  already pay x402, so it is mainly a listing route. It could be a second challenge next to tempo.
- Fee sponsorship (`feePayer`) would let buyers without a fee token pay. It needs a funded Tempo account, so it is out
  under the no-spending rule.
