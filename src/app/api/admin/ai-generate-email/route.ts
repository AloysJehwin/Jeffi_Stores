import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'

export const maxDuration = 120
export const dynamic = 'force-dynamic'

const OLLAMA_URL = () =>
  (process.env.OLLAMA_BASE_URL || 'http://100.82.208.8:11434').replace(/\/$/, '')
const OLLAMA_MODEL = () =>
  process.env.OLLAMA_COPY_MODEL || process.env.OLLAMA_ENRICH_MODEL || 'gemma3:4b'

const SYSTEM_PROMPT = `Email writer for Jeffi Stores (Indian hardware store).
Return ONLY valid JSON: {"html":"<email body html>"}
Rules: inline styles only, no <html>/<head>/<body>, max 3 paragraphs, one CTA button (#e07b3f background), use {customer_first_name} for greeting.`

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  let body: { scenario?: string; subject?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const scenario = (body.scenario || '').trim()
  if (scenario.length < 10) {
    return NextResponse.json({ error: 'Describe the scenario in at least 10 characters' }, { status: 400 })
  }

  const userPrompt = [
    body.subject ? `Subject: ${body.subject}` : null,
    scenario,
  ].filter(Boolean).join('\n')

  // Use ReadableStream to keep connection alive while Ollama generates
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Send a heartbeat immediately so client knows we're alive
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: 'generating' })}\n\n`))

        const res = await fetch(`${OLLAMA_URL()}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: OLLAMA_MODEL(),
            stream: false,
            format: 'json',
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: userPrompt },
            ],
            options: { temperature: 0.3, num_predict: 600 },
          }),
        })

        if (!res.ok) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: `AI service error (${res.status})` })}\n\n`))
          return
        }

        const data = await res.json() as { message?: { content?: string } }
        const raw = (data.message?.content || '').trim()

        let obj: { html?: string } = {}
        try {
          obj = JSON.parse(raw)
        } catch {
          const m = raw.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim()
          try { obj = JSON.parse(m) } catch {
            const match = raw.match(/\{[\s\S]*\}/)
            if (match) obj = JSON.parse(match[0])
          }
        }

        const html = String(obj.html || '').trim()
        if (html) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ html })}\n\n`))
        } else {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'AI returned empty result' })}\n\n`))
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'unknown'
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: `AI error: ${msg}` })}\n\n`))
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
