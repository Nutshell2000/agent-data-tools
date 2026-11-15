import {
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IExecuteSingleFunctions,
	type IHttpRequestOptions,
	type IN8nHttpFullResponse,
	type INodeExecutionData,
	type INodeProperties,
	type INodeType,
	type INodeTypeDescription,
} from 'n8n-workflow';
import { optionsFor, query } from '../Glyphcall/shared/fields';

/** The largest recording the transcription tools read: 25 MB (MP3/WAV up to 60 minutes). */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

const AUDIO_OPERATIONS = ['transcribe', 'summarize'];
const showWith = (source: string) => ({
	show: { resource: ['audio'], operation: AUDIO_OPERATIONS, source: [source] },
});

/**
 * A recording from an earlier node (an e-mail attachment, a form upload, a Drive download) goes as the
 * raw request body; with a URL the request stays the GET it is declared as.
 */
export async function sendAudio(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	if (this.getNodeParameter('source', 'url') !== 'file') return requestOptions;
	const field = String(this.getNodeParameter('binaryPropertyName', 'data')).trim() || 'data';
	let bytes: Buffer;
	try {
		bytes = await this.helpers.getBinaryDataBuffer(field);
	} catch {
		throw new NodeOperationError(this.getNode(), `No recording found in the binary field "${field}"`, {
			description:
				'Connect a node that outputs an audio or video file (for example an e-mail trigger with attachments, a form, Google Drive or HTTP Request) and name its binary field in "Input Binary Field".',
		});
	}
	if (bytes.length > MAX_AUDIO_BYTES) {
		throw new NodeOperationError(
			this.getNode(),
			`The recording is ${Math.ceil(bytes.length / 1024 / 1024)} MB; the largest recording these operations read is 25 MB`,
			{ description: 'Convert it to MP3 first (about 1 MB per minute at 128 kbps), or pass a public URL.' },
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

/** Turns the answer's base64 MP3 into a binary file on the item, keeping the other fields as JSON. */
export async function audioToBinary(
	this: IExecuteSingleFunctions,
	items: INodeExecutionData[],
	response: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
	const body = (typeof response.body === 'string' ? JSON.parse(response.body) : response.body) as IDataObject;
	const b64 = typeof body?.audioBase64 === 'string' ? body.audioBase64 : '';
	if (!b64) return items;
	const field = String(this.getNodeParameter('outputBinaryField', 'data')).trim() || 'data';
	const json: IDataObject = { ...body };
	delete json.audioBase64;
	const contentType = typeof body.contentType === 'string' ? body.contentType : 'audio/mpeg';
	const binary = await this.helpers.prepareBinaryData(Buffer.from(b64, 'base64'), 'speech.mp3', contentType);
	return [{ json, binary: { [field]: binary } }];
}

const LANGUAGE: INodeProperties = {
	displayName: 'Language',
	name: 'language',
	type: 'string',
	default: '',
	placeholder: 'e.g. en, sv, de',
	description: 'Spoken language code. Leave empty to detect it.',
	routing: query('language'),
};

const properties: INodeProperties[] = [
	{
		displayName: 'Resource',
		name: 'resource',
		type: 'options',
		noDataExpression: true,
		options: [
			{ name: 'Audio', value: 'audio', description: 'A recording: voice note, meeting, podcast, interview' },
			{ name: 'Speech', value: 'speech', description: 'Spoken audio made from text' },
		],
		default: 'audio',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['audio'] } },
		options: [
			{
				name: 'Transcribe',
				value: 'transcribe',
				action: 'Transcribe a recording to text',
				description:
					'Speech to text (Whisper) for up to 60 minutes of MP3 or WAV in one call, with SRT or VTT subtitles and timed segments if you want them. About five cents a call.',
				routing: {
					request: { method: 'GET', url: '/transcribe/long' },
					send: { preSend: [sendAudio] },
				},
			},
			{
				name: 'Summarize',
				value: 'summarize',
				action: 'Summarize a recording',
				description:
					'A meeting or voice note to a title, short summary, key points and action items (with owner and due date when said), plus the transcript. Five cents a call.',
				routing: {
					request: { method: 'GET', url: '/transcribe/summary' },
					send: { preSend: [sendAudio] },
				},
			},
		],
		default: 'transcribe',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['speech'] } },
		options: [
			{
				name: 'Text to Speech',
				value: 'speak',
				action: 'Turn text into speech',
				description:
					'Up to 2,000 characters as one MP3 in a natural voice (Deepgram Aura-2), English or Spanish. The MP3 comes out as a binary file.',
				routing: {
					request: { method: 'GET', url: '/text-to-speech' },
					output: { postReceive: [audioToBinary] },
				},
			},
			{
				name: 'Text to Speech (Lite)',
				value: 'speakLite',
				action: 'Turn text into speech cheaply',
				description:
					'Up to 2,000 characters of English as one MP3, at half the price of Text to Speech. The MP3 comes out as a binary file.',
				routing: {
					request: { method: 'GET', url: '/text-to-speech/lite' },
					output: { postReceive: [audioToBinary] },
				},
			},
		],
		default: 'speak',
	},

	// Audio input
	{
		displayName: 'File Source',
		name: 'source',
		type: 'options',
		noDataExpression: true,
		default: 'file',
		description: 'Where the recording comes from',
		displayOptions: { show: { resource: ['audio'], operation: AUDIO_OPERATIONS } },
		options: [
			{ name: 'File From an Earlier Node', value: 'file', description: 'A binary file in the incoming item, up to 25 MB' },
			{ name: 'Public URL', value: 'url', description: 'A recording that anyone can download' },
		],
	},
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		required: true,
		default: 'data',
		placeholder: 'e.g. data',
		hint: 'The name of the binary field that holds the recording',
		displayOptions: showWith('file'),
	},
	{
		displayName: 'URL',
		name: 'url',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. https://example.com/episode.mp3',
		description: 'Absolute http(s) URL of the recording (MP3 or WAV up to 25 MB and 60 minutes)',
		displayOptions: showWith('url'),
		routing: query('url'),
	},
	optionsFor('audio', 'transcribe', [
		LANGUAGE,
		{
			displayName: 'Subtitles',
			name: 'subtitles',
			type: 'options',
			default: '',
			options: [
				{ name: 'None', value: '' },
				{ name: 'SRT', value: 'srt' },
				{ name: 'WebVTT', value: 'vtt' },
			],
			description: 'Whether to also return subtitle text for the whole recording',
			routing: { send: { type: 'query', property: 'subtitles', value: '={{ $value || undefined }}' } },
		},
		{
			displayName: 'Timestamps',
			name: 'timestamps',
			type: 'boolean',
			default: false,
			description: 'Whether to also return timed segments and words',
			routing: { send: { type: 'query', property: 'timestamps', value: '={{ $value ? "true" : undefined }}' } },
		},
	]),
	optionsFor('audio', 'summarize', [
		LANGUAGE,
		{
			displayName: 'Include Transcript',
			name: 'transcript',
			type: 'boolean',
			default: true,
			description: 'Whether to include the full transcript in the answer',
			routing: { send: { type: 'query', property: 'transcript', value: '={{ $value ? undefined : "false" }}' } },
		},
	]),

	// Speech
	{
		displayName: 'Text',
		name: 'text',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		description: 'The text to speak, up to 2,000 characters',
		displayOptions: { show: { resource: ['speech'] } },
		routing: query('text'),
	},
	{
		displayName: 'Put Output File in Field',
		name: 'outputBinaryField',
		type: 'string',
		required: true,
		default: 'data',
		hint: 'The name of the binary field the MP3 is written to',
		displayOptions: { show: { resource: ['speech'] } },
	},
	optionsFor('speech', 'speak', [
		{
			displayName: 'Language',
			name: 'lang',
			type: 'options',
			default: 'en',
			options: [
				{ name: 'English', value: 'en' },
				{ name: 'Spanish', value: 'es' },
			],
			routing: query('lang'),
		},
		{
			displayName: 'Voice',
			name: 'voice',
			type: 'string',
			default: '',
			placeholder: 'e.g. thalia, apollo, luna',
			description: 'Voice name; leave empty for the default voice of the language',
			routing: query('voice'),
		},
	]),
	optionsFor('speech', 'speakLite', [
		{
			displayName: 'Voice',
			name: 'voice',
			type: 'options',
			default: 'luna',
			options: ['angus', 'arcas', 'asteria', 'athena', 'helios', 'hera', 'luna', 'orion', 'orpheus', 'perseus', 'stella', 'zeus'].map(
				(v) => ({ name: v[0].toUpperCase() + v.slice(1), value: v }),
			),
			routing: query('voice'),
		},
	]),
];

export class GlyphcallVoice implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Glyphcall Voice',
		name: 'glyphcallVoice',
		icon: {
			light: 'file:../../icons/glyphcall.svg',
			dark: 'file:../../icons/glyphcall.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description:
			'Transcribe recordings to text and subtitles, summarize meetings into action items, and turn text into natural speech (MP3)',
		defaults: { name: 'Glyphcall Voice' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'glyphcallApi', required: true }],
		requestDefaults: {
			baseURL: 'https://glyphcall.com',
			headers: { Accept: 'application/json', 'User-Agent': 'n8n-nodes-glyphcall' },
		},
		properties,
	};
}
