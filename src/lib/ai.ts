import { HttpError, type Env } from "./env";
import { takeDailyBudget } from "./daily-cap";

/**
 * Workers AI calls per UTC day when AI_DAILY_CAP is unset. The free plan's 10,000 neurons stop earlier for most models;
 * on Workers Paid 1,000 calls of the 8B chat model cost about $0.30-1.00, far below what they earn at $0.01 a call.
 */
const DEFAULT_AI_DAILY_CAP = 1000;

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
  await takeDailyBudget(env, "ai", env.AI_DAILY_CAP, DEFAULT_AI_DAILY_CAP, "AI");
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
