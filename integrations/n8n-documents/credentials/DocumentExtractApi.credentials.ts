import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class DocumentExtractApi implements ICredentialType {
	name = 'documentExtractApi';

	displayName = 'Document Extract API';

	icon: Icon = {
		light: 'file:../icons/documentExtract.svg',
		dark: 'file:../icons/documentExtract.dark.svg',
	};

	documentationUrl =
		'https://github.com/Nutshell2000/agent-data-tools/tree/main/integrations/n8n-documents#credentials';

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
				'Key that starts with adt_. Get one at https://agent-data-tools.revmesh2074.workers.dev/credits and the page shows the key.',
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
			baseURL: 'https://agent-data-tools.revmesh2074.workers.dev',
			url: '/credits/balance',
			method: 'GET',
		},
	};
}
