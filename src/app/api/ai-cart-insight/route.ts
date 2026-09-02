export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'
import { storeDescriptorForPrompt } from '@/lib/brand'

const OLLAMA_URL = () =>
  (process.env.OLLAMA_BASE_URL || 'http://100.82.208.8:11434').replace(/\/$/, '')
const OLLAMA_MODEL = () =>
  process.env.OLLAMA_ENRICH_MODEL || 'gemma3:4b'

export const dynamic = 'force-dynamic'

interface CartLine { name?: string; category?: string | null; brand?: string | null; qty?: number }

// Server (Ollama) fallback for the on-device cart-insight one-liner. Mirrors
// buildCartInsightPrompt() intent for devices where on-device is off/unsupported.
export async function POST(request: NextRequest) {
  let body: { cart?: CartLine[] }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const cart = Array.isArray(body.cart) ? body.cart.slice(0, 12) : []
  if (cart.length === 0) return NextResponse.json({ error: 'cart required' }, { status: 400 })

  const cartLines = cart
    .map(it => {
      const meta = [it.brand, it.category].filter(Boolean).join(', ')
      return `- ${it.qty ?? 1}x ${String(it.name || '').trim()}${meta ? ` (${meta})` : ''}`
    })
    .join('\n')

  const prompt =
    `You are a friendly shopping assistant for ${await storeDescriptorForPrompt()}. ` +
    'In one short sentence (max 20 words), describe what the customer is building or working on based on their cart. ' +
    'Be specific and practical. Do not mention prices.\n\n' +
    `### Cart\n${cartLines}\n\n` +
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
