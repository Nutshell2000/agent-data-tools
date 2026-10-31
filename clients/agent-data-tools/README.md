# agent-data-tools

Data tools for AI agents, one HTTP call each: PDF to text, web page to Markdown, web search, news, token prices, OFAC sanctions checks, chain reads on 18 networks, IP geolocation, hosted pages and about 550 more. No dependencies. 25 free calls with no signup, then card credits or USDC per call; failed calls are not charged.

```sh
npx agent-data-tools list pdf
npx agent-data-tools pdf_text url=https://arxiv.org/pdf/1706.03762 pages=2
```

```js
import { AgentDataTools } from "agent-data-tools";

const adt = new AgentDataTools();
const weather = await adt.call("/weather", { city: "London" });
const matches = await adt.tools({ search: "sanctions" });
```

## Give the tools to a model

`openAiTools()` returns OpenAI function-calling definitions; [examples/openai-agent.mjs](examples/openai-agent.mjs) is a complete loop in 30 lines.

```js
const tools = await adt.openAiTools(["extract", "pdf_text", "search"]);
// When the model calls one:
const answer = await adt.call(call.function.name, JSON.parse(call.function.arguments));
```

## Paying

| How | Setup |
|---|---|
| Free calls | None. 25 successful calls per caller; AI media, rendering and search tools are paid only. |
| Card credits | Buy a key from $1 (1,000 credits; most tools cost 10) at [/credits](https://agent-data-tools.revmesh2074.workers.dev/credits), then `new AgentDataTools({ apiKey })` or the `ADT_API_KEY` environment variable. |
| USDC per call (x402) | Pass a fetch that pays HTTP 402, such as `@x402/fetch` around your own wallet: `new AgentDataTools({ fetch: paying })`. Set your spending limits in that wrapper. |

When payment is needed and none is set up, `call()` throws `PaymentRequired` with `priceUsd` and `buyUrl`. Other failures throw `ToolError` with `status` and `body`. The package never reads a wallet key and sends your API key only to the service origin.

## Also

Full catalog and prices: [`/tools`](https://agent-data-tools.revmesh2074.workers.dev/tools), [`/openapi.json`](https://agent-data-tools.revmesh2074.workers.dev/openapi.json). MCP server: `https://agent-data-tools.revmesh2074.workers.dev/mcp`. Terms: [`/terms`](https://agent-data-tools.revmesh2074.workers.dev/terms).
