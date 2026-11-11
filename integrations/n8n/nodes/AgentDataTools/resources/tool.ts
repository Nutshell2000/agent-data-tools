import type {
	IDataObject,
	IExecuteSingleFunctions,
	IHttpRequestOptions,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { query, showFor } from '../shared/fields';

/**
 * A tool path is a path on the service's own host and nothing else: segments of letters, digits,
 * hyphens, underscores and dots, each after one slash. An absolute URL or a protocol-relative one
 * ("//host") would replace the base URL and send the API key to another host, so both are
 * refused before any request is made, as are "." and ".." segments, query strings and fragments.
 */
export const TOOL_PATH = /^(?:\/(?!\.+(?:\/|$))[A-Za-z0-9._-]+)+$/;

/** Query string values as the tools read them: text as is, lists and objects as JSON. */
export function toQuery(input: unknown): IDataObject {
	const parsed: unknown = typeof input === 'string' ? JSON.parse(input.trim() || '{}') : input;
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('must be a JSON object such as {"city": "London"}');
	}
	const qs: IDataObject = {};
	for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
		if (value === null || value === undefined || value === '') continue;
		qs[name] =
			typeof value === 'object' ? JSON.stringify(value) : (value as string | number | boolean);
	}
	return qs;
}

/** Builds the request of "Call any tool" from the path and the JSON parameters. */
export async function callAnyTool(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const path = String(this.getNodeParameter('path', '')).trim();
	if (!TOOL_PATH.test(path)) {
		throw new NodeOperationError(
			this.getNode(),
			'Tool Path must be a path on the service such as /weather or /price/token',
			{
				description:
					'Use "Find a tool" to get the exact path. Full URLs and other hosts are not accepted, so the API key is only ever sent to Agent Data Tools.',
			},
		);
	}
	let qs: IDataObject;
	try {
		qs = toQuery(this.getNodeParameter('parameters', '{}'));
	} catch (error) {
		throw new NodeOperationError(
			this.getNode(),
			`Parameters ${(error as Error).message.startsWith('must be') ? (error as Error).message : 'is not valid JSON'}`,
		);
	}
	return { ...requestOptions, method: 'GET', url: path, qs: { ...requestOptions.qs, ...qs } };
}

export const toolDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['tool'] } },
		options: [
			{
				name: 'Call',
				value: 'call',
				action: 'Call any tool',
				description:
					'Call any of the tools by its path with your own parameters. Costs the price of that tool.',
				routing: {
					send: { preSend: [callAnyTool] },
				},
			},
			{
				name: 'Find',
				value: 'find',
				action: 'Find a tool',
				description:
					'Describe a job in plain words and get the tools that do it, with their path, inputs and price. Free, no API key needed.',
				routing: {
					request: { method: 'GET', url: '/find' },
				},
			},
		],
		default: 'find',
	},

	// Find
	{
		displayName: 'Job',
		name: 'need',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. current gas price on Base',
		description: 'What you want done, in a few plain words (up to 300 characters)',
		displayOptions: showFor('tool', 'find'),
		routing: query('need'),
	},
	{
		displayName: 'Number of Tools',
		name: 'count',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 10 },
		default: 5,
		description: 'How many matching tools to return (1-10)',
		displayOptions: showFor('tool', 'find'),
		routing: query('count'),
	},

	// Call
	{
		displayName: 'Tool Path',
		name: 'path',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. /weather',
		description:
			'Path of the tool, as "Find a tool" or the catalog at https://agent-data-tools.revmesh2074.workers.dev/tools shows it',
		displayOptions: showFor('tool', 'call'),
	},
	{
		displayName: 'Parameters',
		name: 'parameters',
		type: 'json',
		default: '{}',
		placeholder: '{ "city": "London" }',
		description:
			'Inputs of the tool as a JSON object. They are sent as query parameters. Add "sample": 1 for a free static example of the output.',
		displayOptions: showFor('tool', 'call'),
	},
];
