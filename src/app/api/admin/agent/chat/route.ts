import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryOne, queryMany } from '@/lib/db'
import { aiChat, AiClientError } from '@/lib/ai-client'
import { TOOLS, getTool } from '@/lib/admin-agent/tools'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

const MAX_ITERATIONS = 8
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

function compactToolList(): string {
  return TOOLS.map(t => {
    // Only required args with type — no descriptions (saves ~60% tokens)
    const requiredArgs = (t.inputSchema.required || []).map(k => {
      const v = t.inputSchema.properties[k]
      return `${k}: ${v?.type ?? 'string'}`
    }).join(', ')
    const optionalArgs = Object.entries(t.inputSchema.properties || {})
      .filter(([k]) => !(t.inputSchema.required || []).includes(k))
      .map(([k, v]: [string, any]) => `${k}?: ${v.type}`)
      .join(', ')
    const args = [requiredArgs, optionalArgs].filter(Boolean).join(', ')
    // First sentence of description only
    const desc = t.description.split(/\.\s/)[0].replace(/\.$/, '')
    return `- ${t.name}${t.mutating ? '!' : ''}: ${desc} {${args}}`
  }).join('\n')
}

function buildSystemPrompt(): string {
  return buildSystemPromptBody(compactToolList(), '')
}

async function buildSystemPromptWithDynamic(): Promise<string> {
  return buildSystemPromptBody(compactToolList(), '')
}

function buildSystemPromptBody(toolList: string, dynamicList: string): string {
  return `/no_think
You are the Jeffi Stores admin assistant. You help store operators run their business.

## TOOL CALLING — MANDATORY PROTOCOL

To call a tool emit this block (nothing before it, no narration):
<tool_use name="TOOL_NAME">
{"arg":"value"}
</tool_use>

After each tool result you will decide the next step. Max ${MAX_ITERATIONS} tool calls per turn. When done, write the final answer — no XML.

RULES (non-negotiable):
- You have ZERO knowledge of this store's data. Call a tool for EVERY data question.
- NEVER invent product names, SKUs, prices, stock, order numbers, or customer details.
- Your first output for any data request must be a <tool_use> block. Not a sentence. Not "I'll fetch". Just the block.
- Use ONLY values the tools returned. If a tool returns no results, say so — do not fill in from training.
- Tools marked with ! are mutating — when they return {proposed:true}, tell the user "I've proposed this — review the action card."
- If {needs_choice:true}: write "Multiple matches — pick one above." and stop.
- Be concise. Numbers and bullet points beat paragraphs. No filler.

## TOOLS

${toolList}${dynamicList}

## DOMAIN RULES

Data queries:
- search_products → natural language ("hex bolts for steel"). NOT for filters like featured/low-stock/top-sellers — use run_sql_readonly for those (or list_featured_products for featured).
- run_sql_readonly → ad-hoc SELECTs. Use describe_schema first if unsure of column names. Tables: products, orders, order_items, users, categories, brands, campaigns, email_campaigns_sent.
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

Quotation flow: DO NOT call propose_create_quotation with text. Always call match_quotation_items first to resolve product names → ids, then propose_create_quotation with productIds only.

Marketing emails: ALWAYS call estimate_email_audience before propose_product_announcement_email. intro field = ONE plain sentence, no markdown links/images.

Currency: INR (₹). Dates: Asia/Kolkata.`
}

