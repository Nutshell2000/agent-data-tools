import type { INodeProperties } from 'n8n-workflow';
import { optionsFor, query, showFor } from '../shared/fields';

export const cryptoDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['crypto'] } },
		options: [
			{
				name: 'Get Indicators',
				value: 'getIndicators',
				action: 'Get technical indicators for a coin',
				description:
					'RSI, MACD, moving averages, Bollinger bands, ATR and volatility for a Hyperliquid perpetual on closed candles. Not investment advice.',
				routing: { request: { method: 'GET', url: '/hyperliquid/indicators' } },
			},
			{
				name: 'Get Price',
				value: 'getPrice',
				action: 'Get the price of a token',
				description:
					'USD spot price of a token from its deepest Uniswap v3 pool on Base, Ethereum, Arbitrum or Optimism',
				routing: { request: { method: 'GET', url: '/price/token' } },
			},
		],
		default: 'getPrice',
	},

	// Get Price
	{
		displayName: 'Look Up By',
		name: 'priceLookup',
		type: 'options',
		noDataExpression: true,
		default: 'symbol',
		displayOptions: showFor('crypto', 'getPrice'),
		options: [
			{ name: 'Symbol', value: 'symbol' },
			{ name: 'Contract Address', value: 'address' },
		],
	},
	{
		displayName: 'Symbol',
		name: 'symbol',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. ETH',
		description:
			'Ticker such as ETH, BTC, USDC, AERO, ARB, OP or LINK. ETH and BTC mean the wrapped tokens.',
		displayOptions: {
			show: { resource: ['crypto'], operation: ['getPrice'], priceLookup: ['symbol'] },
		},
		routing: query('symbol'),
	},
	{
		displayName: 'Contract Address',
		name: 'address',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
		description: 'The 0x contract address of the ERC-20 token',
		displayOptions: {
			show: { resource: ['crypto'], operation: ['getPrice'], priceLookup: ['address'] },
		},
		routing: query('address'),
	},
	{
		displayName: 'Network',
		name: 'chain',
		type: 'options',
		default: 'base',
		description: 'Network whose pools are read',
		displayOptions: showFor('crypto', 'getPrice'),
		options: [
			{ name: 'Arbitrum', value: 'arb' },
			{ name: 'Base', value: 'base' },
			{ name: 'Ethereum', value: 'eth' },
			{ name: 'Optimism', value: 'op' },
		],
		routing: query('chain'),
	},
	optionsFor('crypto', 'getPrice', []),

	// Get Indicators
	{
		displayName: 'Coin',
		name: 'coin',
		type: 'string',
		required: true,
		default: 'BTC',
		placeholder: 'e.g. BTC',
		description: 'Coin symbol of a Hyperliquid perpetual, such as BTC, ETH, SOL or HYPE',
		displayOptions: showFor('crypto', 'getIndicators'),
		routing: query('coin'),
	},
	{
		displayName: 'Interval',
		name: 'interval',
		type: 'string',
		required: true,
		default: '4h',
		placeholder: 'e.g. 4h',
		description: 'Length of one candle: 1m, 5m, 15m, 30m, 1h, 4h, 1d or 1w',
		displayOptions: showFor('crypto', 'getIndicators'),
		routing: query('interval'),
	},
	optionsFor('crypto', 'getIndicators', []),
];
