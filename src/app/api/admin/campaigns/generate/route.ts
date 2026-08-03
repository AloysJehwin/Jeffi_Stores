import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { aiChat, AiClientError } from '@/lib/ai-client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_ATTEMPTS = 3

// Parse the model's JSON, tolerating markdown fences and leading prose. Returns
// the object, or null if nothing parseable was found.
function tryParse(text: string): { name?: string; kind?: string; subject_template?: string; body_template?: string } | null {
  try {
    return JSON.parse(text)
  } catch {
    const match = text.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0])
    } catch {
      return null
    }
  }
}

export async function POST(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  const campaignName = typeof body.campaignName === 'string' ? body.campaignName : ''
  const scenarioKind = typeof body.scenarioKind === 'string' ? body.scenarioKind : ''
  const scenarioName = typeof body.scenarioName === 'string' ? body.scenarioName : ''
  const scenarioDescription = typeof body.scenarioDescription === 'string' ? body.scenarioDescription : ''
  const scenarioTrigger = typeof body.scenarioTrigger === 'string' ? body.scenarioTrigger : ''
  const discountPercent = typeof body.discountPercent === 'number' ? body.discountPercent : 0

  if (!prompt) return NextResponse.json({ error: 'prompt is required' }, { status: 400 })

  const systemPrompt = `You write ONE email-campaign template for Jeffi Stores (Indian e-commerce: industrial tools, fasteners, hardware).

Output ONLY this JSON object, nothing else. All 4 keys must be non-empty:
{"name":"","kind":"","subject_template":"","body_template":""}

Fill each key:
- name: 3-6 words, no words "campaign"/"email".
- kind: snake_case slug from name, [a-z0-9_], max 32 chars.
- subject_template: under 80 chars, may use {firstName}.
- body_template: full HTML email BODY only — the branded shell already adds the Jeffi Stores logo header and footer, so do NOT add a logo, header image, or footer yourself. Inline styles ONLY (no <style>/<script>/external CSS). ~600px <table> layout. Greet "Hi {firstName},". Exactly one CTA button: background #e07b3f, white text, padding 12px 28px, href {ctaUrl}. Headings #1a3a4a, body text #333.

Variables are PLAIN {token} substitution only. NEVER use {x ? a : b}, {{x}}, or {%if%}. Allowed tokens:
{firstName} {orderNumber} {couponCode} {discountPercent} {productName} {productCard} {itemsHtml} {itemCount} {ctaUrl}

PRODUCT IMAGE RULE (mandatory):
- Multiple products (cart, abandoned checkout, post-purchase, review reminder, winback, featured/recommendations): body MUST contain the literal token {itemsHtml}. Drop it in as-is; it is a complete <table>.
- Single product (restock, price_drop): body MUST contain the literal token {productCard}.
- No product mentioned (plain thank-you / notice / generic blast): use NEITHER token and no product copy.
- Never hand-write <img> tags for products.

Only mention discounts/coupons ({couponCode}, {discountPercent}) if discountPercent > 0.

Match tone to the trigger context given by the user (cart abandon = warm urgency; post-purchase = grateful, no upsell; review = simple ask; winback/dormant = "we miss you" + coupon; restock = "back in stock"; price_drop = savings; welcome/featured = friendly intro).`

  const contextLines: string[] = []
  if (scenarioKind || scenarioName) {
    contextLines.push(`Scenario kind: ${scenarioKind || 'custom'}`)
    if (scenarioName) contextLines.push(`Scenario name: ${scenarioName}`)
    if (scenarioDescription) contextLines.push(`Scenario description: ${scenarioDescription}`)
    if (scenarioTrigger) contextLines.push(`When it fires: ${scenarioTrigger}`)
  } else {
    contextLines.push(`Scenario: not yet selected — write generic copy.`)
  }
  if (discountPercent > 0) contextLines.push(`Discount: ${discountPercent}% (you may reference {couponCode} and {discountPercent})`)
  else contextLines.push(`Discount: 0% (do not mention coupons or discounts)`)
  contextLines.push(`Campaign label (admin-facing): ${campaignName || '(no name yet)'}`)
  contextLines.push(`Admin instructions: ${prompt}`)

  const userPrompt = contextLines.join('\n')

  // The fast model (gemma3:4b) is reliable with this condensed prompt but
  // occasionally returns an empty {} — which fails fast (~0.5s), so retry it a
  // couple of times. Transport errors (unreachable/timeout) are NOT retried.
  let parsed: { name?: string; kind?: string; subject_template?: string; body_template?: string } | null = null
  let lastError = 'AI response missing required fields'

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let text = ''
    try {
      const r = await aiChat({
        modelHint: 'fast',
        jsonMode: true,
        temperature: 0.6,
        maxTokens: 2000,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      })
      text = r.content
    } catch (err) {
      const message = err instanceof AiClientError ? err.message : 'AI request failed'
      return NextResponse.json({ error: message }, { status: 502 })
    }

    const candidate = tryParse(text)
    if (candidate?.subject_template && candidate?.body_template) {
      parsed = candidate
      break
    }
    lastError = candidate ? 'AI response missing required fields' : 'Failed to parse AI response'
  }

  if (!parsed) {
    return NextResponse.json({ error: lastError }, { status: 502 })
  }

  const kind = (parsed.kind || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)

  return NextResponse.json({
    name: (parsed.name || '').slice(0, 120),
    kind,
    subject_template: parsed.subject_template!.slice(0, 500),
    body_template: parsed.body_template!.slice(0, 50000),
  })
}
