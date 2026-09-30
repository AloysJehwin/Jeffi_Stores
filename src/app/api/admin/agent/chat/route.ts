import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryOne, queryMany } from '@/lib/db'
import { aiChat, AiClientError, type AiToolDef, type AiChatMessage } from '@/lib/ai-client'
import { TOOLS, getTool } from '@/lib/admin-agent/tools'
import { findSimilar } from '@/lib/rag'
import { resolveTenantId } from '@/lib/tenant-context'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MAX_ITERATIONS = 4
const HISTORY_TRUNCATE = 20

interface IncomingMessage {
  conversationId?: string
  message: string
}

interface ToolCallRecord {
  tool: string
  input: Record<string, unknown>
  output: unknown
  isError?: boolean
}

// Core read tools — always available. Kept small because sending every tool
// schema to the model each turn is the dominant latency cost (26 schemas ≈ 26s/turn
// on the local box). Niche/mutating groups are added only when the query implies them.
const CORE_TOOLS = new Set([
  'search_products',
  'get_product',
  'get_product_variants',
  'search_customers',
  'get_customer',
  'get_recent_orders',
  'get_order',
  'find_customer_orders',
  'get_low_stock_products',
  'run_sql_readonly',
  'list_admin_tools',
])

// Extra tool groups, gated by keywords in the user's message.
const TOOL_GROUPS: { test: RegExp; tools: string[] }[] = [
  {
    test: /\b(email|campaign|mail|announce|newsletter|audience|subscriber|send|blast|promo)\b/i,
    tools: [
      'get_campaign_stats',
      'send_test_email',
      'toggle_campaign_enabled',
      'estimate_email_audience',
      'propose_product_announcement_email',
      'propose_order_delay_email',
    ],
  },
  { test: /\b(ship|shipped|dispatch|delivery|delivered|track|awb|fulfil)\b/i, tools: ['mark_order_shipped'] },
  { test: /\b(schema|table|column|sql|query|database|db)\b/i, tools: ['describe_schema'] },
  {
    test: /\b(file|repo|code|route|api|endpoint|source)\b/i,
    tools: ['list_repo_files', 'read_repo_file', 'list_admin_api_routes', 'call_admin_api'],
  },
  { test: /\b(similar|recommend|like this|related)\b/i, tools: ['find_similar_products'] },
  { test: /\b(recent|latest|new)\b/i, tools: ['get_recent_customers', 'get_recent_products'] },
]

// Build the native tools array, selecting a query-relevant subset to keep the
// per-turn prompt small. Falls back to core-only when nothing matches.
function selectToolNames(userMessage: string): Set<string> {
  const selected = new Set(CORE_TOOLS)
  for (const g of TOOL_GROUPS) {
    if (g.test.test(userMessage)) for (const t of g.tools) selected.add(t)
  }
  return selected
}

function buildToolsDef(userMessage?: string): AiToolDef[] {
  const allow = userMessage ? selectToolNames(userMessage) : null
  return TOOLS.filter(t => !allow || allow.has(t.name)).map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as unknown as Record<string, unknown>,
    },
  }))
}

async function buildSystemPromptWithDynamic(userMessage?: string): Promise<string> {
  let ragContext = ''
  // The RAG index holds only the platform store's records; a tenant's prompt must never carry them.
  if (userMessage && !(await resolveTenantId())) {
    try {
      const results = await findSimilar(userMessage, { limit: 12, minSimilarity: 0.3 })
      if (results.length > 0) {
        ragContext =
          '\n\n## STORE DATA CONTEXT\n' +
          'The following records from the store database are semantically relevant to this query. ' +
          'Use them to answer directly when the data is sufficient — only call a tool if you need fresher or more specific data.\n\n' +
          results.map(r => `[${r.source_table}:${r.source_id}] ${r.content}`).join('\n')
      }
    } catch {
      // RAG unavailable — fall through to tool-only mode
    }
  }
  const { currentBrandNameAsync } = await import('@/lib/brand')
  const brand = await currentBrandNameAsync()
  return buildSystemPromptBody(ragContext, brand)
}

