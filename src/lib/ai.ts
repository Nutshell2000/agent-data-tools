import { HttpError, type Env } from "./env";

export const MODELS = {
  image: "@cf/black-forest-labs/flux-1-schnell",
  text: "@cf/meta/llama-3.1-8b-instruct-fp8",
  vision: "@cf/meta/llama-4-scout-17b-16e-instruct",
  speech: "@cf/openai/whisper-large-v3-turbo",
} as const;

/**
 * Runs a Workers AI model. The account's free daily allowance is the only budget,
 * so running out is reported as 503 and the caller is not charged.
 */
export async function runAi<T>(env: Env, model: string, input: Record<string, unknown>): Promise<T> {
  try {
    return (await env.AI.run(model as Parameters<Ai["run"]>[0], input as never)) as T;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`workers-ai ${model}: ${message}`);
    if (/4006|daily free allocation|neurons|capacity|rate limit|429/i.test(message)) {
      throw new HttpError(503, "today's free AI capacity is used up; try again after 00:00 UTC");
    }
    if (/nsfw|safety|flagged|3030/i.test(message)) throw new HttpError(422, "the model refused this input");
    throw new HttpError(502, "the AI model failed to produce a result");
  }
}
