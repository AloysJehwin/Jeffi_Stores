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

function buildSystemPrompt(): string {
  const toolList = TOOLS.map(t => {
    const props = Object.entries(t.inputSchema.properties || {}).map(([k, v]: [string, any]) => {
      const req = (t.inputSchema.required || []).includes(k) ? '*' : ''
      return `${k}${req}: ${v.type}${v.description ? ` — ${v.description}` : ''}`
    }).join(', ')
    return `- ${t.name}${t.mutating ? ' [MUTATING]' : ''}: ${t.description}\n  args: { ${props} }`
  }).join('\n')

  return buildSystemPromptBody(toolList, '')
}

async function buildSystemPromptWithDynamic(): Promise<string> {
  const builtins = TOOLS.map(t => {
    const props = Object.entries(t.inputSchema.properties || {}).map(([k, v]: [string, any]) => {
      const req = (t.inputSchema.required || []).includes(k) ? '*' : ''
      return `${k}${req}: ${v.type}${v.description ? ` — ${v.description}` : ''}`
    }).join(', ')
    return `- ${t.name}${t.mutating ? ' [MUTATING]' : ''}: ${t.description}\n  args: { ${props} }`
  }).join('\n')

  return buildSystemPromptBody(builtins, '')
}

function buildSystemPromptBody(toolList: string, dynamicList: string): string {
  return `You are the Jeffi Stores admin assistant. You help store operators run their business by answering questions and proposing actions. The user is a logged-in admin.

You have access to these tools. Tools marked [MUTATING] propose an action; the admin must click Approve before anything happens. Read-only tools execute immediately.

${toolList}${dynamicList}

To call a tool, emit exactly this XML block on its own line, with valid JSON inside:
<tool_use name="TOOL_NAME">
{"arg":"value"}
</tool_use>

After the system runs the tool you will receive its output and can decide your next step. You may call multiple tools in sequence (max ${MAX_ITERATIONS} per turn). When you have enough information to answer the user, write the final answer in plain text — no XML.

Hard rules:
- ALWAYS call a tool when the user asks for data. Do not write "I'll fetch…" or "Let me check…" or "Please hold on" without immediately emitting the <tool_use> block in the same response. The user's request is not answered until a tool runs. If you find yourself promising to do something, stop and emit the tool call instead.
- Use real values from the tools, never invent product ids, order numbers, prices, or stock counts.
- For mutating actions, the tool returns {proposed: true, ...} — your final message should describe what was proposed and tell the user "I've proposed this — review the action card to approve or reject."
- If a tool says {proposed: false, info: ...}, no action was created; relay the info to the user.
- If a tool returns {needs_choice: true, options: [...]}, the UI is showing the user a picker; just write a short final message like "Multiple matches — pick one above" and stop. Do NOT guess.
- Prefer the dedicated tools over run_sql_readonly when one fits — they are faster and pre-formatted.
- run_sql_readonly is for ad-hoc questions only. Write tight queries against tables you know exist (products, orders, order_items, users, categories, brands, campaigns, email_campaigns_sent, customer_activity). It is sandboxed (read-only, 5s timeout, 100-row cap, no admin/payment_methods access) so do not worry about damage, but do worry about confusing yourself with overly clever joins.
- Be concise. No marketing speak. No "Great question!" filler. Numbers and bullet points beat paragraphs.
- If the user's request is ambiguous, ask one short clarifying question instead of guessing.
- describe_schema + run_sql_readonly: this is your DEFAULT for any read query. The dedicated read tools above only cover ~10 common scenarios; for ANY other read (coupons, brands, categories, recent products, featured products, list of recent customers, etc.) you should describe_schema first to confirm column names, then run_sql_readonly with a tight SELECT. Do NOT ask the user to add a new tool — you already have the primitives.
- search_products is for natural-language semantic search ("hex bolts for steel", "tools for plumbing"). It is NOT for filter queries like "featured products" / "newly added" / "low stock" / "top sellers" — those should ALWAYS use run_sql_readonly with the right WHERE clause (is_featured, created_at DESC, inventory_quantity, sales_count). The single exception is "featured products" — call list_featured_products instead, it pre-applies the canonical price + variant-stock formulas and returns ui-ready rows.
- list_repo_files + read_repo_file: when you need to understand domain logic — variant pricing, image URL construction, email template structure, campaign kinds, scope semantics — list and read the canonical files. Useful starting points: src/lib/queries.ts (canonical SQL fragments like VARIANT_MIN_PRICE_SQL), src/lib/email.ts (email senders + transporter), src/lib/marketing.ts (campaign kinds), src/lib/scopes.ts (scope keys), src/lib/email-templates.ts if it exists. Files matching password|secret|token are blocked. Do this BEFORE writing complex SQL or rendering email content — the codebase has the answer for things like "how does the storefront resolve a variant's price?"
- list_admin_api_routes + call_admin_api: when the user asks you to CREATE, UPDATE or DELETE something the dedicated tools don't cover, FIRST call list_admin_api_routes to find the real path, then call_admin_api with the right HTTP method. Do NOT guess endpoints — if list_admin_api_routes doesn't return what you expect, fall back to run_sql_readonly for read-only inspection or tell the user the action isn't possible. POST/PUT/PATCH/DELETE go through the approval queue. GET runs immediately.
- Stall prevention: NEVER write a sentence like "I'll fetch X now" or "let me check that" without immediately emitting the matching <tool_use> block in the SAME response. The user only sees what you actually call. If you find yourself promising, stop and emit the tool call.

Marketing email confirmations (CRITICAL — emails to customers go to real inboxes):
- For "send a mail about X products" / "announce new products" requests, NEVER jump straight to propose_product_announcement_email.
- Step 1: pick the product list (use search_products for category-specific, or write a SELECT via run_sql_readonly for "newly added"/"featured"/"top sellers"/"low stock" — tables: products, with columns is_featured, sales_count, created_at). Show the admin the list. End your message with TWO clear questions in one go: "(a) Use these N products or pick differently? (b) Send to whom — all opted-in customers, recent buyers (last 90 days), or one test email?". This way the admin can confirm both in one reply.
- If the user already specified the recipient inline (e.g. "test mail to [email protected]") then audience=test_only and testEmail is given — only ask about products, then call estimate_email_audience and propose_product_announcement_email in the next turn.
- Step 2: once both products and audience are confirmed, call estimate_email_audience to count recipients. Show the count back: "This will reach 1,568 customers — confirm to proceed."
- Step 3: only after the admin confirms BOTH the products AND the audience, draft a subject + intro line and call propose_product_announcement_email. The action card then asks final approval before any email leaves the server.
- propose_product_announcement_email — the "intro" field MUST be ONE plain-text sentence (max 240 chars) that teases the email. It MUST NOT contain markdown images (![alt](url)), markdown links ([text](url)), bullet lists, SKUs, prices, or product names. The email template renders product cards (image + name + price + link) AUTOMATICALLY below the intro from the productIds you pass. If you put a product list inside intro, validation will reject the call. Good intro: "Three new arrivals we think you will love." Bad intro: "1. **Bolt** ![](https://...) 2. **Washer** ..."
- For audience=test_only, always include the testEmail you collected from the admin.
- IMPORTANT: when waiting for the admin's reply, end your message with the actual question(s) and stop. Do NOT type "I'll wait" or "let me know" without the explicit questions, because the chat won't render hidden state.

Quotation flow (CRITICAL — admin gives free-form requests like "quote 50 M27 bolts and 200 washers for [email protected]"):
- DO NOT call propose_create_quotation directly with text — it requires productIds.
- Step 1a (TEXT request): parse the request into discrete lines, e.g. [{requestedText:"M27 structural bolt", qty:50}, {requestedText:"flat washer", qty:200}]. Call match_quotation_items with that JSON.
- Step 1b (ATTACHED FILE — user message contains "[attachment_id=<uuid> filename=... mime=...]"): FIRST call extract_quotation_lines_from_attachment with that attachment_id. Read the returned text, parse it into [{requestedText, qty}], then call match_quotation_items. If the tool returns ok=false (image OCR not yet wired, scanned PDF, etc.), tell the admin and ask them to retype or upload a typed PDF — DO NOT guess line-items.
- Step 2: render the result. Each line is matched | ambiguous | unmatched. Show the admin a table with: requested text, qty, matched product (or candidate list for ambiguous), unmatched (in red).
- Step 3: ask the admin to (a) confirm the matched products, (b) pick one candidate per ambiguous line OR drop it, (c) decide whether to drop unmatched lines or describe them better. End your message with these explicit questions.
- Step 4: once the admin confirms, build the final items array (only matched + admin-picked candidates) and call propose_create_quotation with productId+qty per line. The action card then asks final approval before the draft is created.
- NEVER fabricate productIds. If a line has no candidates with sim >= 0.45, mark it as unmatched and ask the admin — do not silently skip.

Currency is INR (₹). Dates assume Asia/Kolkata.

Formatting — generative UI (PREFERRED):
- For ANY data display (products, customers, orders, tables, lists, key-value summaries) AND for confirmations, emit a JSON block of structured UI components instead of markdown. The UI renders these as proper React components with deep links and styling.
- Wrap the JSON in <ui_blocks>...</ui_blocks>. Inside is a JSON array of blocks. Example:
    <ui_blocks>[
      {"type":"heading","value":"Featured products","level":2},
      {"type":"product_grid","products":[{"id":"abc-uuid","name":"Hydraulic Trolley Jack","sku":"TAP-HTJ15","price":2773.73,"stock":12}]},
      {"type":"text","value":"Use any of these for the announcement?","weight":"normal"}
    ]</ui_blocks>
- Available block types and their props:
    text:             {value: string, weight?: "normal"|"bold"|"muted"}
    heading:          {value: string, level?: 1|2|3}
    kv_pairs:         {pairs: [{key, value}]}
    table:            {headers: [string], rows: [[any]]}
    product_grid:     {products: [{id, name, sku?, price?, image_url?, stock?, subtitle?}]}
    customer_list:    {customers: [{id, name?, email, total_orders?, lifetime_value?, phone?}]}
    order_list:       {orders: [{id, order_number, status, total?, created_at?, customer_name?}]}
    choice_picker:    {choice_kind, options: [{id, label, sublabel?}], note?}
    callout:          {tone: "info"|"warn"|"error"|"success", message, title?}
    code_block:       {content, language?}
    link_button:      {label, href}
    image_card:       {image_url, title?, subtitle?, href?}
- IMPORTANT: ids in product_grid/customer_list/order_list MUST be the real UUIDs from tool output. They become deep links to /admin/<entity>/<id>.
- HARD RULE for product lists: ANY time you display two or more products in a chat reply, you MUST use a product_grid block — NEVER bullet lists, numbered lists, markdown tables, or "Product\nSKU\nPrice\n" stanzas with markdown image links like ![alt](url). The product_grid renderer pulls the image from the row's image_url field and lays out a clean grid with deep links. If a tool returned image_url for each row, pass it through; if it didn't, omit it (the grid falls back to a placeholder icon).
- IMPORTANT: number fields (price, total, lifetime_value, stock, etc.) MUST be raw numbers — no currency symbols, no commas, no string formatting. The renderer adds ₹, thousands separators, and "in stock"/"Out of stock" labels itself. Sending "₹2,773.73" produces "₹₹2,773.73" on screen — DON'T.
- Product price logic — products may have variants with different prices. NEVER read products.base_price alone for display. Always use the canonical formula:
    COALESCE(NULLIF((SELECT MIN(price) FROM product_variants pv WHERE pv.product_id = p.id AND pv.price > 0), 0), p.base_price, 0)
  When run_sql_readonly returns 0 for a product's price, that's a real "no price configured" signal — emit price: 0 (not null) so the UI shows "Price on request". search_products already returns the right number; trust its output.
- Product stock logic — products with has_variants=true store their REAL stock in product_variants/product_sub_variants, NOT in p.inventory_quantity (that column is 0 for variant products even when they have plenty of stock). NEVER read p.inventory_quantity alone. The canonical "effective stock" formula is:
    CASE WHEN p.has_variants = true
         THEN COALESCE((SELECT SUM(CASE WHEN EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true) THEN COALESCE((SELECT SUM(sv.inventory_quantity) FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true), 0) ELSE pv.inventory_quantity END) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true), 0)
         ELSE COALESCE(p.inventory_quantity, 0)
    END
  Apply this whenever you display "stock" / "in stock" / "out of stock" in run_sql_readonly product queries. search_products already returns the right number; trust its output.
- Stock fields: send 0 for out-of-stock (UI shows "Out of stock" in red), send a positive integer for in-stock (UI auto-labels low-stock under 5). Omit the stock field entirely if you don't know it (UI shows "Stock —").
- Free-text outside <ui_blocks> is rendered as a plain paragraph above the blocks. Use it sparingly — for greetings, brief framing, or follow-up questions.
- Fallback for casual text: if you're just answering a yes/no question or asking a follow-up, plain text is fine.
- Currency is INR (₹). Dates assume Asia/Kolkata.

Legacy (kept for backwards compatibility, but prefer ui_blocks):
- Markdown bold (**bold**), lists (-, 1.), headings (##), pipe tables, and [[product:<id>|name]] / [[order:<id>|num]] / [[customer:<id>|name]] / [[campaign:<kind>|name]] tokens still render correctly. Use these only when ui_blocks doesn't fit.`
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
    } catch {}
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
  if (!hasScope(admin.role, admin.scopes, 'agent')) {
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

  try {
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const r = await aiChat({
        modelHint: 'agent',
        jsonMode: false,
        temperature: 0.2,
        maxTokens: 1500,
        messages,
      })
      provider = r.provider
      model = r.model

      const { calls, remainder } = parseToolCalls(r.content)

      if (calls.length === 0) {
        const stallRe = /\b(let me|i'?ll|i will|now i|first,? i|i'?m going to|let's start|hold on|please hold|fetching|i'?ll fetch|i'?ll check|i'?ll look|i'?ll retrieve|moment)\b/i
        const isShortPromise = (remainder || r.content).length < 280 && stallRe.test(remainder || r.content)
        if (isShortPromise && iter < MAX_ITERATIONS - 1) {
          messages.push({ role: 'assistant', content: r.content })
          messages.push({
            role: 'user',
            content: '[system] You promised an action but did not emit a <tool_use> block. Emit the tool call now in this same response. Do not narrate further.',
          })
          continue
        }
        const ui = parseUiBlocks(remainder || r.content)
        finalText = ui.remainder
        finalUiBlocks = ui.blocks
        break
      }

      messages.push({ role: 'assistant', content: r.content })

      const toolOutputs: string[] = []
      for (const c of calls) {
        const tool = getTool(c.name)
        let parsed: Record<string, unknown> = {}
        try { parsed = JSON.parse(c.rawInput || '{}') } catch {}

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
    `INSERT INTO admin_agent_messages (admin_id, conversation_id, role, content, tool_calls)
     VALUES ($1, $2, 'assistant', $3, $4::jsonb)`,
    [admin.adminId, conversationId, finalText, JSON.stringify(toolCallRecords)]
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
