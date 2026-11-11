import type { INodeProperties } from 'n8n-workflow';
import { optionsFor, query, showFor } from '../shared/fields';

const freshness = (description: string): INodeProperties => ({
	displayName: 'Freshness',
	name: 'freshness',
	type: 'options',
	default: 'week',
	description,
	options: [
		{ name: 'Past Day', value: 'day' },
		{ name: 'Past Week', value: 'week' },
		{ name: 'Past Month', value: 'month' },
	],
	routing: query('freshness'),
});

export const newsDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['news'] } },
		options: [
			{
				name: 'Get Sentiment',
				value: 'getSentiment',
				action: 'Get news sentiment on a topic',
				description:
					'Latest headlines on a topic, each with a positive or negative score, and the balance across them',
				routing: { request: { method: 'GET', url: '/pack/news-sentiment' } },
			},
			{
				name: 'Search',
				value: 'search',
				action: 'Search news headlines',
				description:
					'Current news articles on any topic: title, URL, snippet, publisher and age',
				routing: { request: { method: 'GET', url: '/news' } },
			},
		],
		default: 'search',
	},

	// Search
	{
		displayName: 'Topic',
		name: 'q',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. bitcoin ETF',
		description: 'News search query, at most 400 characters',
		displayOptions: showFor('news', 'search'),
		routing: query('q'),
	},
	{
		displayName: 'Number of Articles',
		name: 'count',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 20 },
		default: 10,
		description: 'How many articles to return (1-20)',
		displayOptions: showFor('news', 'search'),
		routing: query('count'),
	},
	optionsFor('news', 'search', [
		freshness('Only articles from this period. Without it articles of any age are returned.'),
	]),

	// Get Sentiment
	{
		displayName: 'Topic',
		name: 'q',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. bitcoin',
		description: 'News topic, at most 400 characters',
		displayOptions: showFor('news', 'getSentiment'),
		routing: query('q'),
	},
	{
		displayName: 'Number of Articles',
		name: 'count',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 10 },
		default: 5,
		description: 'How many articles to score (1-10)',
		displayOptions: showFor('news', 'getSentiment'),
		routing: query('count'),
	},
	optionsFor('news', 'getSentiment', [
		freshness('Only articles from this period. Without it the past week is used.'),
	]),
];
