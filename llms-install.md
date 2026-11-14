# Installing Agent Data Tools as an MCP server (for AI coding agents)

Agent Data Tools is a hosted MCP server. There is nothing to clone or build and no API key is required to start: every
caller gets 25 free successful calls.

## Preferred: remote server (streamable HTTP)

Add this entry to the MCP settings file (`cline_mcp_settings.json` in Cline):

```json
{
  "mcpServers": {
    "agent-data-tools": {
      "type": "streamableHttp",
      "url": "https://agent-data-tools.revmesh2074.workers.dev/mcp/compact"
    }
  }
}
```

The compact server exposes three tools: `find_tool` (find a tool for a job in plain words), `tool_details` (inputs and
price of one tool) and `call_tool` (run it). Use `https://agent-data-tools.revmesh2074.workers.dev/mcp` instead to list
every tool as its own definition (several hundred).

## Alternative: local stdio server through npm

For clients that only start local commands (Node 20 or newer):

```json
{
  "mcpServers": {
    "agent-data-tools": {
      "command": "npx",
      "args": ["-y", "agent-data-tools", "mcp"]
    }
  }
}
```

Optional environment variables for the stdio server, both off by default:

- `AGENT_DATA_TOOLS_KEY`: a prepaid key (`adt_...`) bought by card at https://agent-data-tools.revmesh2074.workers.dev/credits.
- `AGENT_DATA_TOOLS_WALLET_KEY`: the private key of a wallet holding USDC on Base; calls after the free ones are then
  paid per call over x402, at most $0.10 a call and $1 a day unless `AGENT_DATA_TOOLS_MAX_USD` and
  `AGENT_DATA_TOOLS_DAILY_USD` are set. Never ask the user for this key unless they want wallet payment.

## Verify the installation

Call `find_tool` with `{"need": "current time in a city"}`, then `call_tool` with
`{"name": "time", "arguments": {"zone": "Europe/Lisbon"}}`. A JSON answer with `localTime` means the server works.

## Notes

- No setup step asks for payment. When the free calls are used up, a tool result states the price and how to pay; do
  not retry in a loop.
- Image, speech, rendering and search tools are paid from the first call.
