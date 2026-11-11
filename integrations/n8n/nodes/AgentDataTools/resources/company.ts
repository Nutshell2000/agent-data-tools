import type { INodeProperties } from 'n8n-workflow';
import { optionsFor, query, showFor } from '../shared/fields';

export const companyDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['company'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				action: 'Look up a company',
				description:
					'Website, founding date, country, headquarters, industries, CEO, parent, employees, tickers and LEI from Wikidata',
				routing: { request: { method: 'GET', url: '/company' } },
			},
			{
				name: 'Get SEC Filings',
				value: 'getFilings',
				action: 'Get SEC filings of a company',
				description:
					'Latest SEC EDGAR filings of a US-listed company (10-K, 10-Q, 8-K, Form 4 and more) with dates and direct links',
				routing: { request: { method: 'GET', url: '/sec/filings' } },
			},
		],
		default: 'get',
	},

	// Get
	{
		displayName: 'Look Up By',
		name: 'companyLookup',
		type: 'options',
		noDataExpression: true,
		default: 'name',
		displayOptions: showFor('company', 'get'),
		options: [
			{ name: 'Name', value: 'name' },
			{ name: 'Wikidata ID', value: 'id' },
		],
	},
	{
		displayName: 'Company Name',
		name: 'name',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. Spotify',
		description: 'Company name to search for. Works best for established and listed companies.',
		displayOptions: {
			show: { resource: ['company'], operation: ['get'], companyLookup: ['name'] },
		},
		routing: query('name'),
	},
	{
		displayName: 'Wikidata ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. Q60269744',
		description: 'Wikidata item ID of the company',
		displayOptions: {
			show: { resource: ['company'], operation: ['get'], companyLookup: ['id'] },
		},
		routing: query('id'),
	},
	optionsFor('company', 'get', []),

	// Get SEC Filings
	{
		displayName: 'Look Up By',
		name: 'filingsLookup',
		type: 'options',
		noDataExpression: true,
		default: 'ticker',
		displayOptions: showFor('company', 'getFilings'),
		options: [
			{ name: 'Ticker', value: 'ticker' },
			{ name: 'CIK', value: 'cik' },
		],
	},
	{
		displayName: 'Ticker',
		name: 'ticker',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. AAPL',
		description: 'Stock ticker of a US-listed company',
		displayOptions: {
			show: { resource: ['company'], operation: ['getFilings'], filingsLookup: ['ticker'] },
		},
		routing: query('ticker'),
	},
	{
		displayName: 'CIK',
		name: 'cik',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 320193',
		description: 'SEC Central Index Key of the company',
		displayOptions: {
			show: { resource: ['company'], operation: ['getFilings'], filingsLookup: ['cik'] },
		},
		routing: query('cik'),
	},
	{
		displayName: 'Number of Filings',
		name: 'count',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 50 },
		default: 10,
		description: 'How many filings to return, newest first (1-50)',
		displayOptions: showFor('company', 'getFilings'),
		routing: query('limit'),
	},
	optionsFor('company', 'getFilings', [
		{
			displayName: 'Form Type',
			name: 'form',
			type: 'string',
			default: '',
			placeholder: 'e.g. 10-K',
			description: 'Only this form type, such as 10-K, 10-Q, 8-K or 4. Without it all forms.',
			routing: query('form'),
		},
	]),
];
