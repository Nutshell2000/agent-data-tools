import type { INodeProperties, INodePropertyRouting } from 'n8n-workflow';

/** Sends the parameter's value as one query parameter of the tool. */
export const query = (property: string): INodePropertyRouting => ({
	send: { type: 'query', property },
});

/** Shows a parameter for one operation of one resource. */
export const showFor = (resource: string, operation: string) => ({
	show: { resource: [resource], operation: [operation] },
});

/**
 * The two inputs every paid tool accepts next to its own: `only` trims the answer to the keys
 * named, `sample=1` returns the tool's static documented example and is not charged.
 */
export const commonOptions: INodeProperties[] = [
	{
		displayName: 'Fields to Keep',
		name: 'only',
		type: 'string',
		default: '',
		placeholder: 'e.g. results,count',
		description:
			'Comma-separated top-level keys of the answer to keep. Leave empty to return the whole answer.',
		routing: query('only'),
	},
	{
		displayName: 'Return Sample Only',
		name: 'sample',
		type: 'boolean',
		default: false,
		description:
			'Whether to return the static documented example of this tool instead of a live result. A sample is free and spends no credits.',
		routing: {
			send: {
				type: 'query',
				property: 'sample',
				value: '={{ $value ? "1" : undefined }}',
			},
		},
	},
];

/** The collection of optional inputs of one operation, always ending with the common ones. */
export const optionsFor = (
	resource: string,
	operation: string,
	options: INodeProperties[],
): INodeProperties => ({
	displayName: 'Options',
	name: 'options',
	type: 'collection',
	placeholder: 'Add option',
	default: {},
	displayOptions: showFor(resource, operation),
	options: [...options, ...commonOptions].sort((a, b) =>
		a.displayName.localeCompare(b.displayName),
	),
});