function buildSystemPromptBody(dynamicList: string, brand: string): string {
  return `/no_think
You are the ${brand} admin assistant. You help store operators run their business.

## TOOL CALLING

You have access to a set of tools (declared to you natively). Call them via the native tool-calling
mechanism — do NOT write tool calls as text. When you need data or want to perform an action, invoke
the appropriate tool with its arguments. After each tool result you decide the next step. Max ${MAX_ITERATIONS}
tool calls per turn. When you are done, reply with the final answer in plain text (with a ui_blocks block
for any data display, as described below).

RULES (non-negotiable):
- You have ZERO knowledge of this store's data. Call a tool for EVERY data question.
- NEVER invent product names, SKUs, prices, stock, order numbers, or customer details.
- For any data request, call a tool first — do not answer from memory and do not say "I'll fetch" without calling a tool.
- Use ONLY values the tools returned. If a tool returns no results, say so — do not fill in from training.
- Mutating tools (those that change data) return {proposed:true} — when they do, tell the user "I've proposed this — review the action card."
- If a tool returns {needs_choice:true}: write "Multiple matches — pick one above." and stop.
- If the user says "Use address id <uuid> ..." (from the address picker): call propose_create_quotation again with the same customerEmail and items, and pass addressId=<uuid>. Do NOT ask for confirmation — just call the tool.
- Be concise. Numbers and bullet points beat paragraphs. No filler.
${dynamicList}

## DOMAIN RULES

Data queries:
- search_products → natural language describing the product or its use. NOT for filters like featured/low-stock/top-sellers — use run_sql_readonly for those (or list_featured_products for featured).
- run_sql_readonly → ad-hoc SELECTs. Use describe_schema first if unsure of column names. Tables: products, orders, order_items, users, categories, brands, campaigns, email_campaigns_sent.
- Time-based customer/order queries (joined today, last 48h, recent orders) MUST use run_sql_readonly with a WHERE created_at >= NOW() - INTERVAL filter. Exclude guest accounts: AND email NOT LIKE 'guest\_%@temporary.local'.
- Products with has_variants=true: stock lives in product_variants, not inventory_quantity. Price = COALESCE(NULLIF(MIN(pv.price),0), p.base_price, 0).
- Effective stock formula for variants: SUM of sub_variant inventory_quantity when sub-variants exist, else pv.inventory_quantity.

Output format — use ui_blocks for any data display:
<ui_blocks>[
  {"type":"heading","value":"Title","level":2},
  {"type":"product_grid","products":[{"id":"<uuid>","name":"Name","sku":"SKU","price":1234,"stock":5}]},
  {"type":"kv_pairs","pairs":[{"key":"Status","value":"Active"}]},
  {"type":"table","headers":["Col1","Col2"],"rows":[["a","b"]]},
  {"type":"order_list","orders":[{"id":"<uuid>","order_number":"ORD-001","status":"shipped","total":5000}]},
  {"type":"customer_list","customers":[{"id":"<uuid>","email":"x@y.com","name":"Name"}]},
  {"type":"callout","tone":"warn","message":"Note"}
]</ui_blocks>
- IDs must be real UUIDs from tool output — they become deep links.
- Numbers must be raw (no ₹, no commas). price:1234 not "₹1,234".
- 2+ products → always product_grid, never bullet lists.
- Free text outside ui_blocks renders above the blocks — use it for brief framing or questions only.

## QUOTATION FLOW — MANDATORY (violations waste all iterations)

When the user asks to "prepare a quotation", "create a quote", or provides a list of items/tools/materials:
STEP 1 — Call match_quotation_items ONCE with ALL items packed into a single JSON array in the "lines" field.
         DO NOT call search_products for quotation items. DO NOT loop per item. ONE call, ALL lines.
STEP 2 — Wait for match_quotation_items result. It returns a quotation_resolver UI block automatically.
STEP 3 — If all lines are matched: call propose_create_quotation with the productIds from the result.
         If some are ambiguous: show the resolver block and ask the admin to confirm those lines first.
         If some are unmatched: show the resolver block and tell the admin which items were not found.
NEVER call search_products for items in a quotation request. NEVER call match_quotation_items more than once per turn.

Marketing emails:
- "send featured products email" or "product announcement" → estimate_email_audience then propose_product_announcement_email. Single-address test: audience="test_only", testEmail=<address>. intro = ONE plain sentence. NO markdown.
- "send a broadcast email" / "mailer blast" → propose_send_mailer_broadcast. Use audience="test_only" + testEmail="addr" for a test send (NOT the legacy "test_only:email" colon format).
- "test campaign" (abandoned_cart / post_purchase / etc.) → send_test_email(campaignKind, toEmail). Valid kinds: abandoned_cart, abandoned_checkout, post_purchase, price_drop, restock, review_reminder, thank_you_for_your_purchase, winback_90, winback_180.
- CRITICAL: "featured_products" is NOT a valid campaignKind. NEVER pass it to send_test_email.

Currency: INR (₹). Dates: Asia/Kolkata.`
}

