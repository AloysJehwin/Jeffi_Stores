import { NextResponse } from 'next/server'
import { aiChat } from '@/lib/ai-client'
import { AI_STOREFRONT_SCOPE, parseAiJson } from '@/lib/ai-scope'

// Shared by the customer-facing AI routes (recap, cart insight, pitch, affirmation). There is no
// admin session on the storefront, so the gate is the tenant's plan alone. The platform's own
// store is never plan-limited (currentTenantPlanGate returns allowed for it).

/** Whether the current store's plan includes storefront AI. */
export async function storefrontAiAllowed(): Promise<boolean> {
  const { currentTenantPlanGate } = await import('@/lib/plan-gate')
  return (await currentTenantPlanGate(AI_STOREFRONT_SCOPE)).allowed
}

/** 403 response when the store's plan does not include storefront AI, else null. */
export async function storefrontAiGate(): Promise<NextResponse | null> {
  const { currentTenantPlanGate } = await import('@/lib/plan-gate')
  const gate = await currentTenantPlanGate(AI_STOREFRONT_SCOPE)
  if (gate.allowed) return null
  return NextResponse.json(
    { error: "AI is not included in this store's plan", upgradeRequired: gate.upgradeRequired },
    { status: 403 }
  )
}

/** Run a single JSON-mode prompt through the gateway and return the named string field. */
export async function storefrontAiField(prompt: string, field: string): Promise<NextResponse> {
  try {
    const r = await aiChat({
      modelHint: 'enrich',
      jsonMode: true,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }],
    })
    const obj = parseAiJson<Record<string, unknown>>(r.content)
    if (!obj) return NextResponse.json({ error: 'Bad AI response' }, { status: 502 })
    const value = String(obj[field] || '').trim()
    if (!value) return NextResponse.json({ error: 'Empty result' }, { status: 502 })
    return NextResponse.json({ [field]: value })
  } catch {
    return NextResponse.json({ error: 'AI unavailable' }, { status: 503 })
  }
}
