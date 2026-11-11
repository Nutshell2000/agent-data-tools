import type { INodeProperties } from 'n8n-workflow';
import { optionsFor, query, showFor } from '../shared/fields';

export const screeningDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['screening'] } },
		options: [
			{
				name: 'Check Payee',
				value: 'checkPayee',
				action: 'Screen a payee before paying',
				description:
					'OFAC match on an address, its account type and nonce, and optionally the age and trust flags of the payee domain, with a block, review or pass verdict. A screening aid, not legal advice.',
				routing: { request: { method: 'GET', url: '/check/payee' } },
			},
			{
				name: 'Check Sanctions',
				value: 'checkSanctions',
				action: 'Check an address or name against OFAC sanctions',
				description:
					'Screen a crypto address or a person or company name against the OFAC SDN list, with a block, review or pass verdict. A screening aid, not legal advice.',
				routing: { request: { method: 'GET', url: '/sanctions/check' } },
			},
		],
		default: 'checkSanctions',
	},

	// Check Sanctions
	{
		displayName: 'Screen',
		name: 'sanctionsSubject',
		type: 'options',
		noDataExpression: true,
		default: 'address',
		displayOptions: showFor('screening', 'checkSanctions'),
		options: [
			{ name: 'Crypto Address', value: 'address' },
			{ name: 'Name', value: 'name' },
			{ name: 'Crypto Address and Name', value: 'both' },
		],
	},
	{
		displayName: 'Crypto Address',
		name: 'address',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 0x098B716B8Aaf21512996dC57EB0615e2383E2f96',
		description: 'Address to check: EVM, BTC, TRX and other formats on the SDN list',
		displayOptions: {
			show: {
				resource: ['screening'],
				operation: ['checkSanctions'],
				sanctionsSubject: ['address', 'both'],
			},
		},
		routing: query('address'),
	},
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. Lazarus Group',
		description:
			'Person or company name. It matches when every word appears in a listed name or alias.',
		displayOptions: {
			show: {
				resource: ['screening'],
				operation: ['checkSanctions'],
				sanctionsSubject: ['name', 'both'],
			},
		},
		routing: query('name'),
	},
	optionsFor('screening', 'checkSanctions', []),

	// Check Payee
	{
		displayName: 'Address',
		name: 'address',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
		description: 'The 0x address you are about to pay',
		displayOptions: showFor('screening', 'checkPayee'),
		routing: query('address'),
	},
	{
		displayName: 'Network',
		name: 'chain',
		type: 'options',
		default: 'base',
		description: 'Network of the payment',
		displayOptions: showFor('screening', 'checkPayee'),
		options: [
			{ name: 'Arbitrum', value: 'arb' },
			{ name: 'Base', value: 'base' },
			{ name: 'Ethereum', value: 'eth' },
			{ name: 'Optimism', value: 'op' },
			{ name: 'Polygon', value: 'polygon' },
		],
		routing: query('chain'),
	},
	optionsFor('screening', 'checkPayee', [
		{
			displayName: 'Payee Domain',
			name: 'domain',
			type: 'string',
			default: '',
			placeholder: 'e.g. ethereum.org',
			description: 'Domain or website URL of the payee. Adds the domain age and trust flags.',
			routing: query('domain'),
		},
	]),
];
