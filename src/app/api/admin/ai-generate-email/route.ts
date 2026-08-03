import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'

export const maxDuration = 120
export const dynamic = 'force-dynamic'

const OLLAMA_URL = () =>
  (process.env.OLLAMA_BASE_URL || 'http://100.82.208.8:11434').replace(/\/$/, '')
const OLLAMA_MODEL = () =>
  process.env.OLLAMA_COPY_MODEL || process.env.OLLAMA_ENRICH_MODEL || 'gemma3:4b'

const SYSTEM_PROMPT = `You are an email-copywriting assistant for Jeffi Stores, an Indian B2B/B2C industrial hardware and tools store.

Generate a clean, professional email body in INLINE-STYLED HTML based on the scenario given.

Rules:
- Return ONLY a JSON object: {"html":"<email body html>"}
- HTML must use inline styles only. Use only: p, h2, h3, strong, em, br, ul, li, a, hr.
- Do NOT include <html>, <head>, <body> or <!DOCTYPE>.
- Colors: headings #1a3a4a, body #444, links/accent #e07b3f.
- Keep it short: 3-5 paragraphs max, bullet lists for items.
- Include ONE call-to-action button styled as: <a href="https://jeffistores.in" style="display:inline-block;background:#e07b3f;color:#fff;text-decoration:none;padding:10px 22px;border-radius:5px;font-weight:600;">Shop Now</a>
- Use {customer_first_name} for greeting. Never hardcode real names.
- Strict JSON only. No markdown, no explanation.`

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  let body: { scenario?: string; subject?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const scenario = (body.scenario || '').trim()
  if (scenario.length < 10) {
    return NextResponse.json({ error: 'Describe the scenario in at least 10 characters' }, { status: 400 })
  }

  const userPrompt = [
    body.subject ? `Subject line: ${body.subject}` : null,
    `Scenario:`,
    scenario,
    `Generate the HTML email body now.`,
  ].filter(Boolean).join('\n')

  try {
    // Use streaming=true so bytes flow continuously — prevents dev proxy idle timeout
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
        options: { temperature: 0.5 },
      }),
    })

    if (!res.ok || !res.body) {
      return NextResponse.json({ error: `AI service error (${res.status})` }, { status: 503 })
    }

    // Collect streamed chunks into full response
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let fullContent = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      for (const line of chunk.split('\n')) {
        const t = line.trim()
        if (!t) continue
        try {
          const msg = JSON.parse(t) as { message?: { content?: string }; done?: boolean }
          if (msg.message?.content) fullContent += msg.message.content
          if (msg.done) break
        } catch { /* partial line */ }
      }
    }

    let obj: { html?: string }
    try {
      obj = JSON.parse(fullContent)
    } catch {
      const m = fullContent.match(/\{[\s\S]*\}/)
      if (!m) return NextResponse.json({ error: 'AI returned unparseable response' }, { status: 502 })
      obj = JSON.parse(m[0])
    }

    const html = String(obj.html || '').trim()
    if (!html) return NextResponse.json({ error: 'AI returned empty result' }, { status: 502 })

    return NextResponse.json({ html })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ error: `AI service error: ${msg}` }, { status: 503 })
  }
}
