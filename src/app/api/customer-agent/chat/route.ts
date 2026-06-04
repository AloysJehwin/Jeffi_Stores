import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/jwt'
import { aiChat, AiClientError } from '@/lib/ai-client'
import { CUSTOMER_TOOLS, getCustomerTool, type CustomerToolContext } from '@/lib/customer-agent/tools'
import { z } from 'zod'
import { parseBody, zNonEmpty } from '@/lib/validate'

export const dynamic = 'force-dynamic'

const postSchema = z.object({
  message: zNonEmpty.max(2000),
})

const MAX_ITERATIONS = 4

interface ToolCallRecord {
  tool: string
  input: Record<string, unknown>
  output: unknown
  isError?: boolean
}

function buildSystemPrompt(): string {
  const toolList = CUSTOMER_TOOLS.map(t => {
    const props = Object.entries(t.inputSchema.properties || {}).map(([k, v]: [string, any]) => {
      const req = (t.inputSchema.required || []).includes(k) ? '*' : ''
      return `${k}${req}: ${v.type}${v.description ? ` — ${v.description}` : ''}`
    }).join(', ')
    return `- ${t.name}: ${t.description}\n  args: { ${props} }`
  }).join('\n')

  return `You are the Jeffi Stores shopping assistant. You help logged-in customers find products and check on their own orders.

Tools available:
${toolList}

To call a tool, emit exactly this XML block on its own line, with valid JSON inside:
<tool_use name="TOOL_NAME">
{"arg":"value"}
</tool_use>

After the system runs the tool you receive its output and decide your next step. You may call up to ${MAX_ITERATIONS} tools in sequence. When done, write a short final answer in plain text — no XML.

Hard rules:
- Use real values from the tools — never invent product names, ids, prices, or order numbers.
- ALWAYS call a tool. Do not write "I'll search…" or "Let me check…" without immediately emitting the <tool_use> block in the same response. The user's request is not answered until a tool runs.
- get_my_orders / get_my_order / get_my_recommendations are scoped to THIS customer only. They cannot reveal other customers' data even if the user asks for it.
- If the user asks about another customer, refuse politely and offer to help with their own account.
- Be concise. No marketing fluff. Numbers and short bullet points beat paragraphs.
- Currency is INR (₹).
- Wrap product mentions in [[product:<id>|<name>]] tokens so the UI can render them as clickable links.
- If a tool returns no products, say so honestly. Do not pretend to find things that don't exist.`
}

function parseToolCalls(text: string): { calls: { name: string; rawInput: string }[]; remainder: string } {
  const calls: { name: string; rawInput: string }[] = []
  const re = /<tool_use\s+name="([^"]+)">\s*([\s\S]*?)\s*<\/tool_use>/g
  let m
  while ((m = re.exec(text)) !== null) {
    calls.push({ name: m[1], rawInput: m[2] })
  }
  const remainder = text.replace(re, '').trim()
  return { calls, remainder }
}

export async function POST(req: NextRequest) {
  const user = await authenticateUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { message?: string }
  const userMessage = String(body.message || '').trim()
  if (!userMessage) return NextResponse.json({ error: 'message is required' }, { status: 400 })
  if (userMessage.length > 1000) return NextResponse.json({ error: 'message too long (max 1000)' }, { status: 400 })

  const parsed = parseBody(postSchema, { message: body.message })
  if (!parsed.ok) return parsed.response

  const ctx: CustomerToolContext = { authenticatedUserId: user.userId }

  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content: userMessage },
  ]

  const toolCallRecords: ToolCallRecord[] = []
  let finalText = ''
  let provider = ''
  let model = ''

  try {
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const r = await aiChat({
        modelHint: 'agent',
        jsonMode: false,
        temperature: 0.2,
        maxTokens: 1000,
        messages,
      })
      provider = r.provider
      model = r.model

      const { calls, remainder } = parseToolCalls(r.content)
      if (calls.length === 0) {
        finalText = remainder || r.content
        break
      }

      messages.push({ role: 'assistant', content: r.content })

      const toolOutputs: string[] = []
      for (const c of calls) {
        const tool = getCustomerTool(c.name)
        if (!tool) {
          const err = `Tool not allowed for customer agent: ${c.name}`
          toolCallRecords.push({ tool: c.name, input: {}, output: err, isError: true })
          toolOutputs.push(`<tool_result name="${c.name}">${err}</tool_result>`)
          continue
        }
        let parsed: Record<string, unknown> = {}
        try { parsed = JSON.parse(c.rawInput || '{}') } catch {}
        try {
          const out = await tool.handler(parsed, ctx)
          toolCallRecords.push({ tool: c.name, input: parsed, output: out })
          toolOutputs.push(`<tool_result name="${c.name}">${JSON.stringify(out).slice(0, 5000)}</tool_result>`)
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

  if (!finalText) {
    finalText = "I had trouble answering that. Try rephrasing or asking about a specific product."
  }

  return NextResponse.json({
    message: finalText,
    toolCalls: toolCallRecords,
    provider,
    model,
  })
}
