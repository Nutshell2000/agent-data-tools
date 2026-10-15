/** A HEAD probe must never authorize a purchase, consume a trial or execute a tool. */
export async function headPaymentProbe(
  request: Request,
  dispatch: (probe: Request) => Promise<Response> | Response,
): Promise<Response> {
  const url = new URL(request.url);
  url.searchParams.delete("trial");
  // Deliberately forward no payment, authorization or marketplace credentials.
  const probe = await dispatch(new Request(url, { method: "GET", headers: { accept: "application/json" } }));
  await probe.body?.cancel().catch(() => {});
  return new Response(null, { status: probe.status, headers: probe.headers });
}
