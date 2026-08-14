export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'

const OLLAMA_URL = () =>
  (process.env.OLLAMA_BASE_URL || 'http://100.82.208.8:11434').replace(/\/$/, '')
const OLLAMA_MODEL = () =>
  process.env.OLLAMA_ENRICH_MODEL || 'gemma3:4b'

export const dynamic = 'force-dynamic'

interface CartLine { name?: string; category?: string | null; brand?: string | null; qty?: number }

// Server-side (Ollama on the Razer box) fallback for the on-device checkout recap.
// Used when the in-browser model is disabled/unsupported on the device (e.g. mobile).
// Mirrors the intent of buildRecapPrompt() in src/lib/on-device/prompt.ts but builds
// its own inline prompt (the on-device prompt format is a fine-tune contract; the
// server model is a general gemma3:4b, so we prompt it plainly).
export async function POST(request: NextRequest) {
  let body: { cart?: CartLine[]; total?: number | null; itemCount?: number | null }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const cart = Array.isArray(body.cart) ? body.cart.slice(0, 12) : []
  if (cart.length === 0) return NextResponse.json({ error: 'cart required' }, { status: 400 })

  const cartLines = cart
    .map(it => {
      const meta = [it.brand, it.category].filter(Boolean).join(', ')
      return `- ${it.qty ?? 1}x ${String(it.name || '').trim()}${meta ? ` (${meta})` : ''}`
    })
    .join('\n')
  const summary = [
    body.itemCount != null ? `${body.itemCount} items` : null,
    body.total != null ? `total Rs.${Number(body.total).toFixed(2)}` : null,
  ].filter(Boolean).join(', ')

  const prompt =
    'You are a friendly shopping assistant for an industrial hardware store. ' +
    'Write a warm, concise 2-3 sentence recap of what the customer is about to buy, noting how the items fit together and reassuring them. ' +
    'Do not invent products or prices.\n\n' +
    `### Cart\n${cartLines}${summary ? `\nSummary: ${summary}` : ''}\n\n` +
    'Return JSON: {"text":"<recap>"}'

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
