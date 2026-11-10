import { storeBaseUrlAsync } from '@/lib/catalog/brand'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { renderCampaignEmail } from '@/lib/shared/email-campaigns'
import { bareEmailDoc } from '@/lib/templates/email-layouts'
import { resolveTemplateVariables, sampleVariableMap, renderTemplate } from '@/lib/templates/variables'

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const body = await request.json()
  const { template_key, template_data, subject, channels, layout } = body
  if (!template_key) return NextResponse.json({ error: 'template_key required' }, { status: 400 })

  // Real store values and custom variables; a sample customer.
  const sample = sampleVariableMap()
  const vars = await resolveTemplateVariables({
    recipient: {
      email: sample.customer_email,
      first_name: sample.customer_first_name,
      last_name: sample.customer_last_name,
    },
  })
  const subbedSubject = renderTemplate(subject || '', vars)

  if (template_key === 'library') {
    const { hasEmailContent, broadcastScenario } = await import('@/lib/messaging/broadcast-shared')
    const email = channels?.email
    if (!hasEmailContent(email)) return NextResponse.json({ html: '' })
    const b = await import('@/lib/messaging/broadcast-email')
    const [{ template, missing }, coupon] = await Promise.all([b.loadBroadcastTemplate(email), b.loadBroadcastCoupon(body.coupon_id)])
    if (missing) return NextResponse.json({ html: '' })
    const r = b.renderBroadcastEmail({
      email, template, registered: vars, baseUrl: await storeBaseUrlAsync(), fallbackSubject: subject || '',
      scenario: broadcastScenario(vars.customer_first_name, coupon, email.vars), unsubscribeUrl: '#',
    })
    return NextResponse.json({ html: r.html, subject: r.subject, layout: r.layout })
  }

  // Store layout off: the same document the send stores (see the mailer POST).
  const raw = layout === 'raw'
  const data = raw ? { htmlBody: bareEmailDoc(String(template_data?.body ?? ''), template_data?.preheader) } : template_data || {}
  // Same base the real send uses, so a tenant's preview shows its own store's links.
  const { html } = renderCampaignEmail(
    raw ? 'custom' : template_key,
    { ...data, subject: subbedSubject },
    vars.customer_first_name,
    await storeBaseUrlAsync(),
    vars.store_name,
    vars
  )
  return NextResponse.json({ html })
}
