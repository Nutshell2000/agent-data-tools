import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class GlyphcallApi implements ICredentialType {
	name = 'glyphcallApi';

	displayName = 'Glyphcall API';

	icon: Icon = {
		light: 'file:../icons/glyphcall.svg',
		dark: 'file:../icons/glyphcall.dark.svg',
	};

	documentationUrl =
		'https://github.com/Nutshell2000/agent-data-tools/tree/main/integrations/n8n-glyphcall#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			placeholder: 'adt_...',
			description:
				'Key that starts with adt_. Get one at https://glyphcall.com/credits and the page shows the key.',
		},
	];

	// The key travels in the Authorization header only, never in the URL.
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	// Reads the key's balance: free, spends nothing, answers 401 for an unknown key.
	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://glyphcall.com',
			url: '/credits/balance',
			method: 'GET',
		},
	};
}
