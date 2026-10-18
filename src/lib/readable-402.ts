// x402 v2 carries the challenge in the PAYMENT-REQUIRED header and leaves the body as {}.
// Agents that fetch a tool with plain HTTP only see the body, so repeat the decoded
// challenge there with a short hint. Official clients read the header first, so this is additive.
import { decodePaymentRequiredHeader } from "@x402/core/http";

export async function readable402(res: Response, origin: string): Promise<Response> {
  const header = res.headers.get("payment-required");
  if (res.status !== 402 || !header || !(res.headers.get("content-type") ?? "").includes("application/json")) return res;
  const text = await res.clone().text();
  if (text.trim() !== "{}") return res;
  let challenge: ReturnType<typeof decodePaymentRequiredHeader>;
  try {
    challenge = decodePaymentRequiredHeader(header);
  } catch {
    return res;
  }
  const body = {
    ...challenge,
    hint: `Paid x402 tool. Retry with a PAYMENT-SIGNATURE header from any x402 client (for example @x402/fetch or AgentCash). Free docs: ${origin}/llms.txt`,
  };
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(body), { status: 402, headers });
}
