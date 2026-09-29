export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { aiChat } from '@/lib/ai-client'
import { resolveAiScope, parseAiJson, aiDenial } from '@/lib/ai-scope'
import { storeDescriptorForPrompt } from '@/lib/brand'

function systemPrompt(store: string): string {
  return `You are a copywriting assistant for ${store}.
Enrich the given field value to be clearer, more professional, and more useful to buyers and staff.
Rules:
- Return ONLY a JSON object with a single key "result" containing the enriched text.
- Do NOT change factual data — only improve clarity, grammar, completeness, and tone.
- Keep the same language style (if it was brief, keep it brief; if detailed, keep it detailed).
- For descriptions: 1–3 clear sentences, no marketing fluff, focus on what the item is and who uses it.
- For names: correct capitalization and spelling only. Do not rename things.
- Do not assume a product category or industry the store has not described.
- Strict JSON only. No explanation, no markdown, no extra keys.
Schema: {"result":"<enriched value>"}`
}

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { fieldLabel?: string; value?: string; context?: string; scope?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const scope = resolveAiScope(body.scope)
  if (!scope) return NextResponse.json({ error: 'Invalid AI scope' }, { status: 400 })
  const denied = aiDenial(admin.role, admin.scopes, scope)
  if (denied) return NextResponse.json({ error: denied }, { status: 403 })

  const { fieldLabel = 'field', value, context } = body
  if (!value || typeof value !== 'string' || value.trim().length < 2) {
    return NextResponse.json({ error: 'Value too short to enrich' }, { status: 400 })
  }

  const userPrompt = [
    context ? `Context: ${context}` : null,
    `Field: ${fieldLabel}`,
    `Current value: ${value.trim()}`,
    `Enrich this field value.`,
  ].filter(Boolean).join('\n')

  try {
    const r = await aiChat({
      modelHint: 'enrich',
      jsonMode: true,
      temperature: 0.3,
      noCache: true,
      messages: [
        { role: 'system', content: systemPrompt(await storeDescriptorForPrompt()) },
        { role: 'user', content: userPrompt },
      ],
    })
    const obj = parseAiJson<{ result?: string }>(r.content)
    if (!obj) return NextResponse.json({ error: 'AI returned unparseable response' }, { status: 502 })
    const result = String(obj.result || '').trim()
    if (!result) return NextResponse.json({ error: 'AI returned empty result' }, { status: 502 })
    return NextResponse.json({ result })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'AI service error' }, { status: 503 })
  }
}
