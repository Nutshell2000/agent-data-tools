import type { Env } from "./env";

/**
 * Secrets from the quote front (19 Nov 2026).
 *
 * Why: Cloudflare keeps a Worker's secrets with its NAME and never shows them again. At the quote-front cut-over the
 * name "agent-data-tools" (and so every production secret: CDP keys, Stripe, search, proxy secrets) stays with the
 * small front Worker, and this full app runs as "agent-data-tools-core" without them. The front exposes them through
 * a named entrypoint (`Secrets`, src/front/index.ts) that only a service binding in this account can call; no HTTP
 * route reaches it. The core reads them once per isolate and fills in only the keys its own config lacks, so its own
 * vars and secrets always win. Without the FRONT_SECRETS binding (tests, staging, today's single Worker) nothing changes.
 */
interface SecretSource { read(): Promise<Record<string, string>> }

let secrets: Record<string, string> | undefined;
let pending: Promise<Record<string, string>> | undefined;
let merged: { from: Env; env: Env } | undefined;

/** The env with the front's secrets filled in. Throws when the front cannot be reached (the caller answers 503). */
export async function withFrontSecrets(env: Env): Promise<Env> {
  const source = (env as unknown as { FRONT_SECRETS?: SecretSource }).FRONT_SECRETS;
  if (!source) return env;
  if (merged?.from === env) return merged.env;
  if (!secrets) {
    pending ??= source.read().then((s) => { secrets = s; return s; }).finally(() => { pending = undefined; });
    await pending;
  }
  const filled = { ...secrets, ...env } as Env;
  merged = { from: env, env: filled };
  return filled;
}
