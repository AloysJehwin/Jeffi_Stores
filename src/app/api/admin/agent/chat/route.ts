import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryOne, queryMany } from '@/lib/db'
import { aiChat, AiClientError } from '@/lib/ai-client'
import { TOOLS, getTool } from '@/lib/admin-agent/tools'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

const MAX_ITERATIONS = 5
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

  return `You are the Jeffi Stores admin assistant. You help store operators run their business by answering questions and proposing actions. The user is a logged-in admin.

You have access to these tools. Tools marked [MUTATING] propose an action; the admin must click Approve before anything happens. Read-only tools execute immediately.

${toolList}

To call a tool, emit exactly this XML block on its own line, with valid JSON inside:
<tool_use name="TOOL_NAME">
{"arg":"value"}
</tool_use>

After the system runs the tool you will receive its output and can decide your next step. You may call multiple tools in sequence (max ${MAX_ITERATIONS} per turn). When you have enough information to answer the user, write the final answer in plain text — no XML.

Hard rules:
- Use real values from the tools, never invent product ids, order numbers, prices, or stock counts.
- For mutating actions, the tool returns {proposed: true, ...} — your final message should describe what was proposed and tell the user "I've proposed this — review the action card to approve or reject."
- If a tool says {proposed: false, info: ...}, no action was created; relay the info to the user.
- Be concise. No marketing speak. No "Great question!" filler. Numbers and bullet points beat paragraphs.
- If the user's request is ambiguous, ask one short clarifying question instead of guessing.
- Currency is INR (₹). Dates assume Asia/Kolkata.`
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

  const systemPrompt = buildSystemPrompt()
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
  let finalText = ''
  let provider = ''
  let model = ''

  try {
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const r = await aiChat({
        modelHint: 'copy',
        jsonMode: false,
        temperature: 0.2,
        maxTokens: 1500,
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
        const tool = getTool(c.name)
        if (!tool) {
          const err = `Unknown tool: ${c.name}`
          toolCallRecords.push({ tool: c.name, input: {}, output: err, isError: true })
          toolOutputs.push(`<tool_result name="${c.name}">${err}</tool_result>`)
          continue
        }
        let parsed: Record<string, unknown> = {}
        try { parsed = JSON.parse(c.rawInput || '{}') } catch {}
        try {
          const out = await tool.handler(parsed)
          toolCallRecords.push({ tool: c.name, input: parsed, output: out })

          if (tool.mutating && out && typeof out === 'object' && (out as any).proposed === true) {
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

  if (!finalText) {
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
    toolCalls: toolCallRecords,
    proposedActions,
    provider,
    model,
  })
}
