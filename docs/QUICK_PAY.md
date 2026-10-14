# Quick first payment (get indexed)

This page explains the minimal steps to get a paid x402 call settled and visible to directory indexers.

Why a settled payment matters
- Some directories (eg. Coinbase Bazaar, 402 Index) consider a successful paid x402 call mediated by the configured facilitator as proof the endpoint works and will index the endpoint after a settled payment through the facilitator.
- Confirm the PAY_TO address in your wrangler.jsonc before sending funds.

Probe a paid endpoint and inspect the PAYMENT-REQUIRED header

Replace YOUR-URL with your deployed origin:

```bash
curl -s -D - -o /dev/null "https://YOUR-URL/domain?name=cloudflare.com" | grep -i PAYMENT-REQUIRED | cut -d' ' -f2 | base64 -d
```

The decoded JSON shows the accepts array with amount, asset, network and payTo.

Mainnet vs testnet (rehearse on testnet first)

- Testnet (rehearse only): use a testnet RPC and test USDC faucet tokens. The test/facilitator URL used in documentation: https://x402.org/facilitator
- Mainnet: only pay real USDC to PAY_TO when you are sure the address is correct and you're ready to spend real funds.

Micro-dollar suffix trick for store orders

The store order mechanism appends a small 1–9999 micro-dollar suffix to the USDC amount (6 decimals) so a chain transfer of that exact amount identifies the order without any memo. See src/store/orders.ts createOrder() logic for details.

Programmatic example (viem) — DO NOT RUN ON MAINNET

```js
// WARNING: spends tokens. Use testnet keys and TESTNET=1 for safety.
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http } from 'viem';

const PRIVATE_KEY = process.env.PRIVATE_KEY; // never commit
const RPC_URL = process.env.RPC_URL; // testnet RPC
const USDC = process.env.USDC_ADDRESS; // testnet USDC address
const PAY_TO = process.env.PAY_TO; // from wrangler.jsonc
const AMOUNT = BigInt(process.env.AMOUNT); // amount in USDC 6-decimal units

if (!process.env.TESTNET) throw new Error('Refuse to run unless TESTNET=1');
const account = privateKeyToAccount(PRIVATE_KEY);
const wallet = createWalletClient({ account, transport: http(RPC_URL) });

// Build and send ERC-20 transfer (ERC20 ABI transfer)
const erc20 = [
  { "type": "function", "name": "transfer", "stateMutability": "nonpayable", "inputs": [{ "name": "to", "type": "address" }, { "name": "value", "type": "uint256" }], "outputs": [] }
];

async function send() {
  const data = wallet.encodeFunctionData({ abi: erc20, functionName: 'transfer', args: [PAY_TO, AMOUNT] });
  const tx = await wallet.sendTransaction({ to: USDC, data });
  console.log('txHash:', tx);
}

send().catch((e) => { console.error(e); process.exit(1); });
```

Troubleshooting checklist
- Check the transfer on the chain explorer for the chain you used (eg. basescan.org for Base). Search for transfers to PAY_TO or your tx hash.
- Use the order page `/order/:id/status` or the store pages to confirm the order state changes to `paid`.
- Wait for at least 1–2 confirmations/settlement; some directories wait for finality before indexing.
- Re-run the original paid call (or have the directory re-run its validation) and check `GET /metrics` for an increase in "paid" counters.

Where to watch
- Explorer: https://basescan.org (switch to the appropriate network explorer for testnet/mainnet)
- Service metrics: GET /metrics returns daily counts per paid path including "paid" vs "challenged".

Safety
- Never commit private keys. Use a test wallet and faucets for testing.
- The example helper script is explicitly guarded to refuse running unless TESTNET=1 is set.

