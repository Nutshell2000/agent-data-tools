import { NodeConnectionTypes, type INodeType, type INodeTypeDescription } from 'n8n-workflow';
import { documentDescription } from './resources/document';

export class Glyphcall implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Glyphcall Documents',
		name: 'glyphcall',
		icon: {
			light: 'file:../../icons/glyphcall.svg',
			dark: 'file:../../icons/glyphcall.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description:
			'Turn Word, Excel, PowerPoint and PDF files into text or Markdown, or pull named fields such as an invoice number and total out of them as JSON',
		defaults: {
			name: 'Glyphcall Documents',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'glyphcallApi', required: true }],
		requestDefaults: {
			baseURL: 'https://glyphcall.com',
			headers: {
				Accept: 'application/json',
				'User-Agent': 'n8n-nodes-glyphcall',
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
