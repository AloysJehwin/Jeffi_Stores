export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'
import { storefrontAiGate, storefrontAiField } from '@/lib/storefront-ai'
import { storeDescriptorForPrompt } from '@/lib/brand'

export const dynamic = 'force-dynamic'

interface CartLine { name?: string; category?: string | null; brand?: string | null; qty?: number }

// Server-side (Ollama on the Razer box) fallback for the on-device checkout recap.
// Used when the in-browser model is disabled/unsupported on the device (e.g. mobile).
// Mirrors the intent of buildRecapPrompt() in src/lib/on-device/prompt.ts but builds
// its own inline prompt (the on-device prompt format is a fine-tune contract; the
// server model is a general gemma3:4b, so we prompt it plainly).
export async function POST(request: NextRequest) {
  const blocked = await storefrontAiGate()
  if (blocked) return blocked

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
    `You are a friendly shopping assistant for ${await storeDescriptorForPrompt()}. ` +
    'Write a warm, concise 2-3 sentence recap of what the customer is about to buy, noting how the items fit together and reassuring them. ' +
    'Do not invent products or prices.\n\n' +
    `### Cart\n${cartLines}${summary ? `\nSummary: ${summary}` : ''}\n\n` +
    'Return JSON: {"text":"<recap>"}'

  return storefrontAiField(prompt, 'text')
}