function parseToolCalls(text: string): { calls: { name: string; rawInput: string }[]; remainder: string } {
  const calls: { name: string; rawInput: string }[] = []
  const re = /<tool_use\s+name="([^"]+)">\s*([\s\S]*?)\s*<\/tool_use>/g
  let m
  let remainder = text
  while ((m = re.exec(text)) !== null) {
    calls.push({ name: m[1], rawInput: m[2] })
  }
  remainder = text.replace(re, '').trim()
  return { calls, remainder }
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
    } catch (err) { console.error("[route]", err) }
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
      body: method === 'GET' || method === 'HEAD' ? undefined : (body || undefined),
    })
    let parsed: unknown
    try { parsed = await res.json() } catch { parsed = await res.text().catch(() => null) }
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

  const history = await queryMany<{ role: string; content: string }>(
    `SELECT role, content FROM admin_agent_messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC
     LIMIT $2`,
    [conversationId, HISTORY_TRUNCATE]
  )

  const systemPrompt = await buildSystemPromptWithDynamic()
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: systemPrompt },
  ]
  for (const h of history) {
    if (h.role === 'user' || h.role === 'assistant') {
      messages.push({ role: h.role, content: h.content })
    }
  }

  const toolCallRecords: ToolCallRecord[] = []
  const proposedActions: Array<{ id: string; kind: string; payload: any; confirmation: string }> = []
  const pickers: Array<{ choice_kind: string; options: Array<{ id: string; label: string; sublabel?: string }>; note?: string }> = []
  let finalText = ''
  let finalUiBlocks: any[] = []
  let provider = ''
  let model = ''
  let consecutiveStalls = 0

  try {
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const r = await aiChat({
        modelHint: 'agent',
        jsonMode: false,
        temperature: 0.2,
        maxTokens: 3000,
        messages,
      })
      provider = r.provider
      model = r.model

      const { calls, remainder } = parseToolCalls(r.content)

      if (calls.length === 0) {
        const text = remainder || r.content
        const stallRe = /\b(let me|i'?ll|i will|now i|first,? i|i'?m going to|let's start|hold on|please hold|fetching|i'?ll fetch|i'?ll check|i'?ll look|i'?ll retrieve|moment|step 1|retrieving|i need to)\b/i
        const isShortPromise = text.length < 320 && stallRe.test(text)
        // Detect hallucinated answers: model answered with product/order/price data without calling a tool
        const looksLikeDataAnswer = iter === 0 && /\b(₹|\bsku\b|in stock|out of stock|\bprice\b.*\d|\bstock\b.*\d|\border number\b)/i.test(text)
        const shouldRetry = (isShortPromise || looksLikeDataAnswer) && consecutiveStalls < 2 && iter < MAX_ITERATIONS - 1
        if (shouldRetry) {
          consecutiveStalls++
          messages.push({ role: 'assistant', content: r.content })
          messages.push({
            role: 'user',
            content: '[system] You answered without calling a tool. That data is INVENTED — it does not come from this store\'s database. You MUST call a tool to get real data. Emit the <tool_use> block now. Do not write any text before it.',
          })
          continue
        }
        consecutiveStalls = 0
        const ui = parseUiBlocks(text)
        finalText = ui.remainder
        finalUiBlocks = ui.blocks
        break
      }
      consecutiveStalls = 0

      messages.push({ role: 'assistant', content: r.content })

      const toolOutputs: string[] = []
      for (const c of calls) {
        const tool = getTool(c.name)
        let parsed: Record<string, unknown> = {}
        try { parsed = JSON.parse(c.rawInput || '{}') } catch (err) { console.error("[route]", err) }

        if (!tool) {
          const err = `Unknown tool: ${c.name}`
          toolCallRecords.push({ tool: c.name, input: parsed, output: err, isError: true })
          toolOutputs.push(`<tool_result name="${c.name}">${err}</tool_result>`)
          continue
        }

        try {
          const out = await tool.handler(parsed)
          toolCallRecords.push({ tool: c.name, input: parsed, output: out })

          if (out && typeof out === 'object' && (out as any).marker === '__call_admin_api_immediate__') {
            const o = out as any
            const apiOut = await invokeAdminApiInternal(o.method, o.path, null, req)
            toolCallRecords[toolCallRecords.length - 1] = { tool: c.name, input: parsed, output: apiOut, isError: !apiOut.ok }
            toolOutputs.push(`<tool_result name="${c.name}">${JSON.stringify(apiOut).slice(0, 8000)}</tool_result>`)
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
            toolOutputs.push(`<tool_result name="${c.name}">${JSON.stringify({ ...o, action_id: inserted?.id })}</tool_result>`)
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
            toolOutputs.push(`<tool_result name="${c.name}">${JSON.stringify({ ...o, action_id: inserted?.id })}</tool_result>`)
          } else if (out && typeof out === 'object' && (out as any).needs_choice === true) {
            const o = out as any
            pickers.push({
              choice_kind: o.choice_kind,
              options: o.options || [],
              note: o.note,
            })
            toolOutputs.push(`<tool_result name="${c.name}">${JSON.stringify(out).slice(0, 4000)}</tool_result>`)
          } else {
            toolOutputs.push(`<tool_result name="${c.name}">${JSON.stringify(out).slice(0, 8000)}</tool_result>`)
          }
        } catch (err: any) {
          const msg = String(err?.message || err)
          toolCallRecords.push({ tool: c.name, input: parsed, output: msg, isError: true })
          toolOutputs.push(`<tool_result name="${c.name}">Error: ${msg}</tool_result>`)
        }
      }

      messages.push({ role: 'user', content: toolOutputs.join('\n') })
    }
  } catch (err: any) {
    const msg = err instanceof AiClientError ? err.message : String(err?.message || 'AI request failed')
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  if (!finalText && finalUiBlocks.length === 0) {
    finalText = 'I ran into the iteration limit before reaching a final answer. Try a simpler question or break it into steps.'
  }

  await query(
    `INSERT INTO admin_agent_messages (admin_id, conversation_id, role, content, tool_calls, ui_blocks, proposed_actions, pickers)
     VALUES ($1, $2, 'assistant', $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb)`,
    [admin.adminId, conversationId, finalText, JSON.stringify(toolCallRecords), JSON.stringify(finalUiBlocks), JSON.stringify(proposedActions), JSON.stringify(pickers)]
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
