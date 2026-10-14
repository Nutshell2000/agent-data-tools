#!/usr/bin/env node
/*
  Testnet helper: send a USDC transfer to PAY_TO on the configured testnet RPC.
  Safety: refuses to run unless TESTNET=1 is set in env. Reads PRIVATE_KEY, RPC_URL, USDC_ADDRESS, PAY_TO and AMOUNT from env.
  CAUTION: spends tokens. Use only testnet keys and faucets.
*/
import('viem').then(async (viem) => {
  if (process.env.TESTNET !== '1') {
    console.error('Refusing to run: set TESTNET=1 to confirm testnet use');
    process.exit(2);
  }
  const { privateKeyToAccount } = await import('viem/accounts');
  const { createWalletClient, http } = await import('viem');

  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  const RPC_URL = process.env.RPC_URL;
  const USDC = process.env.USDC_ADDRESS;
  const PAY_TO = process.env.PAY_TO;
  const AMOUNT = process.env.AMOUNT; // string of integer in USDC 6-decimal units (e.g. '19001234')

  if (!PRIVATE_KEY || !RPC_URL || !USDC || !PAY_TO || !AMOUNT) {
    console.error('Missing one of PRIVATE_KEY, RPC_URL, USDC_ADDRESS, PAY_TO or AMOUNT in env');
    process.exit(2);
  }

  try {
    const account = privateKeyToAccount(PRIVATE_KEY);
    const wallet = createWalletClient({ account, transport: http(RPC_URL) });

    const erc20 = [{ type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }], outputs: [] }];
    const data = wallet.encodeFunctionData({ abi: erc20, functionName: 'transfer', args: [PAY_TO, BigInt(AMOUNT)] });

    console.log('Sending transfer to', PAY_TO, 'amount (6-decimal USDC units):', AMOUNT);
    const res = await wallet.sendTransaction({ to: USDC, data });
    console.log('tx:', res);
  } catch (e) {
    console.error('Error sending transaction:', e);
    process.exit(1);
  }
}).catch((e) => { console.error('Failed to import viem:', e); process.exit(1); });
