import type { INodeProperties } from 'n8n-workflow';
import { optionsFor, query, showFor } from '../shared/fields';

export const githubRepositoryDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['githubRepository'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				action: 'Get repository data',
				description:
					'Stars, forks, open issues, languages, topics, license, dates and the latest release of a public repository',
				routing: { request: { method: 'GET', url: '/github/repo' } },
			},
		],
		default: 'get',
	},
	{
		displayName: 'Repository',
		name: 'repo',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. vercel/next.js',
		description: 'Repository as owner/name, or its github.com URL. Public repositories only.',
		displayOptions: showFor('githubRepository', 'get'),
		routing: query('repo'),
	},
	optionsFor('githubRepository', 'get', []),
];

export const vulnerabilityDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['vulnerability'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				action: 'Look up a CVE',
				description:
					'CVSS score and severity, known exploitation (CISA KEV), EPSS probability, weakness, affected products with fixed versions and advisory links',
				routing: { request: { method: 'GET', url: '/cve' } },
			},
		],
		default: 'get',
	},
	{
		displayName: 'CVE ID',
		name: 'cve',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. CVE-2021-44228',
		description: 'CVE ID in any case. A cve.org or nvd.nist.gov link works too.',
		displayOptions: showFor('vulnerability', 'get'),
		routing: query('cve'),
	},
	optionsFor('vulnerability', 'get', []),
];