const QUOTATION_TRIGGER_RE = /\b(prepare|create|make|generate|draft)\b.{0,20}\b(quotation|quote|rfq)\b/i
const BATCH_SIZE = 8

// Strip leading "N. " or "N) " or "N " list prefix
const LIST_PREFIX_RE = /^\s*\d+[\.\)]?\s+/

// Trailing qty+unit at end of line: "2 nos", "1 no.", "12 pkt", "50mtr each" etc.
// Must be preceded by whitespace so "48mm" doesn't match as qty=48 unit=mm
const TRAILING_QTY_RE =
  /\s+(\d+)\s*(?:no\.?s?|nos?\.?|pcs?\.?|pc\.?|units?|boxes?|box\.?|pkts?\.?|packets?|sets?|mtr\.?|m\.?|each|ea\.?)?\s*$/i

function parseItemLine(raw: string): { requestedText: string; qty: number } | null {
  if (!LIST_PREFIX_RE.test(raw)) return null
  let line = raw.replace(LIST_PREFIX_RE, '').trim()

  const qm = TRAILING_QTY_RE.exec(line)
  if (!qm) return null

  const qty = parseInt(qm[1], 10)
  const text = line.slice(0, qm.index).trim()

  if (!text || qty <= 0 || qty > 9999) return null
  return { requestedText: text, qty }
}

function parseQuotationRequest(
  message: string
): { customerEmail: string; lines: Array<{ requestedText: string; qty: number }> } | null {
  if (!QUOTATION_TRIGGER_RE.test(message)) return null

  const emailRe = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/
  const customerEmail = emailRe.exec(message)?.[0] ?? ''

  const lines: Array<{ requestedText: string; qty: number }> = []
  for (const raw of message.split('\n')) {
    const parsed = parseItemLine(raw)
    if (parsed) lines.push(parsed)
  }

  if (lines.length < 2) return null
  return { customerEmail, lines }
}

function parseUiBlocks(text: string): { blocks: any[]; remainder: string } {
  const re = /<ui_blocks>\s*([\s\S]*?)\s*<\/ui_blocks>/g
  let blocks: any[] = []
  let m
  while ((m = re.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(m[1])
      if (Array.isArray(parsed)) blocks = blocks.concat(parsed)
      else if (parsed && Array.isArray(parsed.blocks)) blocks = blocks.concat(parsed.blocks)
    } catch {
      /* malformed ui_blocks JSON — skip */
    }
  }
  const remainder = text.replace(re, '').trim()
  return { blocks, remainder }
}

async function invokeAdminApiInternal(
  method: string,
  path: string,
  body: string | null,
  req: NextRequest
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const cookieHeader = req.headers.get('cookie') || ''
  const origin = process.env.NEXT_PUBLIC_SITE_URL || `http://localhost:${process.env.PORT || 3000}`
  const url = new URL(path, origin).toString()
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Cookie: cookieHeader,
        'Content-Type': 'application/json',
      },
      body: method === 'GET' || method === 'HEAD' ? undefined : body || undefined,
    })
    let parsed: unknown
    try {
      parsed = await res.json()
    } catch {
      parsed = await res.text().catch(() => null)
    }
    return { ok: res.ok, status: res.status, body: parsed }
  } catch (err: any) {
    return { ok: false, status: 0, body: { error: String(err?.message || err) } }
  }
}

