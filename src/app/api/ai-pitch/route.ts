import { NextRequest, NextResponse } from 'next/server'

const OLLAMA_URL = () =>
  (process.env.OLLAMA_BASE_URL || 'http://100.82.208.8:11434').replace(/\/$/, '')
const OLLAMA_MODEL = () =>
  process.env.OLLAMA_ENRICH_MODEL || 'gemma3:4b'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  let body: { productName?: string; brand?: string | null; category?: string | null }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { productName, brand, category } = body
  if (!productName || typeof productName !== 'string' || productName.trim().length < 2) {
    return NextResponse.json({ error: 'productName required' }, { status: 400 })
  }

  const context = [productName.trim(), brand, category].filter(Boolean).join(', ')
  const prompt = `Write exactly one sentence (max 20 words) describing what this product is and who it is best for. Be specific about the use case. No prices, no marketing fluff.\n\nProduct: ${context}\n\nReturn JSON: {"pitch":"<one sentence>"}`

  try {
    const res = await fetch(`${OLLAMA_URL()}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL(),
        stream: false,
        format: 'json',
        messages: [{ role: 'user', content: prompt }],
        options: { temperature: 0.3 },
      }),
      signal: AbortSignal.timeout(30000),
    })

    if (!res.ok) return NextResponse.json({ error: 'AI unavailable' }, { status: 503 })

    const data = await res.json() as { message?: { content?: string } }
    const raw = data.message?.content || ''

    let obj: { pitch?: string }
    try { obj = JSON.parse(raw) } catch {
      const m = raw.match(/\{[\s\S]*\}/)
      if (!m) return NextResponse.json({ error: 'Bad AI response' }, { status: 502 })
      obj = JSON.parse(m[0])
    }

    const pitch = String(obj.pitch || '').trim()
    if (!pitch) return NextResponse.json({ error: 'Empty result' }, { status: 502 })

    return NextResponse.json({ pitch })
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.name === 'TimeoutError'
    return NextResponse.json({ error: isTimeout ? 'Timed out' : 'AI unavailable' }, { status: 503 })
  }
}
