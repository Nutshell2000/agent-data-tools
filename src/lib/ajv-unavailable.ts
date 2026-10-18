// Stand-in for "ajv/dist/2020.js" in the Worker bundle (wrangler.jsonc "alias").
// Ajv compiles schemas into JavaScript with new Function(), which Workers forbid, so every
// compile already fails there, but only after building and logging a large code string.
// @x402/extensions runs that compile for every paid route on each cold start (a startup
// sanity check that only warns), which cost about a second of CPU with 167 routes.
// Failing at once keeps the same outcome (validation reported as unavailable) without the work.
export default class Ajv {
  constructor(_options?: unknown) {}
  compile(_schema: unknown): never {
    throw new Error("JSON Schema compilation is unavailable on Cloudflare Workers");
  }
}
