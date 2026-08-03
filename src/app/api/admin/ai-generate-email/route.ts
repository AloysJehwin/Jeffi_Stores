import { NextRequest } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'

export const maxDuration = 120
export const dynamic = 'force-dynamic'

const OLLAMA_URL = () =>
  (process.env.OLLAMA_BASE_URL || 'http://100.82.208.8:11434').replace(/\/$/, '')
const OLLAMA_MODEL = () =>
  process.env.OLLAMA_COPY_MODEL || process.env.OLLAMA_ENRICH_MODEL || 'gemma3:4b'

const SYSTEM_PROMPT = `Email writer for Jeffi Stores (Indian hardware store).
Return ONLY: {"html":"<body html>"}
Rules: inline styles, no <html>/<head>/<body>, max 3 paragraphs, one CTA button in orange (#e07b3f), use {customer_first_name} for greeting.
CTA style: display:inline-block;background:#e07b3f;color:#fff;padding:10px 22px;border-radius:5px;font-weight:600;text-decoration:none`

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer:write')) {
    return new Response(JSON.stringify({ error: 'Insufficient permissions' }), { status: 403 })
  }

  let body: { scenario?: string; subject?: string }
  try { body = await request.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 })
  }

  const scenario = (body.scenario || '').trim()
  if (scenario.length < 10) {
    return new Response(JSON.stringify({ error: 'Describe the scenario in at least 10 characters' }), { status: 400 })
  }

  const userPrompt = [
    body.subject ? `Subject line: ${body.subject}` : null,
    `Scenario:`, scenario,
    `Generate the HTML email body now.`,
  ].filter(Boolean).join('\n')

  try {
    const res = await fetch(`${OLLAMA_URL()}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL(),
        stream: true,
        format: 'json',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        options: { temperature: 0.3, num_predict: 600 },
      }),
    })

    if (!res.ok || !res.body) {
      return new Response(JSON.stringify({ error: `AI service error (${res.status})` }), { status: 503 })
    }

    // Stream tokens to client as SSE
    const encoder = new TextEncoder()
    const readable = new ReadableStream({
      async start(controller) {
        const reader = res.body!.getReader()
        const decoder = new TextDecoder()
        let fullContent = ''

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            const chunk = decoder.decode(value, { stream: true })
            for (const line of chunk.split('\n')) {
              const t = line.trim()
              if (!t) continue
              try {
                const msg = JSON.parse(t) as { message?: { content?: string }; done?: boolean }
                if (msg.message?.content) {
                  fullContent += msg.message.content
                  // Send token progress as SSE
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: msg.message.content })}\n\n`))
                }
                if (msg.done) break
              } catch { /* partial chunk */ }
            }
          }

          // Parse final JSON and send result
          let obj: { html?: string } = {}
          try { obj = JSON.parse(fullContent) } catch {
            const m = fullContent.match(/\{[\s\S]*\}/)
            if (m) obj = JSON.parse(m[0])
          }
          const html = String(obj.html || '').trim()
          if (html) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ html })}\n\n`))
          } else {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'AI returned empty result' })}\n\n`))
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'unknown'
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: `AI error: ${msg}` })}\n\n`))
        } finally {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        }
      }
    })

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown'
    return new Response(JSON.stringify({ error: `AI service error: ${msg}` }), { status: 503 })
  }
}
