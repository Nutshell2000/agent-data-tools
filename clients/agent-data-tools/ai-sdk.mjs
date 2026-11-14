// Agent Data Tools as Vercel AI SDK tools: `import { agentDataTools } from "agent-data-tools/ai-sdk"`.
// `ai` is a peer dependency of this entry point only; the rest of the package has no dependencies.
import { tool, jsonSchema } from "ai";
import { AgentDataTools } from "./index.mjs";

/**
 * The named tools as AI SDK tools, ready for `generateText({ tools })`.
 * @param {string[]} names Tool names (`weather`, `pdf_text`) or paths (`/weather`). Name the few a task needs: the catalog
 *   holds several hundred and a model works best with a handful.
 * @param {object} [options] `apiKey` (prepaid key from /credits; default the ADT_API_KEY environment variable), `fetch`
 *   (a fetch that pays HTTP 402, such as @x402/fetch around your wallet), `origin`, or `client` (an AgentDataTools you made).
 *   Without a key or a paying fetch, calls use the free calls.
 * @returns {Promise<Record<string, import("ai").Tool>>}
 */
export async function agentDataTools(names, options = {}) {
  if (!Array.isArray(names) || !names.length) throw new TypeError("agentDataTools(names): pass the tool names to load, for example ['weather', 'pdf_text']");
  const client = options.client ?? new AgentDataTools(options);
  const definitions = await client.openAiTools(names);
  return Object.fromEntries(definitions.map(({ function: f }) => [f.name, tool({
    description: f.description,
    inputSchema: jsonSchema(f.parameters),
    // A failed or unpaid call is returned to the model as text it can act on, not thrown: one bad tool call should not
    // end the whole generation.
    execute: async (input) => {
      try {
        return await client.call(f.name, input ?? {});
      } catch (e) {
        return { error: e?.message ?? String(e), ...(e?.priceUsd !== undefined ? { priceUsd: e.priceUsd, buyUrl: e.buyUrl } : {}) };
      }
    },
  })]));
}

export { AgentDataTools };
