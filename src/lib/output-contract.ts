import type { EndpointPath } from "../endpoints";
import { HttpError } from "./env";
import { validate_extract, validate_sitemap, validate_btc_fees } from "./output-validators.generated";

const validators: Partial<Record<EndpointPath, (value: unknown) => boolean>> = {
  "/extract": validate_extract, "/sitemap": validate_sitemap, "/btc-fees": validate_btc_fees,
};
/** Shared HTTP/MCP guard runs before payment settlement; never exposes source content in errors. */
export function assertToolOutput(path: EndpointPath, value: unknown): void {
  if (validators[path] && !validators[path]!(value)) {
    throw new HttpError(502, "Tool result failed its published output contract; no charge was settled.", "OUTPUT_CONTRACT_INVALID");
  }
}
