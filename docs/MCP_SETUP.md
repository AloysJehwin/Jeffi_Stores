# MCP Server Setup

The Jeffi Stores MCP server (`scripts/mcp-server.mjs`) exposes 11 read-only business tools to any MCP-compatible client (Claude Desktop, Cursor, the future admin agent).

See [ADR-0002](adr/0002-mcp-server.md) for the design rationale.

## What it does

When an LLM agent connects, it can call these tools and get JSON back:

| Tool | Purpose |
|---|---|
| `search_products` | Semantic catalog search via RAG |
| `get_product` | Full product detail by id or slug |
| `get_product_variants` | Variants for a product |
| `find_similar_products` | "More like this" |
| `search_customers` | Find customers by name/email/phone semantics |
| `get_customer` | Profile + LTV + last order |
| `get_recent_orders` | Filter by user/status/days |
| `get_order` | Full order with line items |
| `get_low_stock_products` | Restock candidates |
| `get_campaign_stats` | Campaign performance funnel |
| `dry_run_audience` | Estimate scenario audience without sending |

All read-only. No mutating tools in V1.

## Run it locally

The MCP server reads from:
- **Razer pgvector** (`100.110.153.68:5432/jeffi_dev`) for semantic search via the `embeddings` table
- Same DB for hydrated product/customer/order detail (it's a near-mirror of prod, refreshed nightly)

You need:
- The Razer running and reachable on Tailscale
- `RDS_MASTER_PASSWORD` available (used for the Razer DB; same password)
- Node 18+

Quick sanity check:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | RDS_MASTER_PASSWORD=... node scripts/mcp-server.mjs
```

Should print the 11 tools and exit. If it hangs, check your Tailscale connection to the Razer.

## Connect from Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "jeffi-stores": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/Jeffi_Storess_Site/scripts/mcp-server.mjs"],
      "env": {
        "RDS_MASTER_PASSWORD": "...",
        "RAG_PG_HOST": "100.110.153.68",
        "RAG_OLLAMA_URL": "http://100.110.153.68:11434"
      }
    }
  }
}
```

Restart Claude Desktop. You should see "jeffi-stores" listed in the MCP tools panel. Try:

> Find me 5 wrenches under ₹500 from Taparia and tell me which one I should restock first based on recent sales.

The agent will call `search_products` → `get_recent_orders` → `get_low_stock_products` and answer.

## Connect from Cursor

In Cursor settings → MCP, add:

```json
{
  "jeffi-stores": {
    "command": "node",
    "args": ["/ABSOLUTE/PATH/TO/Jeffi_Storess_Site/scripts/mcp-server.mjs"],
    "env": { "RDS_MASTER_PASSWORD": "..." }
  }
}
```

Same tools become available in any chat in that workspace.

## Logs

Every tool call is logged to `~/.cache/jeffi-mcp/calls.log` as one JSON object per line:

```json
{"ts":"2026-05-31T11:58:00.000Z","tool":"search_products","input":{"query":"wrench"},"ok":true,"output_size":1234}
```

Useful for debugging agent behavior and finding tools that often fail or are never used.

## Adding a new tool

Edit `scripts/mcp-server.mjs`. Each tool is an object in the `TOOLS` array:

```js
{
  name: 'tool_name',
  description: 'When the agent should call this',
  inputSchema: { type: 'object', properties: {...}, required: [...] },
  handler: async (args) => { /* return JSON */ }
}
```

Constraints (per ADR-0002):
- **Read-only.** No `INSERT`/`UPDATE`/`DELETE`. Reviewers should reject any PR that adds a mutating tool until V2.
- **Cap result size.** Use `clamp(limit, 1, MAX)`.
- **Parameterized SQL.** Use `$1, $2`; never string-concatenate user input.
- **5s `statement_timeout`** is set on both pools by default; long queries fail loudly.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Server prints "connected" but tools/list hangs | Tailscale isn't connecting; check `tailscale status` |
| `search_products` returns `[]` | Razer's `embeddings` table empty? `psql -h 100.110.153.68 -U postgres -d jeffi_dev -c 'SELECT count(*) FROM embeddings'` |
| `connection refused` to Razer | Razer is offline. Wake it up. |
| Tool times out at 5s | Either query is genuinely slow (add an index) or pool is saturated; check `journalctl -u postgresql@15-main.service` on the Razer |
