# Per-call MPP on the tools (evm on Base, and Tempo)

Status (2026-10-20): two MPP methods exist on the tools, next to x402.

- **evm/charge, USDC on Base to PAY_TO: ON by default** (1.36.0, `src/lib/mpp-evm.ts`, section "The evm method" below).
  It reuses the x402 facilitator and the CDP secret, so it needs no new address, deposit or self-payment.
- **tempo/charge, USDC.e on Tempo: off** until `TEMPO_PAY_TO` is set (`src/lib/mpp-tempo.ts`). Nothing changes there
  until Peter makes the receiving-address decision below. No step needs money, a deposit or a self-payment.

## Why

MPPScan (Merit Systems) lists a resource without a first settled payment, unlike the Coinbase Bazaar, but it rejected
the 175 tools because they answer only x402. Card MPP cannot sell single calls (Stripe's $0.50 minimum), so per-call
MPP needs a stablecoin method. Tempo is the method MPP clients pay with by default; the evm method (USDC on Base) is the
one that costs us nothing to switch on, so it went live first.

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

**Staging proof done (2026-10-20, free testnet funds):** `wrangler.staging.jsonc` runs with `TEMPO_NETWORK=testnet` (Moderato,
chain 42431, pathUSD) and `TEMPO_PAY_TO` = the test-only PAY_TO. The test wallet was funded with the faucet RPC
(`tempo_fundAddress` on https://rpc.moderato.tempo.xyz) and `node scripts/pay-test.mjs <staging>/time?zone=UTC --tempo`
paid one call: HTTP 200, `Payment-Receipt` with transaction `0xb3c18072…` (pull mode, pathUSD, mined on Moderato). So
the tempo path is proven end to end; production only needs the receiving address below.

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

## The evm method: USDC on Base, on by default (`src/lib/mpp-evm.ts`)

Shipped 2026-10-20 (1.36.0). It is the MPP `evm` method of mppx 0.13.5: the buyer signs an EIP-3009
`TransferWithAuthorization` for USDC on our x402 network (Base in production, Base Sepolia on staging) to PAY_TO and
sends it as `Authorization: Payment …`; we settle it through the same facilitator as x402 (CDP in production, the
keyless testnet one on staging). This is the x402 "exact" primitive carried by MPP, so nothing new has to be funded,
no new key exists, and the ledger records it with the same identity an x402 receipt of that authorization would have.

- Every unpaid tool 402 carries `PAYMENT-REQUIRED` (x402, unchanged) and `WWW-Authenticate: Payment … method="evm"
  intent="charge"` (plus the tempo challenge while that is on). `/openapi.json` declares
  `protocols: [{ x402: {} }, { mpp: { method: "evm", intent: "charge", currency: <USDC> } }]` per tool, which is what
  MPPScan reads. `/credits/buy/*` keep their Stripe (card) challenge.
- An `Authorization: Payment` credential is dispatched by the method named inside it (`evm` or `tempo`); any other
  method is refused as `refused_format`.
- Steps for an evm credential: mppx validates the challenge binding, route, amount, recipient and signature
  (`refused_format` / `refused_amount` without any facilitator call); the nonce is claimed atomically in the Durable
  Object (a replay is refused before anything runs); the facilitator **verifies** the authorization (signature against
  the token domain, balance); the tool runs; **settle only if it succeeded** (a failed call is never charged), with the
  resource URL and the tool's Bazaar discovery extension in the payment payload, so a settled MPP payment can index the
  tool in the Coinbase Bazaar exactly as an x402 payment would; `Payment-Receipt` carries the transaction hash; the
  receipt lands in the settlement ledger and `/revenue`.
- A facilitator outage answers 402 `facilitator_unavailable` ("you were not charged"); a facilitator rejection answers
  402 `verification_failed` with its reason, as the x402 paths do.
- Switch: `MPP_EVM` in `wrangler.jsonc` (`"on"`; `"off"` removes the challenge, the OpenAPI entry and the dispatch).
  The challenge-signing key is `MPP_SECRET_KEY` when set, else derived from `CDP_API_KEY_SECRET`; staging has a plain
  `MPP_SECRET_KEY` var because it has no CDP secret.
- Staging proof (faucet USDC, no real money): `node scripts/pay-test.mjs <staging>/time?zone=UTC --mpp-evm` prints
  `paid: HTTP 200` and the `Payment-Receipt`. Run it after every release next to the three x402 proofs.
- Tests: `tests/mpp-evm.test.cjs` (Miniflare, facilitator mocked, mppx client buyer).
## MPPScan warnings on the credit packs (fixed in the same change)

Checked with MPPScan's own validator (`@agentcash/discovery`) against the live packs before the change, and against
the new build after it:

- `MPP_CHALLENGE_RECIPIENT_MISSING`: the Stripe challenge now names the Stripe profile as `recipient`.
- `L3_INPUT_SCHEMA_MISSING`: it came from the POST and HEAD probes, which answered 402 with no OpenAPI operation behind
  them. The packs now answer GET only (405 with `Allow: GET` otherwise), as OpenAPI declares.

After the change, the tools and packs report no MPP, x402 or OpenAPI warnings (local Miniflare build, flag on).

## Other options, not built

- Fee sponsorship (`feePayer`) would let buyers without a fee token pay. It needs a funded Tempo account, so it is out
  under the no-spending rule.
