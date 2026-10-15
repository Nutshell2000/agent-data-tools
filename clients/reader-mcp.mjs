import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createReaderMcp, parseMcpArgs } from "./reader-mcp-core.mjs";
try {
  const options = parseMcpArgs(process.argv.slice(2));
  if (options.help) {
    process.stderr.write("Node >=20.19. reader-mcp.mjs starts a quotes-only MCP stdio server. Optional: --enable-buy --session-max-usdc 0.006 (positive cap <=0.020). Buy tools use existing local X402_PRIVATE_KEY, an explicit maxUsdc <=0.002 per invocation and one payment authorization. No automatic retries. Unknown signed outcomes lock further purchases. Session budget resets on restart; reconcile before restarting. Keep MCP host tool approvals enabled. No keys in arguments or messages.\n");
  } else await createReaderMcp(options).connect(new StdioServerTransport());
} catch {
  process.stderr.write("reader_mcp_startup_failed: use --help for supported configuration.\n");
  process.exitCode = 1;
}
