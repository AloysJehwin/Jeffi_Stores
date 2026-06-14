import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'

const OLLAMA_URL = () =>
  (process.env.OLLAMA_BASE_URL || 'http://100.82.208.8:11434').replace(/\/$/, '')
const OLLAMA_MODEL = () =>
  process.env.OLLAMA_COPY_MODEL || process.env.OLLAMA_AGENT_MODEL || 'qwen3:14b'

const SYSTEM_PROMPT = `You are a copywriting assistant for an Indian B2B/B2C hardware and tools store (jeffistores.com).
Enrich the given field value to be clearer, more professional, and more useful to buyers and staff.
Rules:
- Return ONLY a JSON object with a single key "result" containing the enriched text.
- Do NOT change factual data — only improve clarity, grammar, completeness, and tone.
- Keep the same language style (if it was brief, keep it brief; if detailed, keep it detailed).
- For descriptions: 1–3 clear sentences, no marketing fluff, focus on what the item is and who uses it.
- For names: correct capitalization and spelling only. Do not rename things.
- Strict JSON only. No explanation, no markdown, no extra keys.
Schema: {"result":"<enriched value>"}`

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { fieldLabel?: string; value?: string; context?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { fieldLabel = 'field', value, context } = body
  if (!value || typeof value !== 'string' || value.trim().length < 2) {
    return NextResponse.json({ error: 'Value too short to enrich' }, { status: 400 })
  }

  const userPrompt = [
    context ? `Context: ${context}` : null,
    `Field: ${fieldLabel}`,
    `Current value: ${value.trim()}`,
    `Enrich this field value.`,
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
        options: { temperature: 0.3 },
      }),
      signal: AbortSignal.timeout(20000),
    })

    if (!res.ok) {
      return NextResponse.json({ error: `AI service error (${res.status})` }, { status: 503 })
    }

    const data = await res.json() as { message?: { content?: string } }
    const raw = data.message?.content || ''

    let obj: { result?: string }
    try {
      obj = JSON.parse(raw)
    } catch {
      const m = raw.match(/\{[\s\S]*\}/)
      if (!m) return NextResponse.json({ error: 'AI returned unparseable response' }, { status: 502 })
      obj = JSON.parse(m[0])
    }

    const result = String(obj.result || '').trim()
    if (!result) return NextResponse.json({ error: 'AI returned empty result' }, { status: 502 })

    return NextResponse.json({ result })
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.name === 'TimeoutError'
    return NextResponse.json(
      { error: isTimeout ? 'AI request timed out' : 'AI service error' },
      { status: 503 }
    )
  }
}
