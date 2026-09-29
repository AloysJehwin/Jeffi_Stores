export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { aiChat } from '@/lib/ai-client'
import { resolveAiScope, parseAiJson, aiDenial } from '@/lib/ai-scope'
import { storeDescriptorForPrompt } from '@/lib/brand'

function systemPrompt(store: string): string {
  return `You are a form-filling assistant for ${store}.
Given a scenario description and a list of form fields with their types, return a JSON object with values for each field.
Rules:
- Return ONLY a JSON object where keys are the field names provided and values are the filled content.
- Fill only the fields you have enough context for. Leave others as empty string "".
- Keep values concise and professional. No marketing fluff.
- For boolean fields return true or false (not strings).
- For number fields return a number (not a string).
- For text/description fields: 1-3 clear sentences max.
- Do not assume a product category or industry the store has not described.
- Strict JSON only. No explanation, no markdown, no extra keys.`
}

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { scenario?: string; fields?: { name: string; type: string; label: string }[]; scope?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const scope = resolveAiScope(body.scope)
  if (!scope) return NextResponse.json({ error: 'Invalid AI scope' }, { status: 400 })
  const denied = aiDenial(admin.role, admin.scopes, scope)
  if (denied) return NextResponse.json({ error: denied }, { status: 403 })

  const { scenario, fields } = body
  if (!scenario || typeof scenario !== 'string' || scenario.trim().length < 3) {
    return NextResponse.json({ error: 'Scenario too short' }, { status: 400 })
  }
  if (!fields || !Array.isArray(fields) || fields.length === 0) {
    return NextResponse.json({ error: 'No fields provided' }, { status: 400 })
  }

  const fieldList = fields.map(f => `- ${f.name} (${f.label}, type: ${f.type})`).join('\n')
  const schema = `{${fields.map(f => `"${f.name}":"<value>"`).join(',')}}`

  const userPrompt = `Scenario: ${scenario.trim()}

Fill these form fields based on the scenario above:
${fieldList}

Return JSON matching this schema exactly:
${schema}`

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
    const obj = parseAiJson(r.content)
    if (!obj) return NextResponse.json({ error: 'AI returned unparseable response' }, { status: 502 })
    return NextResponse.json({ fields: obj })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'AI service error' }, { status: 503 })
  }
}
