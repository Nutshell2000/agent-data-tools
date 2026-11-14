import { NodeConnectionTypes, type INodeType, type INodeTypeDescription } from 'n8n-workflow';
import { documentDescription } from './resources/document';

export class DocumentExtract implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Document Extract',
		name: 'documentExtract',
		icon: {
			light: 'file:../../icons/documentExtract.svg',
			dark: 'file:../../icons/documentExtract.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description:
			'Turn Word, Excel, PowerPoint and PDF files into text or Markdown, or pull named fields such as an invoice number and total out of them as JSON',
		defaults: {
			name: 'Document Extract',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'documentExtractApi', required: true }],
		requestDefaults: {
			baseURL: 'https://agent-data-tools.revmesh2074.workers.dev',
			headers: {
				Accept: 'application/json',
				'User-Agent': 'n8n-nodes-document-extract',
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
						name: 'Document',
						value: 'document',
						description: 'A Word, Excel, PowerPoint or PDF file',
					},
				],
				default: 'document',
			},
			...documentDescription,
		],
	};
}
