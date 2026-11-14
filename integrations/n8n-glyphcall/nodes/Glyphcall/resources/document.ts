import type { IExecuteSingleFunctions, IHttpRequestOptions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { optionsFor, query } from '../shared/fields';

/** The largest file the document tools read (FILE_INPUT_PATHS in the service's src/lib/file-input.ts). */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const OPERATIONS = ['convertToText', 'extractFields', 'extractText'];
const showWith = (source: string, operations = OPERATIONS) => ({
	show: { resource: ['document'], operation: operations, source: [source] },
});

/**
 * A document operation with a file from an earlier node (an e-mail attachment, a download, a form
 * upload): the file's bytes are sent as the request body. With a URL the request stays the plain
 * GET it is declared as. The service tells the kind of file from its bytes, so the content type
 * sent here only has to say "a file".
 */
export async function sendFile(
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
	if (bytes.length > MAX_FILE_BYTES) {
		throw new NodeOperationError(
			this.getNode(),
			`The file is ${Math.ceil(bytes.length / 1024 / 1024)} MB; the largest file this operation reads is 10 MB`,
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
		headers: { ...requestOptions.headers, 'Content-Type': 'application/octet-stream' },
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
				name: 'Convert to Text',
				value: 'convertToText',
				action: 'Convert a document to text or markdown',
				description:
					'A Word (.docx), Excel (.xlsx), PowerPoint (.pptx) or PDF file as Markdown or plain text: headings, lists and tables of a Word file, each sheet of a workbook as a table, a deck slide by slide. Takes a file from an earlier node or a public URL.',
				routing: {
					request: { method: 'GET', url: '/document/text' },
					send: { preSend: [sendFile] },
				},
			},
			{
				name: 'Extract Fields',
				value: 'extractFields',
				action: 'Extract fields from a document',
				description:
					'Named fields of a PDF, Word, Excel or PowerPoint file as JSON, for example the invoice number, total and due date of an invoice. An AI model reads the file; a field the file does not state comes back empty.',
				routing: {
					request: { method: 'GET', url: '/document/extract' },
					send: { preSend: [sendFile] },
				},
			},
			{
				name: 'Extract Text From PDF',
				value: 'extractText',
				action: 'Extract text from a PDF',
				description:
					'The text of a PDF, page by page, with page count, title and author. Takes a file from an earlier node or a public URL. Scanned PDFs without a text layer are refused and not charged.',
				routing: {
					request: { method: 'GET', url: '/pdf/text' },
					send: { preSend: [sendFile] },
				},
			},
		],
		default: 'convertToText',
	},
	{
		displayName: 'File Source',
		name: 'source',
		type: 'options',
		noDataExpression: true,
		default: 'file',
		description: 'Where the file comes from',
		displayOptions: { show: { resource: ['document'], operation: OPERATIONS } },
		options: [
			{
				name: 'File From an Earlier Node',
				value: 'file',
				description: 'A binary file in the incoming item, up to 10 MB',
			},
			{ name: 'Public URL', value: 'url', description: 'A file that anyone can download' },
		],
	},
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		required: true,
		default: 'data',
		placeholder: 'e.g. data',
		hint: 'The name of the binary field that holds the file',
		displayOptions: showWith('file'),
	},
	{
		displayName: 'URL',
		name: 'url',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. https://example.com/report.docx',
		description: 'Absolute http(s) URL of the public file, up to 10 MB',
		displayOptions: showWith('url'),
		routing: query('url'),
	},

	// Convert to Text
	{
		displayName: 'Format',
		name: 'format',
		type: 'options',
		default: 'markdown',
		description: 'How the text is returned',
		displayOptions: { show: { resource: ['document'], operation: ['convertToText'] } },
		options: [
			{
				name: 'Markdown',
				value: 'markdown',
				description: 'Headings, lists and tables are kept',
			},
			{ name: 'Text', value: 'text', description: 'Plain text; table cells separated by tabs' },
		],
		routing: query('format'),
	},
	optionsFor('document', 'convertToText', [
		{
			displayName: 'Max Characters',
			name: 'maxChars',
			type: 'number',
			typeOptions: { minValue: 1000, maxValue: 200000 },
			default: 50000,
			description: 'Maximum characters of text returned (1000-200000)',
			routing: query('maxChars'),
		},
	]),

	// Extract Fields
	{
		displayName: 'Fields',
		name: 'fields',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. invoice_number, due_date, total, line_items[description,quantity,amount]',
		description:
			'Comma-separated names of the fields to extract (1-30). For rows such as invoice lines, give the row keys in brackets: line_items[description,quantity,unit_price,amount].',
		displayOptions: { show: { resource: ['document'], operation: ['extractFields'] } },
		routing: query('fields'),
	},
	optionsFor('document', 'extractFields', []),

	// Extract Text From PDF
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
