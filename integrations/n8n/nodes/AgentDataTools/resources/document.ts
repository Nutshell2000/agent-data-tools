import type { IExecuteSingleFunctions, IHttpRequestOptions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { optionsFor, query, showFor } from '../shared/fields';

/** The largest PDF the tool reads (FILE_INPUT_PATHS in the service's src/lib/file-input.ts). */
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

/**
 * "Extract Text From PDF" with a file from an earlier node (an e-mail attachment, a download, a
 * form upload): the file's bytes are sent as the request body. With a URL the request stays the
 * plain GET it is declared as.
 */
export async function sendPdfFile(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	if (this.getNodeParameter('source', 'url') !== 'file') return requestOptions;
	const field = String(this.getNodeParameter('binaryPropertyName', 'data')).trim() || 'data';
	let bytes: Buffer;
	try {
		bytes = await this.helpers.getBinaryDataBuffer(field);
	} catch {
		throw new NodeOperationError(this.getNode(), `No file found in the binary field "${field}"`, {
			description:
				'Connect a node that outputs a file (for example an e-mail trigger with attachments, HTTP Request with a file response, or Read Binary File) and name its binary field in "Input Binary Field".',
		});
	}
	if (bytes.length > MAX_PDF_BYTES) {
		throw new NodeOperationError(
			this.getNode(),
			`The file is ${Math.ceil(bytes.length / 1024 / 1024)} MB; the largest PDF this operation reads is 10 MB`,
		);
	}
	const qs = { ...requestOptions.qs };
	delete qs.url;
	return {
		...requestOptions,
		method: 'POST',
		qs,
		body: bytes,
		json: false,
		headers: { ...requestOptions.headers, 'Content-Type': 'application/pdf' },
	};
}

export const documentDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['document'] } },
		options: [
			{
				name: 'Extract Text From PDF',
				value: 'extractText',
				action: 'Extract text from a PDF',
				description:
					'The text of a PDF, page by page, with page count, title and author. Takes a file from an earlier node or a public URL. Scanned PDFs without a text layer are refused and not charged.',
				routing: {
					request: { method: 'GET', url: '/pdf/text' },
					send: { preSend: [sendPdfFile] },
				},
			},
		],
		default: 'extractText',
	},
	{
		displayName: 'PDF Source',
		name: 'source',
		type: 'options',
		noDataExpression: true,
		default: 'file',
		description: 'Where the PDF comes from',
		displayOptions: showFor('document', 'extractText'),
		options: [
			{
				name: 'File From an Earlier Node',
				value: 'file',
				description: 'A binary file in the incoming item, up to 10 MB',
			},
			{ name: 'Public URL', value: 'url', description: 'A PDF that anyone can download' },
		],
	},
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		required: true,
		default: 'data',
		placeholder: 'e.g. data',
		hint: 'The name of the binary field that holds the PDF',
		displayOptions: {
			show: { resource: ['document'], operation: ['extractText'], source: ['file'] },
		},
	},
	{
		displayName: 'URL',
		name: 'url',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. https://example.com/report.pdf',
		description: 'Absolute http(s) URL of the public PDF, up to 10 MB',
		displayOptions: {
			show: { resource: ['document'], operation: ['extractText'], source: ['url'] },
		},
		routing: query('url'),
	},
	optionsFor('document', 'extractText', [
		{
			displayName: 'First Page',
			name: 'firstPage',
			type: 'number',
			typeOptions: { minValue: 1 },
			default: 1,
			description: 'The first page to read',
			routing: query('firstPage'),
		},
		{
			displayName: 'Max Characters',
			name: 'maxChars',
			type: 'number',
			typeOptions: { minValue: 1000, maxValue: 200000 },
			default: 50000,
			description: 'Maximum characters of text returned across all pages (1000-200000)',
			routing: query('maxChars'),
		},
		{
			displayName: 'Pages',
			name: 'pages',
			type: 'number',
			typeOptions: { minValue: 1, maxValue: 200 },
			default: 20,
			description: 'How many pages to read (1-200)',
			routing: query('pages'),
		},
	]),
];