export async function POST(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'agent:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as IncomingMessage
  const userMessage = String(body.message || '').trim()
  if (!userMessage) return NextResponse.json({ error: 'message is required' }, { status: 400 })
  if (userMessage.length > 2000) return NextResponse.json({ error: 'message too long (max 2000)' }, { status: 400 })

  const conversationId = body.conversationId || crypto.randomUUID()

  await query(
    `INSERT INTO admin_agent_messages (admin_id, conversation_id, role, content) VALUES ($1, $2, 'user', $3)`,
    [admin.adminId, conversationId, userMessage]
  )

  // Short-circuit: bypass LLM entirely for quotation confirmation from the resolver UI
  if (userMessage.startsWith('__quotation_confirm__')) {
    try {
      const itemsJson = userMessage.slice('__quotation_confirm__'.length)
      const allItems: Array<{
        productId?: string
        quantity: number
        variantId?: string
        subVariantId?: string
        skipped?: boolean
        requestedText?: string
      }> = JSON.parse(itemsJson)
      const items = allItems.filter(i => !i.skipped) as Array<{
        productId: string
        quantity: number
        variantId?: string
        subVariantId?: string
      }>
      const skippedItems = allItems.filter(i => i.skipped)

      const priorMessages = await queryMany<{ role: string; content: string }>(
        `SELECT role, content FROM admin_agent_messages
         WHERE conversation_id = $1 AND role = 'user'
         ORDER BY created_at ASC`,
        [conversationId]
      )
      const emailRe = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/
      const customerEmail = priorMessages.map(m => emailRe.exec(m.content)?.[0]).filter(Boolean)[0] ?? ''

      const proposeTool = getTool('propose_create_quotation')
      if (!proposeTool || !customerEmail || items.length === 0) {
        const reason = !proposeTool
          ? 'tool not found'
          : !customerEmail
            ? 'customer email not found in conversation history'
            : skippedItems.length > 0
              ? `all ${skippedItems.length} items were skipped — no products to quote`
              : 'no items'
        await query(
          `INSERT INTO admin_agent_messages (admin_id, conversation_id, role, content, tool_calls, ui_blocks, proposed_actions, pickers)
           VALUES ($1, $2, 'assistant', $3, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`,
          [admin.adminId, conversationId, `Could not confirm quotation: ${reason}.`]
        )
        return NextResponse.json({
          conversationId,
          message: `Could not confirm quotation: ${reason}.`,
          uiBlocks: [],
          toolCalls: [],
          proposedActions: [],
          pickers: [],
          provider: '',
          model: '',
        })
      }

      const proposeOut = (await proposeTool.handler({ customerEmail, items: JSON.stringify(items) })) as any
      const toolCallRecords: ToolCallRecord[] = [
        {
          tool: 'propose_create_quotation',
          input: { customerEmail, items: JSON.stringify(items) },
          output: proposeOut,
        },
      ]
      const proposedActions: Array<{ id: string; kind: string; payload: any; confirmation: string }> = []
      const finalUiBlocks: any[] = []

      // Address (or other) disambiguation required — surface picker to admin
      if (proposeOut?.needs_choice === true) {
        const pickerNote = proposeOut.note || `Multiple ${proposeOut.choice_kind} options — pick one`
        const pickerMsg = `Multiple addresses found — please pick one above.`
        await query(
          `INSERT INTO admin_agent_messages (admin_id, conversation_id, role, content, tool_calls, ui_blocks, proposed_actions, pickers)
           VALUES ($1, $2, 'assistant', $3, $4::jsonb, '[]'::jsonb, '[]'::jsonb, $5::jsonb)`,
          [
            admin.adminId,
            conversationId,
            pickerMsg,
            JSON.stringify(toolCallRecords),
            JSON.stringify([{ choice_kind: proposeOut.choice_kind, options: proposeOut.options, note: pickerNote }]),
          ]
        )
        return NextResponse.json({
          conversationId,
          message: pickerMsg,
          uiBlocks: [],
          toolCalls: toolCallRecords,
          proposedActions: [],
          pickers: [{ choice_kind: proposeOut.choice_kind, options: proposeOut.options, note: pickerNote }],
          provider: '',
          model: '',
        })
      }

      if (proposeOut?.proposed === true) {
        const inserted = await queryOne<{ id: string }>(
          `INSERT INTO admin_agent_actions (admin_id, conversation_id, kind, payload, status)
           VALUES ($1, $2, $3, $4::jsonb, 'proposed')
           RETURNING id`,
          [admin.adminId, conversationId, proposeOut.kind, JSON.stringify(proposeOut.payload)]
        )
        if (inserted) {
          proposedActions.push({
            id: inserted.id,
            kind: proposeOut.kind,
            payload: proposeOut.payload,
            confirmation: proposeOut.confirmation,
          })
        }
        if (Array.isArray(proposeOut.ui_blocks)) finalUiBlocks.push(...proposeOut.ui_blocks)
      }

      const skippedNote =
        skippedItems.length > 0
          ? ` ${skippedItems.length} item${skippedItems.length > 1 ? 's' : ''} skipped: ${skippedItems.map(s => s.requestedText).join(', ')}.`
          : ''
      const finalText =
        proposeOut?.proposed === true
          ? `Quotation ready — review the proposal below.${skippedNote}`
          : proposeOut?.summary || 'Could not create quotation.'
      await query(
        `INSERT INTO admin_agent_messages (admin_id, conversation_id, role, content, tool_calls, ui_blocks, proposed_actions, pickers)
         VALUES ($1, $2, 'assistant', $3, $4::jsonb, $5::jsonb, $6::jsonb, '[]'::jsonb)`,
        [
          admin.adminId,
          conversationId,
          finalText,
          JSON.stringify(toolCallRecords),
          JSON.stringify(finalUiBlocks),
          JSON.stringify(proposedActions),
        ]
      )
      return NextResponse.json({
        conversationId,
        message: finalText,
        uiBlocks: finalUiBlocks,
        toolCalls: toolCallRecords,
        proposedActions,
        pickers: [],
        provider: '',
        model: '',
      })
    } catch (e: any) {
      return NextResponse.json({ error: `Quotation confirm failed: ${String(e?.message || e)}` }, { status: 500 })
    }
  }

  // Short-circuit: parse numbered-list quotation requests server-side, batch through match_quotation_items
  const parsedQuotation = parseQuotationRequest(userMessage)
  if (parsedQuotation && parsedQuotation.lines.length > 0) {
    const { customerEmail, lines } = parsedQuotation
    const matchTool = getTool('match_quotation_items')
    if (matchTool) {
      try {
        // Run in batches to avoid embedding query bloat
        const allLines: any[] = []
        for (let i = 0; i < lines.length; i += BATCH_SIZE) {
          const batch = lines.slice(i, i + BATCH_SIZE)
          const batchOut = (await matchTool.handler({ lines: JSON.stringify(batch) })) as any
          if (batchOut?.ok && Array.isArray(batchOut.data?.lines)) {
            allLines.push(...batchOut.data.lines)
          } else {
            // batch failed — fall through to LLM
            allLines.length = 0
            break
          }
        }

        if (allLines.length > 0) {
          const counts = { matched: 0, ambiguous: 0, unmatched: 0 }
          for (const l of allLines) counts[l.status as 'matched' | 'ambiguous' | 'unmatched']++

          const resolverBlock = {
            type: 'quotation_resolver',
            lines: allLines,
            counts,
          }

          const toolCallRecords: ToolCallRecord[] = [
            {
              tool: 'match_quotation_items',
              input: { lines: JSON.stringify(lines) },
              output: { ok: true, data: { lines: allLines, counts } },
            },
          ]
          let finalUiBlocks: any[] = [resolverBlock]
          const proposedActions: Array<{ id: string; kind: string; payload: any; confirmation: string }> = []
          let finalText = ''

          // All matched — auto-propose
          if (counts.ambiguous === 0 && counts.unmatched === 0 && counts.matched > 0 && customerEmail) {
            const proposeTool = getTool('propose_create_quotation')
            if (proposeTool) {
              const items = allLines
                .filter((l: any) => l.status === 'matched' && l.candidates[0])
                .map((l: any) => ({ productId: l.candidates[0].productId, quantity: l.qty }))
              const proposeOut = (await proposeTool.handler({ customerEmail, items: JSON.stringify(items) })) as any
              toolCallRecords.push({
                tool: 'propose_create_quotation',
                input: { customerEmail, items: JSON.stringify(items) },
                output: proposeOut,
              })
              if (proposeOut?.proposed === true) {
                const inserted = await queryOne<{ id: string }>(
                  `INSERT INTO admin_agent_actions (admin_id, conversation_id, kind, payload, status)
                   VALUES ($1, $2, $3, $4::jsonb, 'proposed') RETURNING id`,
                  [admin.adminId, conversationId, proposeOut.kind, JSON.stringify(proposeOut.payload)]
                )
                if (inserted)
                  proposedActions.push({
                    id: inserted.id,
                    kind: proposeOut.kind,
                    payload: proposeOut.payload,
                    confirmation: proposeOut.confirmation,
                  })
                if (Array.isArray(proposeOut.ui_blocks)) finalUiBlocks = finalUiBlocks.concat(proposeOut.ui_blocks)
                finalText = 'All items matched. Review the quotation proposal below.'
              }
            }
          } else {
            const parts = []
            if (counts.matched > 0) parts.push(`${counts.matched} matched`)
            if (counts.ambiguous > 0) parts.push(`${counts.ambiguous} need review`)
            if (counts.unmatched > 0) parts.push(`${counts.unmatched} not found`)
            finalText =
              parts.join(' · ') +
              '. ' +
              (counts.ambiguous > 0
                ? 'Select the correct product for ambiguous items above.'
                : 'Some items could not be matched to catalog products.')
          }

          await query(
            `INSERT INTO admin_agent_messages (admin_id, conversation_id, role, content, tool_calls, ui_blocks, proposed_actions, pickers)
             VALUES ($1, $2, 'assistant', $3, $4::jsonb, $5::jsonb, $6::jsonb, '[]'::jsonb)`,
            [
              admin.adminId,
              conversationId,
              finalText,
              JSON.stringify(toolCallRecords),
              JSON.stringify(finalUiBlocks),
              JSON.stringify(proposedActions),
            ]
          )
          return NextResponse.json({
            conversationId,
            message: finalText,
            uiBlocks: finalUiBlocks,
            toolCalls: toolCallRecords,
            proposedActions,
            pickers: [],
            provider: '',
            model: '',
          })
        }
      } catch {
        // fall through to LLM path
      }
    }
  }

  const history = await queryMany<{ role: string; content: string }>(
    `SELECT role, content FROM admin_agent_messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC
     LIMIT $2`,
    [conversationId, HISTORY_TRUNCATE]
  )

  const systemPrompt = await buildSystemPromptWithDynamic(userMessage)
  const messages: AiChatMessage[] = [{ role: 'system', content: systemPrompt }]
  for (const h of history) {
    if (h.role === 'user' || h.role === 'assistant') {
      messages.push({ role: h.role, content: h.content })
    }
  }

  const toolsDef = buildToolsDef(userMessage)
  const toolCallRecords: ToolCallRecord[] = []
  const proposedActions: Array<{ id: string; kind: string; payload: any; confirmation: string }> = []
  const pickers: Array<{
    choice_kind: string
    options: Array<{ id: string; label: string; sublabel?: string }>
    note?: string
  }> = []
  let finalText = ''
  let finalUiBlocks: any[] = []
  let provider = ''
  let model = ''
  let done = false

  try {
    for (let iter = 0; iter < MAX_ITERATIONS && !done; iter++) {
      const r = await aiChat({
        modelHint: 'agent',
        jsonMode: false,
        temperature: 0.2,
        maxTokens: 1200,
        messages,
        tools: toolsDef,
      })
      provider = r.provider
      model = r.model

      // No native tool calls — the model's prose is the final answer.
      if (!r.toolCalls || r.toolCalls.length === 0) {
        const ui = parseUiBlocks(r.content)
        finalText = ui.remainder
        finalUiBlocks = finalUiBlocks.concat(ui.blocks)
        break
      }

      // Record the assistant's tool-call turn so the model has the full context on the next iteration.
      messages.push({
        role: 'assistant',
        content: '',
        tool_calls: r.toolCalls.map(tc => ({ function: { name: tc.name, arguments: tc.arguments } })),
      })

      for (const tc of r.toolCalls) {
        if (done) break
        const parsed = tc.arguments || {}
        const tool = getTool(tc.name)

        if (!tool) {
          const err = `Unknown tool: ${tc.name}`
          toolCallRecords.push({ tool: tc.name, input: parsed, output: err, isError: true })
          messages.push({ role: 'tool', content: err })
          continue
        }

        try {
          const out = await tool.handler(parsed)
          toolCallRecords.push({ tool: tc.name, input: parsed, output: out })

          if (out && typeof out === 'object' && (out as any).marker === '__call_admin_api_immediate__') {
            const o = out as any
            const apiOut = await invokeAdminApiInternal(o.method, o.path, null, req)
            toolCallRecords[toolCallRecords.length - 1] = {
              tool: tc.name,
              input: parsed,
              output: apiOut,
              isError: !apiOut.ok,
            }
            messages.push({ role: 'tool', content: JSON.stringify(apiOut).slice(0, 8000) })
          } else if (tool.mutating && out && typeof out === 'object' && (out as any).proposed === true) {
            const o = out as any
            const inserted = await queryOne<{ id: string }>(
              `INSERT INTO admin_agent_actions (admin_id, conversation_id, kind, payload, status)
               VALUES ($1, $2, $3, $4::jsonb, 'proposed')
               RETURNING id`,
              [admin.adminId, conversationId, o.kind, JSON.stringify(o.payload)]
            )
            if (inserted) {
              proposedActions.push({ id: inserted.id, kind: o.kind, payload: o.payload, confirmation: o.confirmation })
            }
            messages.push({ role: 'tool', content: JSON.stringify({ ...o, action_id: inserted?.id }).slice(0, 8000) })
          } else if (
            tool.mutating &&
            out &&
            typeof out === 'object' &&
            (out as any).ok === true &&
            (out as any).action &&
            typeof (out as any).action === 'object'
          ) {
            const o = out as any
            const a = o.action as { kind: string; payload: Record<string, unknown>; confirmation: string }
            const inserted = await queryOne<{ id: string }>(
              `INSERT INTO admin_agent_actions (admin_id, conversation_id, kind, payload, status)
               VALUES ($1, $2, $3, $4::jsonb, 'proposed')
               RETURNING id`,
              [admin.adminId, conversationId, a.kind, JSON.stringify(a.payload)]
            )
            if (inserted) {
              proposedActions.push({ id: inserted.id, kind: a.kind, payload: a.payload, confirmation: a.confirmation })
            }
            messages.push({ role: 'tool', content: JSON.stringify({ ...o, action_id: inserted?.id }).slice(0, 8000) })
          } else if (out && typeof out === 'object' && (out as any).needs_choice === true) {
            const o = out as any
            pickers.push({
              choice_kind: o.choice_kind,
              options: o.options || [],
              note: o.note,
            })
            messages.push({ role: 'tool', content: JSON.stringify(out).slice(0, 4000) })
          } else {
            // Hoist any uiBlocks the tool embedded (e.g. quotation_resolver from match_quotation_items)
            if (out && typeof out === 'object' && Array.isArray((out as any).uiBlocks)) {
              finalUiBlocks = finalUiBlocks.concat((out as any).uiBlocks)
            }
            messages.push({ role: 'tool', content: JSON.stringify(out).slice(0, 8000) })

            // Deterministic quotation advance: if match_quotation_items resolved all lines, auto-call propose_create_quotation
            if (
              tc.name === 'match_quotation_items' &&
              out &&
              typeof out === 'object' &&
              (out as any).ok === true &&
              (out as any).data?.counts?.ambiguous === 0 &&
              (out as any).data?.counts?.unmatched === 0 &&
              (out as any).data?.counts?.matched > 0
            ) {
              const resolvedLines: Array<{ status: string; qty: number; candidates: Array<{ productId: string }> }> = (
                out as any
              ).data.lines
              const items = resolvedLines
                .filter(l => l.status === 'matched' && l.candidates[0])
                .map(l => ({ productId: l.candidates[0].productId, quantity: l.qty }))

              // Extract customer email from any user message in this conversation
              const emailRe = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/
              const customerEmail =
                messages
                  .filter(m => m.role === 'user')
                  .map(m => emailRe.exec(m.content)?.[0])
                  .filter(Boolean)[0] ?? ''

              const proposeTool = getTool('propose_create_quotation')
              if (proposeTool && customerEmail && items.length > 0) {
                try {
                  const proposeOut = await proposeTool.handler({
                    customerEmail,
                    items: JSON.stringify(items),
                  })
                  toolCallRecords.push({
                    tool: 'propose_create_quotation',
                    input: { customerEmail, items: JSON.stringify(items) },
                    output: proposeOut,
                  })
                  if (proposeOut && typeof proposeOut === 'object' && (proposeOut as any).proposed === true) {
                    const o = proposeOut as any
                    const inserted = await queryOne<{ id: string }>(
                      `INSERT INTO admin_agent_actions (admin_id, conversation_id, kind, payload, status)
                       VALUES ($1, $2, $3, $4::jsonb, 'proposed')
                       RETURNING id`,
                      [admin.adminId, conversationId, o.kind, JSON.stringify(o.payload)]
                    )
                    if (inserted) {
                      proposedActions.push({
                        id: inserted.id,
                        kind: o.kind,
                        payload: o.payload,
                        confirmation: o.confirmation,
                      })
                    }
                    // Surface the quotation preview ui_blocks
                    if (Array.isArray(o.ui_blocks)) {
                      finalUiBlocks = finalUiBlocks.concat(o.ui_blocks)
                    }
                  }
                  messages.push({ role: 'tool', content: JSON.stringify(proposeOut).slice(0, 8000) })
                } catch (autoErr: any) {
                  messages.push({ role: 'tool', content: `Error: ${String(autoErr?.message || autoErr)}` })
                }
                // All done deterministically — no need for another LLM turn
                done = true
                if (!finalText) finalText = 'All items matched. Review the quotation proposal below.'
              }
            }
          }
        } catch (err: any) {
          const msg = String(err?.message || err)
          toolCallRecords.push({ tool: tc.name, input: parsed, output: msg, isError: true })
          messages.push({ role: 'tool', content: `Error: ${msg}` })
        }
      }
    }
  } catch (err: any) {
    const raw = err instanceof AiClientError ? err.message : String(err?.message || 'AI request failed')
    // Never surface provider/billing internals (e.g. OpenAI "no credits", Ollama
    // unreachable) to the admin — map those to a clean, generic message.
    const unavailable =
      /no credits|unreachable|fallback disabled|billing|quota|rate limit|timeout|abort|ECONNREFUSED|fetch failed/i.test(
        raw
      )
    const msg = unavailable ? 'The assistant is temporarily unavailable. Please try again in a moment.' : raw
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  if (!finalText && finalUiBlocks.length === 0 && !done) {
    finalText =
      'I ran into the iteration limit before reaching a final answer. Try a simpler question or break it into steps.'
  }

  await query(
    `INSERT INTO admin_agent_messages (admin_id, conversation_id, role, content, tool_calls, ui_blocks, proposed_actions, pickers)
     VALUES ($1, $2, 'assistant', $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb)`,
    [
      admin.adminId,
      conversationId,
      finalText,
      JSON.stringify(toolCallRecords),
      JSON.stringify(finalUiBlocks),
      JSON.stringify(proposedActions),
      JSON.stringify(pickers),
    ]
  )

  return NextResponse.json({
    conversationId,
    message: finalText,
    uiBlocks: finalUiBlocks,
    toolCalls: toolCallRecords,
    proposedActions,
    pickers,
    provider,
    model,
  })
}
