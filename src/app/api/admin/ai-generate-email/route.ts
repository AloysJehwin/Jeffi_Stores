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
    return NextResponse.json({ error: 'Scenario too short' }, { status: 400 })
  }

  const userPrompt = [
    body.subject ? `Subject: ${body.subject}` : null,
    scenario,
  ].filter(Boolean).join('\n')

  try {
    const res = await fetch(`${OLLAMA_URL()}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL(),
        prompt: `${SYSTEM_PROMPT}\n\nUser: ${userPrompt}\n\nAssistant:`,
        stream: false,
        format: 'json',
        options: { temperature: 0.3, num_predict: 600 },
      }),
    })

    if (!res.ok) {
      return NextResponse.json({ error: `AI service error (${res.status})` }, { status: 503 })
    }

    const data = await res.json() as { response?: string }
    const raw = (data.response || '').trim()

    let obj: { html?: string } = {}
    try {
      obj = JSON.parse(raw)
    } catch {
      const stripped = raw.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim()
      try { obj = JSON.parse(stripped) } catch {
        const match = raw.match(/\{[\s\S]*\}/)
        if (match) { try { obj = JSON.parse(match[0]) } catch { /* ignore */ } }
      }
    }

    const html = String(obj.html || '').trim()
    if (!html) {
      return NextResponse.json({ error: 'AI returned empty result' }, { status: 502 })
    }

    return NextResponse.json({ html })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ error: `AI error: ${msg}` }, { status: 503 })
  }
}
