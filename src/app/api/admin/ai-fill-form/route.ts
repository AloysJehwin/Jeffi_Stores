import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'

const OLLAMA_URL = () =>
  (process.env.OLLAMA_BASE_URL || 'http://100.82.208.8:11434').replace(/\/$/, '')
const OLLAMA_MODEL = () =>
  process.env.OLLAMA_ENRICH_MODEL || 'gemma3:4b'

const SYSTEM_PROMPT = `You are a form-filling assistant for an Indian B2B/B2C hardware and tools store (jeffistores.com).
Given a scenario description and a list of form fields with their types, return a JSON object with values for each field.
Rules:
- Return ONLY a JSON object where keys are the field names provided and values are the filled content.
- Fill only the fields you have enough context for. Leave others as empty string "".
- Keep values concise and professional. No marketing fluff.
- For boolean fields return true or false (not strings).
- For number fields return a number (not a string).
- For text/description fields: 1-3 clear sentences max.
- Strict JSON only. No explanation, no markdown, no extra keys.`

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { scenario?: string; fields?: { name: string; type: string; label: string }[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { scenario, fields } = body
  if (!scenario || typeof scenario !== 'string' || scenario.trim().length < 3) {
    return NextResponse.json({ error: 'Scenario too short' }, { status: 400 })
  }
  if (!fields || !Array.isArray(fields) || fields.length === 0) {
    return NextResponse.json({ error: 'No fields provided' }, { status: 400 })
  }

  const fieldList = fields.map(f => `- ${f.name} (${f.label}, type: ${f.type})`).join('\n')
  const schema = `{${fields.map(f => `"${f.name}":"<value>"`).join(',')}}`

  const userPrompt = `Scenario: ${scenario.trim()}

Fill these form fields based on the scenario above:
${fieldList}

Return JSON matching this schema exactly:
${schema}`

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
      signal: AbortSignal.timeout(60000),
    })

    if (!res.ok) {
      return NextResponse.json({ error: `AI service error (${res.status})` }, { status: 503 })
    }

    const data = await res.json() as { message?: { content?: string } }
    const raw = data.message?.content || ''

    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(raw)
    } catch {
      const m = raw.match(/\{[\s\S]*\}/)
      if (!m) return NextResponse.json({ error: 'AI returned unparseable response' }, { status: 502 })
      obj = JSON.parse(m[0])
    }

    return NextResponse.json({ fields: obj })
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.name === 'TimeoutError'
    return NextResponse.json(
      { error: isTimeout ? 'AI request timed out' : 'AI service error' },
      { status: 503 }
    )
  }
}
