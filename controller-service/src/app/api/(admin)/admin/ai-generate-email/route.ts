import { listTemplateVariables } from '@/lib/templates/variables'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { aiChat } from '@/lib/shared/ai-client'
import { aiDenial } from '@/lib/auth/ai-scope'

export const maxDuration = 120
export const dynamic = 'force-dynamic'

// Broadcast messages (Messaging): per-customer values exist, order values don't.
const CAMPAIGN_RULES = `
PLACEMENT — every variable has one right place:
- {customer_first_name}: only in the greeting ("Dear {customer_first_name},"). Never in headings or buttons.
- {couponCode}: in its own highlighted line right above the button, and ONLY inside a conditional block so customers without a coupon don't see an empty code:
  {#if couponCode}<p style="text-align:center;margin:16px 0;font-size:16px;">Use code <strong>{couponCode}</strong> for {discountPercent}% off</p>{/if}
- {discountPercent}: a bare number — always write it as "{discountPercent}% off", and only inside {#if couponCode}…{/if}.
- {store_name}: brand mentions and the sign-off ("— The {store_name} team"). {store_web}/{store_email}/{store_phone}: contact lines only; a URL variable may be an href, but never a button label.
- Date variables ({date}, {current_year}): plain text only.
- Never put a variable inside a button label or an href other than the storefront URL.
- This message is sent to many customers at once: there is no order, so never mention order numbers, tracking or totals.`

const SYSTEM_PROMPT = (store: string, storeUrl: string, variables: string, campaign = false) => `You write marketing/support emails for ${store}.
Return ONLY valid JSON: {"html":"<email body html>"}

STRUCTURE — the html goes inside an existing branded email shell (logo + footer are already added), so output ONLY the body. No <html>/<head>/<body>/<style> tags.

FONT — wrap the ENTIRE body in one container div so every paragraph uses the same fixed font. Start the html with exactly:
  <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;">
…all content goes inside…and end with </div>. Every <p>/<h2>/<li> inherits this font — do NOT set a different font-family anywhere. Do NOT set a text color (color:...) on any element — the email template supplies the correct text color; hard-coding a color breaks the editor's dark theme.

FORMATTING RULES (inline styles only — email clients strip <style>):
- Greeting: first element is <p>Dear {customer_first_name},</p>
- Body: 2-3 short <p> paragraphs.
- Headings (optional): <h2 style="font-size:18px;font-weight:700;margin:16px 0 8px;">Title</h2>
- Lists: <ul style="padding-left:24px;margin:8px 0;"><li>item</li></ul>
- Bold: <strong>text</strong>

LINKS & BUTTONS — NEVER write placeholders like [Tracking Link] or [Link]. Use real anchors.
- Inline link: <a href="URL" target="_blank" rel="noopener" style="color:#e07b3f;text-decoration:underline;">link text</a>
- ALWAYS include exactly ONE call-to-action BUTTON near the end, using this exact markup:
  <p style="text-align:center;margin:24px 0;"><a href="URL" target="_blank" rel="noopener" style="display:inline-block;background:#e07b3f;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;">Button Label</a></p>

URLs — use ${storeUrl} for the storefront. For "track order" / "view order" actions use ${storeUrl}/account/orders. Never invent tracking numbers or fake URLs; if a specific order link isn't known, link to the account orders page.

VARIABLES — insert these tokens verbatim (replaced per recipient at send time). Do NOT wrap them in styling spans. Use every one that fits the message instead of writing the value out:
${variables}
Sign off referencing the {store_name} team. Do not fabricate customer names, codes, prices or order numbers — use variables instead.${campaign ? CAMPAIGN_RULES : ''}`

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denied = aiDenial(admin.role, admin.scopes, 'mailer:write')
  if (denied) return NextResponse.json({ error: denied }, { status: 403 })

  let body: { scenario?: string; subject?: string; variables?: string[]; campaign?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const scenario = (body.scenario || '').trim()
  if (scenario.length < 10) {
    return NextResponse.json({ error: 'Scenario too short' }, { status: 400 })
  }

  const userPrompt = [body.subject ? `Subject: ${body.subject}` : null, scenario].filter(Boolean).join('\n')

  try {
    const { storeDescriptorForPrompt, storeBaseUrlAsync } = await import('@/lib/catalog/brand')
    const [descriptor, storeUrl, defs] = await Promise.all([storeDescriptorForPrompt(), storeBaseUrlAsync(), listTemplateVariables()])
    // Every variable the composer offers: store/customer ones + the ones the caller's template fills.
    const extra = (body.variables ?? []).filter(k => /^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(k) && !defs.some(d => d.key === k)).slice(0, 30)
    const campaign = body.campaign === true
    const variables = [
      ...defs.filter(d => !campaign || d.group !== 'order').map(d => `  {${d.key}} — ${d.label}${d.description ? `: ${d.description}` : ''}`),
      ...(campaign ? ['  {couponCode} — the coupon attached to this message (may be empty)', '  {discountPercent} — that coupon\'s % discount, a bare number'] : []),
      ...extra.filter(k => !campaign || !['couponCode', 'discountPercent', 'firstName'].includes(k)).map(k => `  {${k}} — filled for this message`),
    ].join('\n')
    // 'email' hint = the fast model: the large copy model truncates the HTML mid-JSON.
    const r = await aiChat({
      feature: 'email_copy',
      modelHint: 'email',
      jsonMode: true,
      temperature: 0.3,
      maxTokens: 1500,
      noCache: true,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT(descriptor, storeUrl, variables, campaign) },
        { role: 'user', content: userPrompt },
      ],
    })

    const html = extractHtml(r.content.trim())
    if (!html) {
      return NextResponse.json({ error: 'AI returned empty result' }, { status: 502 })
    }

    return NextResponse.json({ html })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ error: `AI error: ${msg}` }, { status: 503 })
  }
}

// Parse the model's JSON, tolerating markdown fences and — crucially — output
// that was truncated mid-string (a capped num_predict cuts the HTML off, leaving
// invalid JSON). We progressively fall back to extracting the "html" value even
// from a broken object.
function extractHtml(raw: string): string {
  if (!raw) return ''

  const tryParse = (s: string): string | null => {
    try {
      const obj = JSON.parse(s) as { html?: unknown }
      const h = typeof obj.html === 'string' ? obj.html.trim() : ''
      return h || null
    } catch {
      return null
    }
  }

  // 1. Direct parse.
  let html = tryParse(raw)
  if (html) return html

  // 2. Strip markdown fences, then parse.
  const stripped = raw
    .replace(/^```[\w]*\n?/, '')
    .replace(/\n?```$/, '')
    .trim()
  html = tryParse(stripped)
  if (html) return html

  // 3. Parse the first balanced-looking JSON object.
  const match = stripped.match(/\{[\s\S]*\}/)
  if (match) {
    html = tryParse(match[0])
    if (html) return html
  }

  // 4. Salvage a truncated response: grab everything after the "html" key even
  //    if the closing quote/brace never arrived, then unescape it.
  const keyed = stripped.match(/"html"\s*:\s*"([\s\S]*)$/)
  if (keyed) {
    let val = keyed[1]
    // Drop a dangling closing quote/brace if the JSON actually completed.
    val = val.replace(/"\s*\}?\s*$/, '')
    try {
      const unescaped = JSON.parse(`"${val.replace(/"/g, '\\"')}"`)
      return String(unescaped).trim()
    } catch {
      return val.trim()
    }
  }

  return ''
}
