export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'
import { storefrontAiGate, storefrontAiField } from '@/lib/storefront-ai'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const blocked = await storefrontAiGate()
  if (blocked) return blocked

  let body: { productName?: string; brand?: string | null; category?: string | null }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { productName, brand, category } = body
  if (!productName || typeof productName !== 'string' || productName.trim().length < 2) {
    return NextResponse.json({ error: 'productName required' }, { status: 400 })
  }

  const context = [productName.trim(), brand, category].filter(Boolean).join(', ')
  const prompt = `Write exactly one sentence (max 20 words) describing what this product is and who it is best for. Be specific about the use case. No prices, no marketing fluff.\n\nProduct: ${context}\n\nReturn JSON: {"pitch":"<one sentence>"}`

  return storefrontAiField(prompt, 'pitch')
}
