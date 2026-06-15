import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { TEMPLATE_VARS } from '@/lib/template-vars'

const OLLAMA_URL = () =>
  (process.env.OLLAMA_BASE_URL || 'http://100.82.208.8:11434').replace(/\/$/, '')
const OLLAMA_MODEL = () =>
  process.env.OLLAMA_COPY_MODEL || process.env.OLLAMA_AGENT_MODEL || 'qwen3:14b'

const VAR_LIST = TEMPLATE_VARS.map(v => `{${v.key}} (${v.description})`).join('\n')

const SYSTEM_PROMPT = `You are an email-copywriting assistant for Jeffi Stores, an Indian B2B/B2C industrial hardware and tools store.

You will be given a SCENARIO describing the email the user wants to send. Generate a clean, friendly, professional email body in INLINE-STYLED HTML suitable for an email client.

Rules:
- Return ONLY a JSON object with a single key "html" containing the email body HTML.
- HTML must be email-safe: inline styles only (no external CSS, no <style> blocks, no <script>).
- Use these tags only: p, h1-h4, strong, em, u, br, ul, ol, li, a, table, tr, td, blockquote, hr.
- Do not include <html>, <head>, <body>, or <!DOCTYPE> — output only the BODY content; the layout will be wrapped by our email shell.
- For colors, prefer: heading #1a3a4a, body #444, links + accent #e07b3f.
- Keep paragraphs short (1-3 sentences). Use bullet lists when listing items.
- Include exactly ONE call-to-action where it makes sense, styled like:
  <a href="https://jeffistores.in" style="display:inline-block;background:#e07b3f;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;">Shop Now</a>
- Personalisation: insert {customer_first_name} for the greeting and {customer_name} where a full name fits. NEVER hardcode a real name.
- Other available variables (use them where appropriate):
${VAR_LIST}
- Strict JSON output. No prose, no markdown fences, no extra keys.

Schema: {"html":"<email body html>"}`

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer')) {
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
        options: { temperature: 0.5 },
      }),
      signal: AbortSignal.timeout(45000),
    })

    if (!res.ok) {
      return NextResponse.json({ error: `AI service error (${res.status})` }, { status: 503 })
    }

    const data = (await res.json()) as { message?: { content?: string } }
    const raw = data.message?.content || ''

    let obj: { html?: string }
    try {
      obj = JSON.parse(raw)
    } catch {
      const m = raw.match(/\{[\s\S]*\}/)
      if (!m) return NextResponse.json({ error: 'AI returned unparseable response' }, { status: 502 })
      obj = JSON.parse(m[0])
    }

    const html = String(obj.html || '').trim()
    if (!html) return NextResponse.json({ error: 'AI returned empty result' }, { status: 502 })

    return NextResponse.json({ html })
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.name === 'TimeoutError'
    return NextResponse.json(
      { error: isTimeout ? 'AI request timed out' : 'AI service error' },
      { status: 503 }
    )
  }
}
