# ADR-0002: MCP server for Jeffi Stores agents

- **Status**: Proposed
- **Date**: 2026-05-31
- **Authors**: ops + AI/infra

## Context

PR #314 shipped:
- Local Ollama models for inference (qwen2.5-coder:14b for SQL, llama3.1:8b for copy)
- pgvector RAG over 15,458 product/variant/customer/order embeddings
- Per-scenario behavioral campaign automation
- An AI assistant feedback loop on the customer-facing search

The next layer — and the one that turns scattered AI calls into an actual **assistant** — is MCP (Model Context Protocol). This ADR scopes the first MCP server: what it exposes, how it's secured, and how it's run.

## What MCP is, in one paragraph

A standard JSON-RPC protocol where an LLM agent (Claude Desktop, Cursor, our own admin agent later) discovers and calls **tools** that we define. Each tool is a typed function: name, input schema, output schema. The agent decides when to call which tool. This replaces the brittle pattern of stuffing every API into the system prompt.

## Goals (V1)

1. Expose **read-only** business operations as tools so an agent can answer:
   - "Find products like a wrench for tight spaces"
   - "What's the status of order ORD-XXXX?"
   - "Which customers haven't ordered in 60 days and have LTV > ₹10k?"
   - "What's running low on stock?"
2. Run **locally** on the dev machine, talking to local Postgres (the Razer dev mirror). No prod risk.
3. Use the **same RAG layer** PR #314 built — `findSimilarProductIds` etc. become MCP tools.
4. Be runnable from Claude Desktop, Cursor, or any MCP-compatible client without changes.

## Non-goals (V1)

- **No write tools.** No `create_order`, no `update_inventory`, no `send_email`. Mutations stay in the Next.js admin panel where humans can review.
- **No customer-facing exposure.** This is for the operator (you) only.
- **No authentication on the local stdio transport.** Defer until V2 when we expose over HTTP.
- **No EC2/prod deployment.** V1 runs on your laptop / Razer. Prod follows once the tool surface is stable.

## Architecture

```
[Claude Desktop / Cursor / future admin agent]
    │  stdio (JSON-RPC over child process pipes)
    ▼
[MCP server: scripts/mcp-server.mjs]
    │  reuses existing libs:
    │    - src/lib/rag.ts        (RAG queries to Razer pgvector)
    │    - src/lib/db.ts          (Postgres pool to local jeffi_dev)
    │    - src/lib/ai-assistant.ts (search + LLM helpers)
    ▼
[Razer Postgres + pgvector]   [Razer Ollama]
```

**Transport**: stdio for V1 (the MCP standard for local tools). HTTP/SSE comes in V2 if EC2 ever needs to call this.

**Process model**: a single long-running Node process started by the MCP client (Claude Desktop launches it, kills it on exit). One PG pool, one Ollama HTTP client, persistent across calls.

## Tool inventory (V1)

| Tool | Input | Output | Implementation |
|---|---|---|---|
| `search_products` | `query: string, limit?: int` | array of `{id, name, sku, brand, price, stock, similarity}` | `findSimilarProductIds` then hydrate from RDS |
| `get_product` | `id: uuid` or `slug: string` | full product detail | `SELECT *` from `products` join `brands` `categories` |
| `get_product_variants` | `productId: uuid` | array of variants | `SELECT * FROM product_variants WHERE product_id = $1` |
| `find_similar_products` | `productId: uuid, limit?: int` | similar products | embed product description, RAG search excluding self |
| `search_customers` | `query: string, limit?: int` | array of `{id, name, email, phone, lifetimeValue}` | `findSimilar` on `users` table embeddings |
| `get_customer` | `id: uuid` or `email: string` | customer profile + order count + LTV | join `users` + `orders` aggregates |
| `get_recent_orders` | `userId?: uuid, limit?: int, status?: string` | recent orders | `SELECT * FROM orders ORDER BY created_at DESC` |
| `get_order` | `id: uuid` or `orderNumber: string` | full order with items | `SELECT * FROM orders + order_items + addresses` |
| `get_low_stock_products` | `threshold?: int` | products with `inventory_quantity <= threshold` | direct query |
| `get_campaign_stats` | `kind?: string, days?: int` | campaign performance | aggregate `email_campaigns_sent` |
| `dry_run_audience` | `scenarioKind: string, params?: object` | matching user count | use existing scenario sweep but `LIMIT` to count, no send |

