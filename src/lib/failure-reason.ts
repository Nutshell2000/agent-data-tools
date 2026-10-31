/** Paths queued with this prefix are failure reasons (request-metrics.ts), counted in the day's errors: row (metrics.ts). */
export const FAILURE_PREFIX = "#err ";

/**
 * A failed call's status and error message with whatever the caller sent taken out (URLs, e-mail addresses, domains,
 * hex values, quoted values, numbers), so failures can be counted by kind without storing anyone's input.
 */
export function failureReason(status: number, message: unknown): string {
  const text = typeof message === "string" ? message : "";
  const clean = text
    .replace(/https?:\/\/\S+/gi, "<url>")
    .replace(/[^\s@]+@[^\s@]+/g, "<email>")
    .replace(/0x[0-9a-f]{4,}/gi, "<hex>")
    .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, "<value>")
    .replace(/\b[\w-]+(\.[\w-]+)+\b/g, "<name>")
    .replace(/\d+/g, "N")
    .replace(/\s+/g, " ").trim().slice(0, 100);
  return `${status} ${clean || "no message"}`;
}

/** Status of a refused payment in a failure reason: /status lists these apart from tool failures, as paymentRefusals. */
export const REFUSED_PAYMENT = 402;

/**
 * Why a payment attempt was refused. Our v1 messages echo unquoted values from the caller's payment (network, version,
 * amount), which must not reach the public /status, so those parts go before the usual clean-up.
 */
export function refusalReason(message: unknown): string {
  const text = typeof message === "string" ? message : "";
  return failureReason(REFUSED_PAYMENT, text.replace(/\s*\(got [^)]*\)/g, "").replace(/^network .*? is not accepted.*$/s, "network is not accepted"));
}
