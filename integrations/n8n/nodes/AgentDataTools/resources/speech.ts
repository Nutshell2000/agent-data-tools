import type {
	IDataObject,
	IExecuteSingleFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { optionsFor, query, showFor } from '../shared/fields';

/**
 * The speech tools answer JSON with the MP3 as base64. With "Put Audio in Binary Field" on, the
 * audio is moved into an n8n binary field so the next node can save, send or play it, and the
 * long base64 text is dropped from the JSON.
 */
export async function audioToBinary(
	this: IExecuteSingleFunctions,
	items: INodeExecutionData[],
): Promise<INodeExecutionData[]> {
	const field = String(this.getNodeParameter('binaryPropertyName', '') ?? '').trim();
	if (!field) return items;
	const out: INodeExecutionData[] = [];
	for (const item of items) {
		const { audioBase64, ...rest } = item.json as IDataObject;
		if (typeof audioBase64 !== 'string' || audioBase64 === '') {
			out.push(item);
			continue;
		}
		const mimeType = typeof rest.contentType === 'string' ? rest.contentType : 'audio/mpeg';
		const binary = await this.helpers.prepareBinaryData(
			Buffer.from(audioBase64, 'base64'),
			'speech.mp3',
			mimeType,
		);
		out.push({ ...item, json: rest, binary: { ...item.binary, [field]: binary } });
	}
	return out;
}

const voices = [
	'amalthea',
	'andromeda',
	'apollo',
	'arcas',
	'aries',
	'asteria',
	'athena',
	'atlas',
	'aurora',
	'callista',
	'cora',
	'cordelia',
	'delia',
	'draco',
	'electra',
	'harmonia',
	'helena',
	'hera',
	'hermes',
	'hyperion',
	'iris',
	'janus',
	'juno',
	'jupiter',
	'luna',
	'mars',
	'minerva',
	'neptune',
	'odysseus',
	'ophelia',
	'orion',
	'orpheus',
	'pandora',
	'phoebe',
	'pluto',
	'saturn',
	'thalia',
	'theia',
	'vesta',
	'zeus',
];
const spanishVoices = [
	'alvaro',
	'aquila',
	'carina',
	'celeste',
	'diana',
	'estrella',
	'javier',
	'nestor',
	'selena',
	'sirio',
];
const title = (name: string) => name[0].toUpperCase() + name.slice(1);

export const speechDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['speech'] } },
		options: [
			{
				name: 'Generate',
				value: 'generate',
				action: 'Convert text to speech',
				description:
					'Turn text into natural speech as an MP3, in English or Spanish: up to 300 characters, or up to 2,000 with Long Text',
				routing: {
					request: {
						method: 'GET',
						url: '={{ $parameter.longText ? "/text-to-speech" : "/ai/speech" }}',
					},
					output: { postReceive: [audioToBinary] },
				},
			},
		],
		default: 'generate',
	},
	{
		displayName: 'Text',
		name: 'text',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		placeholder: 'e.g. Your payment was received. Thank you!',
		description: 'Text to speak: up to 300 characters, or up to 2,000 with Long Text on',
		displayOptions: showFor('speech', 'generate'),
		routing: query('text'),
	},
	{
		displayName: 'Long Text',
		name: 'longText',
		type: 'boolean',
		default: false,
		description:
			'Whether to accept up to 2,000 characters as one MP3. A long text call costs more than a short one: see the price list in the README.',
		displayOptions: showFor('speech', 'generate'),
	},
	{
		displayName: 'Put Audio in Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		description:
			'Name of the binary field that receives the MP3. Leave empty to keep the audio as base64 text in the JSON (audioBase64).',
		displayOptions: showFor('speech', 'generate'),
	},
	optionsFor('speech', 'generate', [
		{
			displayName: 'Language',
			name: 'lang',
			type: 'options',
			default: 'en',
			description: 'Language of the text. Choose a voice of the same language.',
			options: [
				{ name: 'English', value: 'en' },
				{ name: 'Spanish', value: 'es' },
			],
			routing: query('lang'),
		},
		{
			displayName: 'Voice',
			name: 'voice',
			type: 'options',
			default: 'luna',
			description:
				'Voice to speak with. Without it the default voice of the language is used (Luna for English, Aquila for Spanish).',
			options: [
				...voices.map((name) => ({ name: title(name), value: name })),
				...spanishVoices.map((name) => ({ name: `${title(name)} (Spanish)`, value: name })),
			].sort((a, b) => a.name.localeCompare(b.name)),
			routing: query('voice'),
		},
	]),
];
