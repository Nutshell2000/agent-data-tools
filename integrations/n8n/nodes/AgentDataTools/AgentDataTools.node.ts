import { NodeConnectionTypes, type INodeType, type INodeTypeDescription } from 'n8n-workflow';
import { companyDescription } from './resources/company';
import { cryptoDescription } from './resources/crypto';
import { documentDescription } from './resources/document';
import { githubRepositoryDescription, vulnerabilityDescription } from './resources/developer';
import { newsDescription } from './resources/news';
import { screeningDescription } from './resources/screening';
import { speechDescription } from './resources/speech';
import { toolDescription } from './resources/tool';
import { webDescription } from './resources/web';

export class AgentDataTools implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Agent Data Tools',
		name: 'agentDataTools',
		icon: {
			light: 'file:../../icons/agentDataTools.svg',
			dark: 'file:../../icons/agentDataTools.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Documents to text (Word, Excel, PowerPoint, PDF), web search, page text, news, GitHub, CVE, company, crypto, speech and sanctions tools, paid per call with one prepaid key',
		defaults: {
			name: 'Agent Data Tools',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'agentDataToolsApi',
				// "Find a tool" is free and is sent without a key, so the credential is hidden there.
				// n8n refuses to run an operation whose required credential is hidden, hence not
				// required: a paid operation without a key gets the service's 402 answer, which says
				// where to buy one.
				required: false,
				// Shown for every operation except "find", a value only the Tool resource has.
				// (A `hide` rule with resource and operation would hide it for either match, and so
				// for "Call any tool" as well.) A test keeps this list complete.
				displayOptions: {
					show: {
						operation: [
							'audit',
							'call',
							'checkInvoice',
							'checkPayee',
							'checkSanctions',
							'convertToText',
							'extractFields',
							'extractText',
							'generate',
							'get',
							'getFilings',
							'getIndicators',
							'getPrice',
							'getSentiment',
							'readPage',
							'search',
						],
					},
				},
			},
		],
		requestDefaults: {
			baseURL: 'https://agent-data-tools.revmesh2074.workers.dev',
			headers: {
				Accept: 'application/json',
				'User-Agent': 'n8n-nodes-agent-data-tools',
			},
		},
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Company',
						value: 'company',
						description: 'Company profiles and SEC filings',
					},
					{
						name: 'Crypto',
						value: 'crypto',
						description: 'Token prices and technical indicators',
					},
					{
						name: 'Document',
						value: 'document',
						description: 'Word, Excel, PowerPoint and PDF files as text, Markdown or named fields',
					},
					{
						name: 'GitHub Repository',
						value: 'githubRepository',
						description: 'Facts about a public repository',
					},
					{
						name: 'News',
						value: 'news',
						description: 'News headlines and their sentiment',
					},
					{
						name: 'Screening',
						value: 'screening',
						description: 'OFAC sanctions and payee checks',
					},
					{
						name: 'Speech',
						value: 'speech',
						description: 'Text to speech',
					},
					{
						name: 'Tool',
						value: 'tool',
						description: 'Find the right tool for a job, or call any tool by its path',
					},
					{
						name: 'Vulnerability',
						value: 'vulnerability',
						description: 'CVE lookup',
					},
					{
						name: 'Web',
						value: 'web',
						description: 'Web search, page reading and website audits',
					},
				],
				default: 'tool',
			},
			...companyDescription,
			...cryptoDescription,
			...documentDescription,
			...githubRepositoryDescription,
			...newsDescription,
			...screeningDescription,
			...speechDescription,
			...toolDescription,
			...vulnerabilityDescription,
			...webDescription,
		],
	};
}
