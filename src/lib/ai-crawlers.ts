// The AI crawlers and AI fetchers that name themselves in the User-Agent, as their operators document them. One table
// with two readers: /useragent/parse (routes/media-text.ts spreads it into its bot list) and the per-day crawler counts
// (lib/beacon.ts). Each row is [pattern, label]; the label up to " (" is the name that is counted. Order matters: the
// first match wins, so a specific token stands before a shorter one that it contains.
// Google-Extended and Applebot-Extended are robots.txt tokens rather than separate user agents; they are listed so a
// request that does carry one is still named. Add a crawler here only from its operator's own documentation.
export const AI_CRAWLERS: [RegExp, string][] = [
  [/gptbot/i, "GPTBot (OpenAI)"],
  [/chatgpt-user/i, "ChatGPT-User"],
  [/oai-searchbot/i, "OAI-SearchBot"],
  [/claude-user/i, "Claude-User (Anthropic)"],
  [/claude-searchbot/i, "Claude-SearchBot (Anthropic)"],
  [/anthropic-ai/i, "anthropic-ai (Anthropic)"],
  [/claudebot|claude-web|anthropic/i, "ClaudeBot (Anthropic)"],
  [/perplexity-user/i, "Perplexity-User"],
  [/perplexitybot/i, "PerplexityBot"],
  [/google-extended/i, "Google-Extended"],
  [/google-cloudvertexbot/i, "Google-CloudVertexBot"],
  [/googleother/i, "GoogleOther"],
  [/applebot-extended/i, "Applebot-Extended"],
  [/bytespider/i, "Bytespider"],
  [/ccbot/i, "CCBot"],
  [/amazonbot/i, "Amazonbot"],
  [/meta-externalagent/i, "Meta-ExternalAgent"],
  [/meta-externalfetcher/i, "Meta-ExternalFetcher"],
  [/facebookbot/i, "FacebookBot (Meta)"],
  [/duckassistbot/i, "DuckAssistBot"],
  [/mistralai-user/i, "MistralAI-User"],
  [/cohere-ai|cohere-training-data-crawler/i, "cohere-ai"],
  [/diffbot/i, "Diffbot"],
  [/youbot/i, "YouBot"],
  [/ai2bot/i, "AI2Bot"],
  [/timpibot/i, "Timpibot"],
  [/imagesiftbot/i, "ImagesiftBot"],
  [/omgilibot|omgili/i, "Omgilibot"],
];

/** The AI crawler a User-Agent names ("GPTBot", "Claude-User"…), or undefined for browsers and every other client. */
export function aiCrawlerName(userAgent: string | undefined): string | undefined {
  if (!userAgent) return undefined;
  return AI_CRAWLERS.find(([pattern]) => pattern.test(userAgent))?.[1].replace(/ \(.*$/, "");
}
