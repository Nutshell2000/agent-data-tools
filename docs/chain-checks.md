# Check a Base transaction or wallet with a capped client

Buy one structured result using an existing funded x402 wallet. No service account, API key, subscription, npm installation or TypeScript is needed to use the download. Requires Node **20.19+**. The client reads facts; it never sends your intended transaction, approves a spender or transfers tokens on your behalf. An explicit `buy` pays for the tool result in Base native USDC.

| Operation | Existing API | Required flags | Maximum per invocation |
| --- | --- | --- | --- |
| `tx` | `/base-tx` | `--hash` | $0.003 |
| `wallet` | `/wallet` | `--address` | $0.005 |
| `gas` | `/base-gas` | none | $0.002 |
| `allowance` | `/base-allowance` | `--token`, `--owner`, `--spender` | $0.002 |

These are the existing service prices, not a bundle or subscription. Each separately invoked purchase can charge once. Choose only the facts needed for your task. The caps are per invocation, not a session, daily or wallet-wide budget.

## Download and verify

Download [chain-client.mjs](https://github.com/Nutshell2000/agent-data-tools/releases/download/chain-client-1.0.0/chain-client.mjs) and [chain-client.mjs.sha256](https://github.com/Nutshell2000/agent-data-tools/releases/download/chain-client-1.0.0/chain-client.mjs.sha256) into the same folder. Keep both filenames unchanged. [Release and tested source tag](https://github.com/Nutshell2000/agent-data-tools/releases/tag/chain-client-1.0.0) · [source and reproducible build](../clients/chain/README.md).

POSIX shell (Linux):

```sh
sha256sum -c chain-client.mjs.sha256 && node chain-client.mjs --help
```

On macOS use `shasum -a 256 -c chain-client.mjs.sha256 && node chain-client.mjs --help`. The `&&` prevents execution if verification fails.

PowerShell:

```powershell
$checksumLine = (Get-Content -LiteralPath './chain-client.mjs.sha256' -Raw).Trim()
if ($checksumLine -cnotmatch '^[0-9a-f]{64}  chain-client\.mjs$') { throw 'Invalid checksum file' }
$expectedHash = $checksumLine.Substring(0, 64)
$actualHash = (Get-FileHash -LiteralPath './chain-client.mjs' -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -cne $expectedHash) { throw 'Checksum mismatch; stop' }
node ./chain-client.mjs --help
```

Checksums detect mismatched files; they are not independent security signatures. No wallet or key is needed to download, inspect help or request a quote. The executable is bundled; it runs without the source checkout or `node_modules`.

## Workflow 1: check one existing transaction — maximum $0.003

Choose the hash of the **existing Base transaction** your task needs. The hash below is the service's published example, not a customer purchase or evidence of payment to our service.

POSIX shell:

```sh
transaction_hash='0x7d108fa131ed949c76d50caf2e7dfe25fc9903b9d276c40a0446d8afbdfe86b0'
node chain-client.mjs quote tx --hash "$transaction_hash"
# Only with spending authorization and a locally configured existing signer:
node chain-client.mjs buy tx --hash "$transaction_hash" --max-usdc 0.003
```

PowerShell:

```powershell
$transactionHash = '0x7d108fa131ed949c76d50caf2e7dfe25fc9903b9d276c40a0446d8afbdfe86b0'
node ./chain-client.mjs quote tx --hash $transactionHash
# Only with spending authorization and a locally configured existing signer:
node ./chain-client.mjs buy tx --hash $transactionHash --max-usdc 0.003
```

Run the quote first and inspect it. It checks terms, not transaction existence or upstream availability. Configure `X402_PRIVATE_KEY` privately in the local process using your existing secret handling; do not paste it into chat, URLs, shared files or command arguments. Obtain the wallet owner's authorization before buying. Do not execute purchase examples as an unattended script.

Inspect `ok`, `paymentStatus`, `result.status`, `result.confirmations`, `result.checkedAt`, `requestId`, `receipt` and `limitations`. A successful transaction can be unrelated to the intended USDC transfer: this API does not decode and match the token, recipient and amount. A receipt for the tool purchase is separate from the transaction being queried.

`pending` is inconclusive; upstream receipt availability may also be incomplete. Do not start a paid polling loop. A future check is a separate purchase requiring a task reason and spending authorization.

## Workflow 2: inspect a wallet before a transaction — maximum $0.005 for the wallet snapshot

Replace the illustrative public address with the wallet the buyer deliberately chooses. No wallet is connected by these commands.

POSIX shell:

```sh
wallet_address='0x4200000000000000000000000000000000000006'
node chain-client.mjs quote wallet --address "$wallet_address"
# Optional explicit purchase of this snapshot only:
node chain-client.mjs buy wallet --address "$wallet_address" --max-usdc 0.005
```

PowerShell:

```powershell
$walletAddress = '0x4200000000000000000000000000000000000006'
node ./chain-client.mjs quote wallet --address $walletAddress
# Optional explicit purchase of this snapshot only:
node ./chain-client.mjs buy wallet --address $walletAddress --max-usdc 0.005
```

The wallet response includes native ETH and a bounded selection of tokens. **Missing token rows are not proof of zero balance**; some token reads may have failed or the token may be outside the checked set. This is not complete portfolio or transaction history. Concurrent reads need not form an atomic snapshot. Account nonce is not full payment or trading history.

### Optional checks — do not run them automatically

Only request gas when the task needs a current execution-fee estimate:

```sh
node chain-client.mjs quote gas
# Separate authorized purchase, maximum $0.002:
node chain-client.mjs buy gas --max-usdc 0.002
```

These commands also work in PowerShell with `./chain-client.mjs`. Estimates exclude the Ethereum posting cost and do not simulate a specific transaction.

Only request allowance when the task already identifies the exact token, owner and spender. These flags are addresses of data being checked, not payment recipients. This client's tool-payment recipient is fixed.

```sh
token_address='0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
owner_address='0x4200000000000000000000000000000000000006'
spender_address='0x000000000022D473030F116dDEE9F6B43aC78BA3'
node chain-client.mjs quote allowance --token "$token_address" --owner "$owner_address" --spender "$spender_address"
# Separate authorized purchase, maximum $0.002:
node chain-client.mjs buy allowance --token "$token_address" --owner "$owner_address" --spender "$spender_address" --max-usdc 0.002
```

PowerShell:

```powershell
$tokenAddress = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
$ownerAddress = '0x4200000000000000000000000000000000000006'
$spenderAddress = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
node ./chain-client.mjs quote allowance --token $tokenAddress --owner $ownerAddress --spender $spenderAddress
# Separate authorized purchase, maximum $0.002:
node ./chain-client.mjs buy allowance --token $tokenAddress --owner $ownerAddress --spender $spenderAddress --max-usdc 0.002
```

`approved: true` means positive allowance, not sufficient allowance for the intended amount. Compare the raw amount using the token's decimals; do not infer permission to trade or transfer. The client never sends an approval.

Wallet plus both optional checks costs at most **$0.009**, if separately authorized. A later transaction-status purchase adds at most **$0.003**. These are alternatives and optional steps, not a sequence the client executes for you.

## Interpret the outcome before another purchase

The client prints one JSON object and returns exit status 0 only when `ok` is true. Quote output has `paymentStatus: not_signed`. Successful purchases include the validated documented result fields, local interpretation limits, request ID and sanitized server-reported receipt. Arbitrary additional server fields are omitted.

- `unknown`: an authorization was attempted but settlement is unconfirmed. **Stop and reconcile. Never automatically retry or start a fresh invocation to recover.**
- `settled` with `ok: false`: the server reported a settlement, but delivery failed validation or returned an error. Keep the receipt; another purchase is not a repair.
- `reported_not_settled`: the server reported failure to settle. This is not independent chain proof; signed failures still require review before another purchase.
- `not_signed`: this invocation did not attempt payment authorization.

Malformed results do not erase settlement evidence. A dropped connection is not proof of nonpayment. Client requests are pinned to our origin, fixed recipient, Base native USDC and exact scheme; redirects, mismatched resources and quotes above either the explicit cap or operation ceiling are rejected. The client never automatically retries an authorization or submission.

For a real problem, use the existing [purchase-support issue form](https://github.com/Nutshell2000/agent-data-tools/issues/new?template=purchase-problem.yml). Include request ID, approximate UTC time and payment status; never include keys, signatures, raw payment headers or private information.

## Offline interpretation examples

These fabricated **result excerpts** illustrate interpretation only. They are not complete client responses, live RPC observations, customer purchases or settlement receipts:

```json
{"status":"pending","confirmations":0}
```

Do not claim final success or automatically buy another check.

```json
{"tokens":[],"tokensChecked":3}
```

Do not turn missing rows into asserted zero token balances.

```json
{"allowance":"1","decimals":6,"allowanceFormatted":"0.000001","approved":true,"unlimited":false}
```

This is a small positive allowance, not proof it covers a proposed transfer.

The release's payment/signing tests use offline fixtures. Funded production delivery and customer demand remain unverified until genuine external receipts and useful delivered results establish them. Quotes, downloads and these demonstrations are not sales.
