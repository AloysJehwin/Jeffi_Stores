export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'
import { storefrontAiGate, storefrontAiField } from '@/lib/shared/storefront-ai'
import { storeDescriptorForPrompt } from '@/lib/catalog/brand'

export const dynamic = 'force-dynamic'

interface CartLine {
  name?: string
  category?: string | null
  brand?: string | null
  qty?: number
}

// The cart's one-line insight, written by the store's fast text model through the gateway.
export async function POST(request: NextRequest) {
  const blocked = await storefrontAiGate()
  if (blocked) return blocked

  let body: { cart?: CartLine[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

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
    'In one short sentence (max 20 words), describe what the customer appears to be shopping for based on their cart. ' +
    'Be specific and practical. Do not mention prices.\n\n' +
    `### Cart\n${cartLines}\n\n` +
    'Return JSON: {"text":"<one sentence>"}'

  return storefrontAiField(prompt, 'text', 'storefront_cart_insight')
}
