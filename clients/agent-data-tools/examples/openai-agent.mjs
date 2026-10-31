// A minimal agent: any OpenAI-compatible chat API plus Agent Data Tools. Needs OPENAI_API_KEY (and optionally OPENAI_BASE_URL, OPENAI_MODEL).
//   node examples/openai-agent.mjs "What does the first page of https://arxiv.org/pdf/1706.03762 say?"
import { AgentDataTools } from "agent-data-tools";

const adt = new AgentDataTools();
const tools = await adt.openAiTools(["extract", "pdf_text", "weather", "price_token"]);
const messages = [{ role: "user", content: process.argv[2] ?? "What is the weather in Stockholm?" }];

for (let turn = 0; turn < 6; turn++) {
  const res = await fetch(`${process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL ?? "gpt-4o-mini", messages, tools }),
  });
  const message = (await res.json()).choices[0].message;
  messages.push(message);
  if (!message.tool_calls?.length) { console.log(message.content); break; }
  for (const call of message.tool_calls) {
    const result = await adt.call(call.function.name, JSON.parse(call.function.arguments)).catch((e) => ({ error: e.message }));
    messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 20000) });
  }
}
