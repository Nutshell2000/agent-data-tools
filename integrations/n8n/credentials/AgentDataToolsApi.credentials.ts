import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class AgentDataToolsApi implements ICredentialType {
	name = 'agentDataToolsApi';

	displayName = 'Agent Data Tools API';

	icon: Icon = {
		light: 'file:../icons/agentDataTools.svg',
		dark: 'file:../icons/agentDataTools.dark.svg',
	};

	documentationUrl =
		'https://github.com/Nutshell2000/agent-data-tools/tree/main/integrations/n8n#credentials';

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
				'Prepaid key that starts with adt_. Buy credits by card at https://agent-data-tools.revmesh2074.workers.dev/credits (from $1 for 1,000 credits; 1 credit = $0.001) and the page shows the key.',
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

	// Reads the key's balance: free, spends no credits, answers 401 for an unknown key.
	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://agent-data-tools.revmesh2074.workers.dev',
			url: '/credits/balance',
			method: 'GET',
		},
	};
}
