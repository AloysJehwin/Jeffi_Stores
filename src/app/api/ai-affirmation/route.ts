export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'
import { storeDescriptorForPrompt } from '@/lib/brand'

const OLLAMA_URL = () =>
  (process.env.OLLAMA_BASE_URL || 'http://100.82.208.8:11434').replace(/\/$/, '')
const OLLAMA_MODEL = () =>
  process.env.OLLAMA_ENRICH_MODEL || 'gemma3:4b'

export const dynamic = 'force-dynamic'

// Server (Ollama) fallback for the on-device post-purchase affirmation. Mirrors
// buildAffirmationPrompt() intent for devices where on-device is off/unsupported.
export async function POST(request: NextRequest) {
  let body: { itemNames?: string[] }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const items = Array.isArray(body.itemNames)
    ? body.itemNames.map(n => String(n || '').trim()).filter(Boolean).slice(0, 5)
    : []
  if (items.length === 0) return NextResponse.json({ error: 'itemNames required' }, { status: 400 })

  const prompt =
    `You are a friendly shopping assistant for ${await storeDescriptorForPrompt()}. ` +
    'Write one warm sentence (max 20 words) affirming the customer\'s purchase decision. Reference what they bought. Do not mention prices.\n\n' +
    `### Purchased\n${items.map(n => `- ${n}`).join('\n')}\n\n` +
    'Return JSON: {"text":"<one sentence>"}'

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

    let obj: { text?: string }
    try { obj = JSON.parse(raw) } catch {
      const m = raw.match(/\{[\s\S]*\}/)
      if (!m) return NextResponse.json({ error: 'Bad AI response' }, { status: 502 })
      obj = JSON.parse(m[0])
    }

    const text = String(obj.text || '').trim()
    if (!text) return NextResponse.json({ error: 'Empty result' }, { status: 502 })

    return NextResponse.json({ text })
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.name === 'TimeoutError'
    return NextResponse.json({ error: isTimeout ? 'Timed out' : 'AI unavailable' }, { status: 503 })
  }
}
