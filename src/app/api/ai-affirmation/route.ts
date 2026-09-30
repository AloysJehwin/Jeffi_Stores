export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'
import { storefrontAiGate, storefrontAiField } from '@/lib/storefront-ai'
import { storeDescriptorForPrompt } from '@/lib/brand'

export const dynamic = 'force-dynamic'

// Server (Ollama) fallback for the on-device post-purchase affirmation. Mirrors
// buildAffirmationPrompt() intent for devices where on-device is off/unsupported.
export async function POST(request: NextRequest) {
  const blocked = await storefrontAiGate()
  if (blocked) return blocked

  let body: { itemNames?: string[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const items = Array.isArray(body.itemNames)
    ? body.itemNames
        .map(n => String(n || '').trim())
        .filter(Boolean)
        .slice(0, 5)
    : []
  if (items.length === 0) return NextResponse.json({ error: 'itemNames required' }, { status: 400 })

  const prompt =
    `You are a friendly shopping assistant for ${await storeDescriptorForPrompt()}. ` +
    "Write one warm sentence (max 20 words) affirming the customer's purchase decision. Reference what they bought. Do not mention prices.\n\n" +
    `### Purchased\n${items.map(n => `- ${n}`).join('\n')}\n\n` +
    'Return JSON: {"text":"<one sentence>"}'

  return storefrontAiField(prompt, 'text')
}