11 tools to start. Every tool **must**:
- Be read-only (no INSERT/UPDATE/DELETE)
- Have a JSON schema for input + output (MCP requires it)
- Cap result size (e.g. `limit` defaults to 20, max 100)
- Log every call with input parameters to a local file at `~/.cache/jeffi-mcp/calls.log`

## Auth model

| Transport | V1 | V2 |
|---|---|---|
| stdio | none (parent-process trust) | unchanged |
| HTTP | not exposed | bearer token via `MCP_API_KEY` env var |

V1 runs only on stdio launched by a local MCP client. The trust boundary is "whoever has access to your laptop can use it" — same as your shell. No new attack surface.

V2 (when we expose over HTTP from the Razer for the EC2 admin agent to call) will add token auth and IP allowlist (only the tailnet).

## Configuration

The MCP client config (e.g. `~/Library/Application Support/Claude/claude_desktop_config.json`) points to the server:

```json
{
  "mcpServers": {
    "jeffi-stores": {
      "command": "node",
      "args": ["/Users/.../Jeffi_Storess_Site/scripts/mcp-server.mjs"],
      "env": {
        "DATABASE_URL": "postgresql://postgres:****@100.110.153.68:5432/jeffi_dev",
        "RAG_PG_HOST": "100.110.153.68",
        "RAG_OLLAMA_URL": "http://100.110.153.68:11434"
      }
    }
  }
}
```

Server reads env, opens connections lazily on first tool call, logs to `~/.cache/jeffi-mcp/calls.log`.

## Dependencies

One new npm package: `@modelcontextprotocol/sdk`. ~80kB, zero runtime dependencies, official Anthropic SDK.

## What this unlocks

Not in V1 itself — but with this server installed, **today** you can:
- Open Claude Desktop, type "Find me 5 wrenches under ₹500 from Taparia and tell me which one I should restock first based on recent sales" → it calls `search_products` → `get_recent_orders` → `get_low_stock_products` → answers
- Open Cursor in this repo, ask "summarise yesterday's sales" → it calls `get_recent_orders(days=1)` → answers
- Build the **Daily Operations Briefing agent** (the first concrete workflow we agreed on earlier)

These all become possible the moment the server is wired up. No fine-tuning, no prompt engineering — the LLM client handles tool selection.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Agent hallucinates a product ID and asks for `get_product(id)` | Tool returns 404. Agent recovers (LLMs are good at this). Log the bad call. |
| Tool returns too much data and exhausts the agent's context | Hard `limit=100` cap on every list-returning tool. `truncated: true` in output if hit. |
| Read-only is bypassed via SQL injection through a tool input | All inputs parameterized via `pg`'s `$1, $2`. No string concatenation into queries. Any new tool reviewed for this in PR. |
| Tool latency > 5s timeouts the agent | Pool warm + indexes already in place. Each tool has a 5s `statement_timeout`. |
| MCP SDK breaking changes | Pin to a specific version in `package.json`. Re-test on upgrade. |

## Operational

- **Logs**: `~/.cache/jeffi-mcp/calls.log`, one JSON object per call. Rotate manually for now; daemonize later if we move to HTTP.
- **Restart**: kill the parent client (Claude Desktop / Cursor); next launch spawns a fresh server. No persistent state.
- **Updates**: this server is pure JS/MJS, no build step. Edit + restart.

## Decision

Build V1 as scoped above. Stdio only, read-only tools only, locally-launched only. Everything riskier (write tools, HTTP exposure, auth, customer-facing) is a future ADR.

Concretely:
1. Add `@modelcontextprotocol/sdk` dep
2. Implement `scripts/mcp-server.mjs` with the 11 tools
3. Document setup in `docs/MCP_SETUP.md`
4. Smoke-test with a local MCP Inspector or Claude Desktop
5. Ship in PR #314 (or a focused follow-up PR if scope grows)

V2 plan (HTTP exposure, auth, write tools, EC2 deployment) → ADR-0004 when we get there.
