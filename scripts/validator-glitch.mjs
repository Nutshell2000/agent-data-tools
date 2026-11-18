// A throttled Coinbase CDP validator answers HTTP 200 with parseable JSON, so the 429/5xx retry in
// check-live-readiness never fires. The signature seen on 18 Nov (1.224, 1.228): no payment quote,
// simulation=rejected, and about 21 required preflight checks all failed at once for unrelated tools.
// Only classify this shape as a transient glitch; a persistent one still fails after the retries.
export function isValidatorGlitch(detail) {
  if (!detail || typeof detail !== "object") return false;
  const quote = detail.paymentRequirements?.accepts?.[0];
  if (quote) return false;
  const failed = (Array.isArray(detail.preflight) ? detail.preflight : []).filter(c => c?.severity === "required" && !c.passed);
  return failed.length >= 10 && detail.simulation?.outcome !== "accepted";
}
