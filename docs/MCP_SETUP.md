# MCP Server Setup

The Jeffi Stores MCP server (`scripts/mcp-server.mjs`) exposes 11 read-only business tools to any MCP-compatible client (Claude Desktop, Cursor, the future admin agent).

See [ADR-0002](adr/0002-mcp-server.md) for the design rationale.

## Architecture

```
[MCP client]              [MCP server, EC2]              [data sources]
Claude Desktop ──ssh──► /opt/jeffi-mcp/run.sh ──┬──► live RDS (VPC, IAM auth)
                                                │      → live products, orders, customers, stock, prices
                                                └──► Razer pgvector (Tailscale)
                                                       → embeddings table only (~15.4k rows)
                                                       → Ollama at the same host (embeddings)
```

**Two pools, two sources of truth:**

- **Live RDS** (`jeffi-stores-db.cjmaa6acimgm.us-east-1.rds.amazonaws.com`): all business data — products, orders, customers, stock, prices. The agent always sees current state.
- **Razer pgvector** (`100.110.153.68:5432/jeffi_dev`): embeddings table for semantic search. Updated nightly by the systemd timer; used **only** for vector similarity search.

The Razer's other tables (products, users, orders, etc.) are still synced nightly so the embedding refresh job can read them, but **MCP queries don't read from them**. They're internal to the embedding pipeline.

## What it does

| Tool | Purpose | Data source |
|---|---|---|
| `search_products` | Semantic catalog search | Razer (vectors) → RDS (hydrate) |
| `get_product` | Full product detail | RDS |
| `get_product_variants` | Variants for a product | RDS |
| `find_similar_products` | "More like this" | Razer (vectors) → RDS (hydrate) |
| `search_customers` | Find customers semantically | Razer (vectors) → RDS (hydrate) |
| `get_customer` | Profile + LTV + last order | RDS |
| `get_recent_orders` | Filter by user/status/days | RDS |
| `get_order` | Full order with line items | RDS |
| `get_low_stock_products` | Restock candidates | RDS |
| `get_campaign_stats` | Campaign performance funnel | RDS |
| `dry_run_audience` | Estimate scenario audience without sending | RDS (READ ONLY transaction) |

All read-only. No mutating tools in V1.

## Run it

The MCP server lives at `/opt/jeffi-mcp/server.mjs` on EC2 (production). Local dev still works against the Razer if `DATABASE_URL` is unset; see "Local development" below.

### Connect from Claude Desktop (production data)

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "jeffi-stores": {
      "command": "ssh",
      "args": [
        "-i", "/Users/YOU/.ssh/jeffi-stores-key.pem",
        "-o", "StrictHostKeyChecking=no",
        "[email protected]",
        "/opt/jeffi-mcp/run.sh"
      ]
    }
  }
}
```

The `run.sh` launcher sources `/opt/jeffi-stores/.env.production` (DATABASE_URL, RDS_*, AWS_*) and `/etc/jeffi-mcp.env` (the Razer postgres password) before exec'ing node. No env vars need to live in the Claude config.

Restart Claude Desktop. You should see "jeffi-stores" listed in the MCP tools panel. Try:

> Find me 5 wrenches under ₹500 from Taparia and tell me which one I should restock first based on recent sales.

The agent will call `search_products` → `get_recent_orders` → `get_low_stock_products` and answer with **live data**.

### Connect from Cursor (production data)

Same idea, in Cursor settings → MCP:

```json
{
  "jeffi-stores": {
    "command": "ssh",
    "args": [
      "-i", "/Users/YOU/.ssh/jeffi-stores-key.pem",
      "[email protected]",
      "/opt/jeffi-mcp/run.sh"
    ]
  }
}
```

### Local development (dev data on the Razer)

If you don't want to hit prod, run locally with everything pointed at the Razer's `jeffi_dev`:

```bash
RDS_MASTER_PASSWORD="$(grep RDS_MASTER_PASSWORD .env.local | cut -d= -f2-)" \
node scripts/mcp-server.mjs
```

When `DATABASE_URL` is unset and `RDS_IAM_AUTH` is not `true`, the app pool falls back to the same connection as the rag pool. So both vector search and data queries hit the Razer's nightly snapshot. Useful for offline / testing.

## Logs

Every tool call is logged to `~/.cache/jeffi-mcp/calls.log` as one JSON object per line:

```json
{"ts":"2026-05-31T11:58:00.000Z","tool":"search_products","input":{"query":"wrench"},"ok":true,"output_size":1234}
```

On EC2 the log lives at `/home/ec2-user/.cache/jeffi-mcp/calls.log`. Useful for debugging agent behavior and finding tools that often fail.

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

**Pool routing rules:**

- Anything that needs **fresh data** (current stock, current price, customer LTV, order status, campaign stats): use `appPool`. That's RDS.
- Anything that needs **semantic similarity** (find rows by meaning): use `ragPool` to get IDs, then `appPool` to hydrate.

**Other constraints (per ADR-0002):**

- **Read-only.** No `INSERT`/`UPDATE`/`DELETE`. Reviewers should reject any PR that adds a mutating tool until V2.
- **Cap result size.** Use `clamp(limit, 1, MAX)`.
- **Parameterized SQL.** Use `$1, $2`; never string-concatenate user input.
- **5s `statement_timeout`** on both pools by default.

After editing the script:

```bash
scp -i ~/.ssh/jeffi-stores-key.pem scripts/mcp-server.mjs [email protected]:/opt/jeffi-mcp/server.mjs
```

(Or `npm run build` and let CI deploy it via the normal flow once we wire that up.)

## Troubleshooting

| Symptom | Fix |
|---|---|
| `password authentication failed for user "postgres"` | Razer pgvector pool can't auth. Check `/etc/jeffi-mcp.env` on EC2 has `RAG_PG_PASSWORD=<value>` matching the Razer postgres user's password. |
| `IAM authentication failed` | RDS_IAM_AUTH is on but the IAM token is invalid. Restart the MCP (token is minted fresh each connection). |
| Server prints "connected" but tools/list hangs | Tailscale isn't connecting from EC2. `ssh ec2-user@... 'tailscale status'` should show `aloysjehwin` (the Razer) as `idle` or `direct`. |
| `search_products` returns `{products:[]}` for a query that should match | Razer's `embeddings` table empty? `psql -h 100.110.153.68 -U postgres -d jeffi_dev -c 'SELECT count(*) FROM embeddings'` should be ~15k. |
| `connection refused` to Razer | Razer is offline. Wake it up. |
| Tool times out at 5s | Either query is genuinely slow (add an index on RDS) or pool is saturated; check `journalctl -u postgresql@15-main.service` on the Razer. |

