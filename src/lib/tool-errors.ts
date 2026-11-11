// What a tool's refusal looks like over HTTP (11 Nov 2026).
//
// A tool that found nothing for the input (unknown CVE, name, token, transaction…) throws HttpError(404). Over HTTP that
// is answered as 422 with code NOT_FOUND: the endpoint exists and worked, only the thing asked about does not. Routers
// and monitors read a 404 on a tool URL as a broken endpoint. Mercator's docs (mercator.sh/docs, read 11 Nov 2026):
// "Non-402 errors, including 404, downrank services; caller-input 400 and 422 do not unless the endpoint has stopped
// succeeding", with ranking multipliers of 0.75 and 0.5 over thirty days. Unknown paths still answer 404
// (app.notFound), and inside the service (packs, MCP, the ENS resolver) the error keeps its 404.
export const NOT_FOUND_CODE = "NOT_FOUND";

export function toolErrorAnswer(
  err: { status: number; message: string; code?: string },
  isToolPath: boolean,
  help: Record<string, unknown> = {},
): { status: number; body: Record<string, unknown> } {
  if (err.status === 404 && isToolPath) return { status: 422, body: { error: err.message, code: err.code ?? NOT_FOUND_CODE } };
  return { status: err.status, body: { error: err.message, ...(err.code ? { code: err.code } : {}), ...help } };
}
