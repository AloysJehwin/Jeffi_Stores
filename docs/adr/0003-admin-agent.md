# ADR-0003: Admin agent in /admin

- **Status**: Proposed → Implemented in this PR
- **Date**: 2026-05-31

## Context

PR #314 shipped:
- A self-hosted Ollama on the Razer (qwen2.5-coder, llama3.1:8b)
- An MCP server on EC2 exposing 11 read-only business tools (`scripts/mcp-server.mjs`)
- pgvector RAG over 15,458 product/customer/order embeddings
- An ai_feedback feedback loop on the customer-facing AI search

The MCP server is already useful from Claude Desktop / Cursor — but it's not available **inside the admin panel** where day-to-day operators actually work. This ADR scopes the in-app admin agent.

## Goals (V1)

1. A button in the admin top bar that opens a chat-style popup (mirrors the customer-facing `AiAssistantModal`).
2. Admin can:
   - Type a free-form question → agent calls tools → answers in plain English.
   - Use slash commands (e.g. `/find-customer aloys@gmail.com`) for fast lookups.
   - Click tool palette buttons for the most common workflows.
   - Approve or reject **proposed mutating actions** the agent generates.
3. Mutating actions are gated behind an explicit approval click. Three actions in V1: `send_test_email`, `toggle_campaign_enabled`, `mark_order_shipped`.
4. All conversation state and proposed actions persist to the DB so admins can review history.

## Non-goals (V1)

- **No customer-facing exposure.** This is operator-only.
- **No auto-execution of mutating actions.** Every state change requires the admin to click Approve.
- **No multi-conversation UI.** One conversation per modal session; close the modal = clear the chat (DB persists for audit).
- **No streaming UI.** Responses arrive when the agentic loop finishes (typically 2-8s on Ollama). Streaming is V2.
- **No file uploads, image attachments, voice.** All text.

## Architecture

```
[Admin browser]
   │  POST /api/admin/agent/chat { conversationId, message }
   ▼
[Next.js route]
   │   1. authenticateAdmin + hasScope('agent')
   │   2. append user message to admin_agent_messages
   │   3. agentic loop (max 5 iterations):
   │        a. aiChat({ messages: history + tools })
   │        b. parse LLM output for tool_use blocks
   │        c. for each tool call:
   │             - if read-only: invoke tool, feed result to LLM
   │             - if mutating: insert admin_agent_actions(status='proposed'),
   │                            return action card to client (no execution)
   │        d. if no tool calls: stop, return final text
   │   4. append assistant message + tool calls to admin_agent_messages
   ▼
[Response] { message, toolCalls, proposedActions }
```

Approval flow:

```
Admin clicks "Approve" in the action card
   │  POST /api/admin/agent/actions/[id]/approve
   ▼
[Next.js route]
   │   1. authenticateAdmin + re-check scope
   │   2. UPDATE admin_agent_actions SET status='approved', decided_at=NOW()
   │   3. dispatch by kind:
   │        - send_test_email → call sendTestCampaignEmail()
   │        - toggle_campaign_enabled → UPDATE campaigns SET enabled = ...
   │        - mark_order_shipped → existing PATCH /api/admin/orders/[id]
   │   4. UPDATE status='executed' or 'failed', record result/error
```

## LLM choice

`ai-client.ts` with `modelHint: 'copy'`. When `AI_PROVIDER=ollama`, this hits `llama3.1:8b-instruct-q4_K_M` on the Razer GPU. Falls back to OpenAI gpt-4o-mini if Razer is unreachable (existing `OLLAMA_FALLBACK_TO_OPENAI` flag).

Why llama3.1:8b and not qwen2.5-coder:14b? Coder is tuned for SQL; the admin agent does conversational reasoning + tool use. 8b is fast (~30 tok/s) and good enough for this. We can swap by changing one env var.

## Tool registry

Reuses the same 11 read-only tools as the MCP server, plus 3 mutating tools:

