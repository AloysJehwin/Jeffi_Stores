import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { aiChat, AiClientError } from '@/lib/ai-client'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer')) {
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

  const systemPrompt = `You are an email marketing copywriter for Jeffi Stores, an Indian e-commerce store selling industrial tools, fasteners, and hardware.

Your job: generate a JSON object describing one email-campaign template that EXACTLY matches the trigger context the admin gave you.

Return ONLY valid JSON with these keys:
- "name": short human-readable campaign name (3-6 words; no words like "campaign" or "email")
- "kind": lowercase snake_case slug derived from name (max 32 chars, [a-z0-9_])
- "subject_template": email subject line (under 80 chars, may use {firstName}, {orderNumber}, {productName}, {discountPercent})
- "body_template": clean HTML email body using inline styles only

CRITICAL CONTEXT RULES:
1. The campaign FIRES because of the scenario's trigger. Match the tone to the trigger:
   - Cart/checkout abandonment → urgent but warm, "complete your order", reference items left behind
   - Post-purchase / thank-you → grateful, no upsell pressure, reference order number
   - Review reminder → simple ask, link to leave review
   - Win-back / dormant → "we miss you", offer a coupon
   - Restock → exclamatory, "back in stock", show the specific product
   - Price drop → savings-focused, show old vs new price
   - New customer welcome / featured products → friendly intro, showcase top picks
2. NEVER write "new arrivals" copy unless the trigger description literally mentions new products or arrivals.
3. NEVER mention discounts/coupons unless discountPercent > 0 OR the scenario explicitly involves a coupon.

VARIABLE RULES (the system does plain string substitution {token} → value, no JS expressions):
- {firstName} — recipient's first name
- {orderNumber} — present for order-triggered scenarios (cart abandon, post-purchase, review)
- {couponCode} — present when discountPercent > 0 OR a coupon is assigned
- {discountPercent} — only meaningful when > 0
- {productName}, {productImageUrl}, {oldPrice}, {newPrice} — single-product scenarios (restock, price-drop).
- {productCard} — pre-rendered HTML card with the product's image and price. Use this for single-product scenarios.
- {itemsHtml} — pre-rendered HTML table of items WITH THUMBNAIL IMAGES (used in cart abandon, abandoned checkout, post-purchase, review reminder, winback, custom scenarios that select products). DROP THIS IN AS-IS where you want the gallery to appear. Do NOT wrap in <ul>/<li> or try to format it; it's a complete <table>.
- {itemCount} — number of items
- {ctaUrl} — call-to-action link

PRODUCT IMAGES ARE MANDATORY (HARD RULE — body_template will be REJECTED otherwise):
- If your email refers to a SINGLE product (single-product scenarios like restock, price_drop, or any scenario that mentions a specific product), the body_template MUST include the literal token {productCard}. Do NOT manually build an <img src="{productImageUrl}"> — use {productCard}, which renders a fully-styled image + name + price card.
- If your email refers to MULTIPLE products (cart abandon, post-purchase, review reminder, winback, featured products, recommendations, etc.), the body_template MUST include the literal token {itemsHtml}. Do NOT manually iterate or fabricate <img> tags — use {itemsHtml}, which renders the gallery with thumbnails.
- If the email does NOT mention any product at all (pure thank-you, account notice, simple discount blast, generic announcement), you MAY omit both tokens — but you also MUST NOT use {productName}, {productImageUrl}, {oldPrice}, {newPrice}, {itemCount}, or any product-related copy in that case.
- Bottom line: as soon as your copy says "your items", "this product", "your cart", "back in stock", "your favorites", or anything similar, the body MUST include {productCard} or {itemsHtml}. No exceptions.

NEVER write conditional / templating syntax like {x ? a : b}, {{x}}, {%if x%}, etc. Substitution is plain {token}.

LAYOUT RULES:
- Inline CSS only. No <style>, no <script>, no external links to CSS.
- Body width ~600px max, mobile-friendly. Use <table> for layout, not flex.
- A single primary CTA button styled with bg #e07b3f, white text, padded ~12px 28px.
- Headings #1a3a4a, body text #333.
- Always greet with "Hi {firstName},".

If the scenario is one of these built-in kinds, follow the convention:
- abandoned_cart: include {itemsHtml} after a short "you left these in your cart" line
- abandoned_checkout: include {itemsHtml} and reference {orderNumber}
- post_purchase: thank for {orderNumber}, include {itemsHtml}, no discount push
- review_reminder: ask for review for items in {itemsHtml}, link is per-item review URL
- winback_90 / winback_180: include {couponCode} prominently, optional {itemsHtml} as a teaser
- restock: use {productCard} once
- price_drop: use {productCard} (it already shows old vs new price)
- custom scenarios with product_sql: include {itemsHtml}`

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

  let text = ''
  try {
    const r = await aiChat({
      modelHint: 'copy',
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

  let parsed: { name?: string; kind?: string; subject_template?: string; body_template?: string }
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    console.error('[route]', err)
    return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 502 })
  }

  if (!parsed.subject_template || !parsed.body_template) {
    return NextResponse.json({ error: 'AI response missing required fields' }, { status: 502 })
  }

  const kind = (parsed.kind || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)

  return NextResponse.json({
    name: (parsed.name || '').slice(0, 120),
    kind,
    subject_template: parsed.subject_template.slice(0, 500),
    body_template: parsed.body_template.slice(0, 50000),
  })
}
