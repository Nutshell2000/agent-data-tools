import { parseTarget } from "../lib/fetch";

export type ReaderShell = "posix" | "powershell";

/** A command generator only: never reads keys, fetches a page or starts a process. */
export function readerCommands(
  origin: string,
  raw: string,
  format = "markdown",
  maxChars = "20000",
  shell: ReaderShell = "posix",
) {
  if (raw.length > 8192 || /[\u0000-\u001f\u007f]/.test(raw))
    throw new Error("Use a public HTTP(S) URL without control characters.");
  const target = parseTarget(raw).href;
  if (!["text", "markdown", "both"].includes(format))
    throw new Error("Choose text, markdown or both.");
  if (!/^\d+$/.test(maxChars) || +maxChars < 500 || +maxChars > 100000)
    throw new Error("Character limit must be an integer from 500 to 100000.");
  if (shell !== "posix" && shell !== "powershell")
    throw new Error("Choose POSIX shell or PowerShell.");
  const quoted =
    "'" + target.replace(/'/g, shell === "powershell" ? "''" : "'\"'\"'") + "'";
  const options = ` --format ${format} --max-chars ${Number(maxChars)}`;
  const quote = new URL("/extract", origin);
  quote.search = new URLSearchParams({
    url: target,
    format,
    maxChars: String(Number(maxChars)),
  }).toString();
  return {
    quoteUrl: quote.href,
    quoteCommand: `node reader-client.mjs quote ${quoted}${options}`,
    buyCommand: `node reader-client.mjs buy ${quoted} --max-usdc 0.002${options}`,
  };
}
