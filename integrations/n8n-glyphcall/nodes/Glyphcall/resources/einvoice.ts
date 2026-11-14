import type {
	IExecuteSingleFunctions,
	IHttpRequestOptions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { optionsFor, query } from '../shared/fields';

/** The largest e-invoice file the service reads (FILE_INPUT_PATHS in its src/lib/file-input.ts). */
export const MAX_EINVOICE_BYTES = 5 * 1024 * 1024;

const READ_OPERATIONS = ['validate', 'toJson'];
const showWith = (source: string) => ({
	show: { resource: ['einvoice'], operation: READ_OPERATIONS, source: [source] },
});

/**
 * Validate and Convert to JSON take the e-invoice three ways. A file from an earlier node is sent
 * as the request body; XML text is sent as JSON so it never travels in the URL; a public URL stays
 * the plain GET the operation is declared as.
 */
export async function sendEinvoice(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const source = this.getNodeParameter('source', 'file');
	if (source === 'url') return requestOptions;
	const qs = { ...requestOptions.qs };
	delete qs.url;
	if (source === 'xml') {
		const xml = String(qs.xml ?? this.getNodeParameter('xml', '')).trim();
		delete qs.xml;
		if (!xml.startsWith('<')) {
			throw new NodeOperationError(this.getNode(), 'The XML field does not hold XML', {
				description:
					'Put the text of the e-invoice (it starts with <?xml or with the root element) in "XML", or switch "E-Invoice Source" to a file or a URL.',
			});
		}
		return { ...requestOptions, method: 'POST', qs, body: { xml }, json: true };
	}
	delete qs.xml;
	const field = String(this.getNodeParameter('binaryPropertyName', 'data')).trim() || 'data';
	let bytes: Buffer;
	try {
		bytes = await this.helpers.getBinaryDataBuffer(field);
	} catch {
		throw new NodeOperationError(this.getNode(), `No file found in the binary field "${field}"`, {
			description:
				'Connect a node that outputs a file (for example an e-mail trigger with attachments or HTTP Request with a file response) and name its binary field in "Input Binary Field".',
		});
	}
	if (bytes.length > MAX_EINVOICE_BYTES) {
		throw new NodeOperationError(
			this.getNode(),
			`The file is ${Math.ceil(bytes.length / 1024 / 1024)} MB; the largest e-invoice this operation reads is 5 MB`,
		);
	}
	return {
		...requestOptions,
		method: 'POST',
		qs,
		body: bytes,
		json: false,
		headers: { ...requestOptions.headers, 'Content-Type': 'application/octet-stream' },
	};
}

/** Create sends the invoice as a JSON object in the body: an invoice does not fit in a URL. */
export async function sendInvoiceData(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const qs = { ...requestOptions.qs };
	const raw: unknown = qs.invoice ?? this.getNodeParameter('invoice', '');
	delete qs.invoice;
	const format = qs.format;
	delete qs.format;
	let invoice: unknown = raw;
	if (typeof raw === 'string') {
		try {
			invoice = JSON.parse(raw);
		} catch {
			throw new NodeOperationError(this.getNode(), 'The invoice is not valid JSON', {
				description:
					'Give the invoice as a JSON object with number, issueDate, seller, buyer and lines. See the node README for an example.',
			});
		}
	}
	if (!invoice || typeof invoice !== 'object' || Array.isArray(invoice)) {
		throw new NodeOperationError(this.getNode(), 'The invoice must be a JSON object', {
			description: 'Expected an object with number, issueDate, seller, buyer and lines.',
		});
	}
	return {
		...requestOptions,
		method: 'POST',
		qs,
		body: { invoice, ...(format ? { format } : {}) },
		json: true,
	};
}

/** Puts the created XML into a binary field as well, ready to attach to an e-mail or save as a file. */
export async function attachXml(
	this: IExecuteSingleFunctions,
	items: INodeExecutionData[],
): Promise<INodeExecutionData[]> {
	const field = String(this.getNodeParameter('outputBinaryPropertyName', 'data')).trim();
	if (!field) return items;
	for (const item of items) {
		const xml = item.json?.xml;
		const pdf = item.json?.pdfBase64;
		const name = typeof item.json?.filename === 'string' ? item.json.filename : undefined;
		if (typeof pdf === 'string' && pdf.length > 0) {
			// The ZUGFeRD / Factur-X PDF: the file goes to the binary field and its base64 leaves the JSON.
			item.binary = {
				...item.binary,
				[field]: await this.helpers.prepareBinaryData(
					Buffer.from(pdf, 'base64'),
					name ?? 'invoice.pdf',
					'application/pdf',
				),
			};
			delete item.json.pdfBase64;
			continue;
		}
		if (typeof xml !== 'string' || !xml.startsWith('<')) continue;
		item.binary = {
			...item.binary,
			[field]: await this.helpers.prepareBinaryData(
				Buffer.from(xml, 'utf8'),
				name ?? 'invoice.xml',
				'application/xml',
			),
		};
	}
	return items;
}

export const einvoiceDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['einvoice'] } },
		options: [
			{
				name: 'Convert to JSON',
				value: 'toJson',
				action: 'Read an electronic invoice as data',
				description:
					'An XRechnung, ZUGFeRD, Factur-X or other EN 16931 e-invoice as JSON: seller and buyer, every line, the VAT breakdown, totals and the bank account. Takes the XML, or the PDF with the XML inside. Exact values from the file, no AI.',
				routing: {
					request: { method: 'GET', url: '/einvoice/to-json' },
					send: { preSend: [sendEinvoice] },
				},
			},
			{
				name: 'Create',
				value: 'create',
				action: 'Create an electronic invoice',
				description:
					'XRechnung XML or a ZUGFeRD / Factur-X PDF from invoice data as JSON. Line totals, the VAT breakdown and the totals are computed and checked against the business rules first; data that breaks a rule is refused with the rule numbers.',
				routing: {
					request: { method: 'GET', url: '/einvoice/create' },
					send: { preSend: [sendInvoiceData] },
					output: { postReceive: [attachXml] },
				},
			},
			{
				name: 'Validate',
				value: 'validate',
				action: 'Validate an electronic invoice',
				description:
					'Checks an XRechnung, ZUGFeRD, Factur-X or other EN 16931 e-invoice against business rules and returns every broken rule with its number, the field, a plain message and the fix. A subset of the rules, not the official validator.',
				routing: {
					request: { method: 'GET', url: '/einvoice/validate' },
					send: { preSend: [sendEinvoice] },
				},
			},
		],
		default: 'validate',
	},

	// Validate and Convert to JSON
	{
		displayName: 'E-Invoice Source',
		name: 'source',
		type: 'options',
		noDataExpression: true,
		default: 'file',
		description: 'Where the e-invoice comes from',
		displayOptions: { show: { resource: ['einvoice'], operation: READ_OPERATIONS } },
		options: [
			{
				name: 'File From an Earlier Node',
				value: 'file',
				description: 'An XML file, or a ZUGFeRD / Factur-X PDF, in the incoming item, up to 5 MB',
			},
			{ name: 'Public URL', value: 'url', description: 'A file that anyone can download' },
			{ name: 'XML Text', value: 'xml', description: 'The XML as text, for example from an expression' },
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
		placeholder: 'e.g. https://example.com/invoice.xml',
		description: 'Absolute http(s) URL of the public XML or PDF file, up to 5 MB',
		displayOptions: showWith('url'),
		routing: query('url'),
	},
	{
		displayName: 'XML',
		name: 'xml',
		type: 'string',
		typeOptions: { rows: 6 },
		required: true,
		default: '',
		placeholder: 'e.g. <rsm:CrossIndustryInvoice ...>',
		description: 'The e-invoice XML as text (UN/CEFACT CII or UBL)',
		displayOptions: showWith('xml'),
		routing: query('xml'),
	},
	optionsFor('einvoice', 'validate', [
		{
			displayName: 'Rule Set',
			name: 'profile',
			type: 'options',
			default: 'auto',
			description: 'Which rules run',
			options: [
				{
					name: 'Automatic',
					value: 'auto',
					description: 'The German XRechnung rules run when the file names XRechnung',
				},
				{ name: 'EN 16931 Only', value: 'en16931', description: 'The European rules only' },
				{
					name: 'XRechnung',
					value: 'xrechnung',
					description: 'The European rules plus the German XRechnung rules',
				},
			],
			routing: query('profile'),
		},
	]),
	optionsFor('einvoice', 'toJson', []),

	// Create
	{
		displayName: 'Invoice',
		name: 'invoice',
		type: 'json',
		required: true,
		default:
			'{\n  "number": "RE-2026-0042",\n  "issueDate": "2026-11-14",\n  "dueDate": "2026-12-14",\n  "buyerReference": "04011000-12345-06",\n  "seller": { "name": "", "vatId": "", "street": "", "postCode": "", "city": "", "country": "DE", "contactName": "", "phone": "", "email": "" },\n  "buyer": { "name": "", "street": "", "postCode": "", "city": "", "country": "DE" },\n  "lines": [{ "name": "", "quantity": 1, "unit": "C62", "unitPrice": 0, "vatRate": 19 }],\n  "payment": { "iban": "", "terms": "" }\n}',
		description:
			'The invoice as JSON: number, issueDate, dueDate, buyerReference, seller and buyer (name, vatId, street, postCode, city, country, contactName, phone, email), lines (name, quantity, unit, unitPrice, vatRate) and payment (iban, bic, terms). The fields that Extract Fields returns for an invoice (invoice_number, seller_name, line_items...) are read too.',
		displayOptions: { show: { resource: ['einvoice'], operation: ['create'] } },
		routing: query('invoice'),
	},
	{
		displayName: 'Format',
		name: 'format',
		type: 'options',
		default: 'xrechnung',
		description: 'The e-invoice format to write',
		displayOptions: { show: { resource: ['einvoice'], operation: ['create'] } },
		options: [
			{
				name: 'EN 16931 (UBL)',
				value: 'ubl',
				description: 'A plain EN 16931 invoice in UBL syntax',
			},
			{
				name: 'XRechnung (CII)',
				value: 'xrechnung',
				description: 'XRechnung 3.0 in UN/CEFACT CII syntax',
			},
			{
				name: 'XRechnung (UBL)',
				value: 'xrechnung-ubl',
				description: 'XRechnung 3.0 in UBL syntax',
			},
			{
				name: 'ZUGFeRD / Factur-X PDF',
				value: 'zugferd-pdf',
				description: 'A readable A4 invoice as PDF/A-3 with the XML embedded, in one plain layout',
			},
			{
				name: 'ZUGFeRD / Factur-X XML',
				value: 'zugferd',
				description: 'The factur-x.xml of a ZUGFeRD or Factur-X invoice alone (EN 16931 profile)',
			},
		],
		routing: query('format'),
	},
	{
		displayName: 'Put File in Binary Field',
		name: 'outputBinaryPropertyName',
		type: 'string',
		default: 'data',
		placeholder: 'e.g. data',
		description:
			'Name of the binary field that receives the created file (the XML, or the PDF for the PDF format), ready to attach to an e-mail or to save. Leave empty to return text only.',
		displayOptions: { show: { resource: ['einvoice'], operation: ['create'] } },
	},
	optionsFor('einvoice', 'create', []),
];