| Tool | Mutating? | Implementation |
|---|---|---|
| search_products, get_product, get_product_variants, find_similar_products | No | Same as MCP server |
| search_customers, get_customer, get_recent_orders, get_order | No | Same |
| get_low_stock_products, get_campaign_stats, dry_run_audience | No | Same |
| **send_test_email** | Yes | Proposes action; on approve → POST /api/admin/campaigns/[kind]/test |
| **toggle_campaign_enabled** | Yes | Proposes; on approve → PATCH /api/admin/campaigns/[kind] |
| **mark_order_shipped** | Yes | Proposes; on approve → PATCH /api/admin/orders/[id] |

For V1 we keep these in `src/lib/admin-agent/tools.ts` (in-process). Code duplication with `mcp-server.mjs` is acceptable for now; we can extract a shared registry in V2 once we know what's actually getting used.

## Auth model

Existing admin JWT + a new `agent` scope. Only admins with that scope can call `/api/admin/agent/*`. Migration grants `agent` to all existing super_admins automatically; other admin roles need explicit grant.

## DB schema

```sql
admin_agent_messages(
  id uuid pk,
  admin_id uuid fk,
  conversation_id uuid,           -- group messages per chat
  role varchar(20),                -- 'user' | 'assistant' | 'tool'
  content text,
  tool_calls jsonb default '[]',   -- list of {tool, input, output}
  created_at timestamptz
)

admin_agent_actions(
  id uuid pk,
  admin_id uuid fk,                -- who proposed it (the agent runs as)
  conversation_id uuid,
  message_id uuid fk,               -- the assistant message that proposed it
  kind varchar(64) not null,       -- 'send_test_email' etc.
  payload jsonb not null,          -- arguments
  status varchar(20),              -- 'proposed'|'approved'|'executed'|'rejected'|'expired'
  proposed_at timestamptz,
  decided_at timestamptz,
  decided_by_admin_id uuid fk,
  executed_at timestamptz,
  result jsonb,
  error text
)
```

Actions auto-expire after 24h via a future cron (not in V1). For V1, expired actions just sit there.

## UI

A new button in the admin top bar (lucide `Sparkles` or `Bot` icon) opens `AdminAgentModal`. Three tabs:

- **Chat**: free-text input, message history, inline tool-call cards, inline action approval cards.
- **Slash**: typing `/` shows a menu — `/find-customer X`, `/products-top`, `/restock-suggestions`, `/stuck-shipments`, `/campaign-stats`.
- **Tools**: grid of pre-built workflows as buttons.

Action approval cards render inline in the chat with Approve / Reject buttons. Approve runs the action server-side and shows the result in the next message.

Shapes/icons throughout (lucide-react). No emojis.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Agent picks the wrong action with confident-sounding output | Approval gate. Action card shows the actual payload (recipient email, campaign kind, order id) so admin can verify before approving. |
| Agent runs through 5 tool calls and racks up latency | Max-5-iteration cap. Each tool has 5s statement_timeout. Total worst case ~25s; UI shows progressive "calling tool…" state. |
| Agent context grows unboundedly | Conversation history truncated to last 20 messages when sending to LLM. Older messages still in the DB for audit. |
| SQL injection through agent-emitted args | Tools accept typed input, no string concatenation into queries (same constraint as MCP server). |
| Agent hallucinates a product/order id | Tool returns `{error: 'not found'}`. Agent recovers (LLMs are good at this). |
| Action queue gets stale (approved hours later) | Approval handler re-validates the world state — e.g. "is this campaign still in the same state we proposed against?" Reject if drifted. |

## Decision

Build V1 as scoped above. Ship in PR #314.

V2 backlog (separate PR):
- Streaming responses
- Conversation history view (`/admin/agent` page with sidebar of past chats)
- Auto-execute approved actions if admin opts in per-kind
- More mutating actions (create campaign, generate scenario, fulfill order)
- Cross-conversation memory (the agent remembers what you talked about yesterday)
