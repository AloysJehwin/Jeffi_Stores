import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { prompt, campaignName } = await req.json()
  if (!prompt?.trim()) return NextResponse.json({ error: 'prompt is required' }, { status: 400 })

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'OpenAI not configured' }, { status: 500 })

  const systemPrompt = `You are an email marketing copywriter for Jeffi Stores, an Indian e-commerce store.
Generate an email campaign template. Return ONLY valid JSON with exactly four keys:
- "name": a short human-readable campaign name (e.g. "Summer Sale", "Winback Offer")
- "kind": a slug for the campaign kind — lowercase letters, numbers, underscores only (e.g. "summer_sale", "winback_offer")
- "subject_template": a short email subject line (under 80 chars)
- "body_template": clean HTML email body

Use these template variables where appropriate: {firstName}, {couponCode}, {discountPercent}, {orderNumber}, {productName}, {oldPrice}, {newPrice}, {ctaUrl}, {itemCount}
Keep the HTML clean, mobile-friendly, and brand-appropriate. Use inline styles only. No external CSS or scripts.`

  const userPrompt = `Campaign: ${campaignName || 'New Campaign'}
Prompt: ${prompt.trim()}`

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 2000,
      response_format: { type: 'json_object' },
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    return NextResponse.json({ error: err?.error?.message || 'OpenAI request failed' }, { status: 502 })
  }

  const data = await response.json()
  const text = data.choices?.[0]?.message?.content || ''

  let parsed: { name?: string; kind?: string; subject_template?: string; body_template?: string }
  try {
    parsed = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 502 })
  }

  if (!parsed.subject_template || !parsed.body_template) {
    return NextResponse.json({ error: 'AI response missing required fields' }, { status: 502 })
  }

  const kind = (parsed.kind || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .slice(0, 80)

  return NextResponse.json({
    name: (parsed.name || '').slice(0, 120),
    kind,
    subject_template: parsed.subject_template.slice(0, 500),
    body_template: parsed.body_template.slice(0, 50000),
  })
}
