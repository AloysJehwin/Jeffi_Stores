import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { storeBaseUrlAsync, campaignMailFromAsync } from '@/lib/catalog/brand'
import { resolveTemplateVariables } from '@/lib/templates/variables'
import { sendAuditedMail } from '@/lib/shared/mail-audit'
import { broadcastScenario, hasEmailContent } from '@/lib/messaging/broadcast-shared'
import { loadAttachments, loadBroadcastCoupon, loadBroadcastTemplate, renderBroadcastEmail } from '@/lib/messaging/broadcast-email'

export const dynamic = 'force-dynamic'

// POST — the composer's email exactly as a customer gets it (layout, coupon, attachments), sent to the admin.
export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  if (!admin.email) return NextResponse.json({ error: 'Your admin account has no email address' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const email = body.channels?.email
  if (!hasEmailContent(email)) return NextResponse.json({ error: 'Pick a template or write the email first' }, { status: 400 })

  const [{ template, missing }, coupon] = await Promise.all([loadBroadcastTemplate(email), loadBroadcastCoupon(body.coupon_id)])
  if (missing) return NextResponse.json({ error: 'That email template no longer exists' }, { status: 404 })
  let attachments
  try {
    attachments = await loadAttachments(email.attachments)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }

  const registered = await resolveTemplateVariables({
    recipient: { email: admin.email, first_name: admin.first_name ?? null, last_name: admin.last_name ?? null },
  })
  const r = renderBroadcastEmail({
    email, template, registered, baseUrl: await storeBaseUrlAsync(), fallbackSubject: String(body.subject || 'Message'),
    scenario: broadcastScenario(admin.first_name, coupon, email.vars), unsubscribeUrl: '#',
  })
  try {
    await sendAuditedMail({
      from: await campaignMailFromAsync(),
      to: admin.email,
      subject: `[Test] ${r.subject}`,
      html: r.html,
      kind: 'campaign_test',
      templateName: template?.slug ?? 'messaging/custom',
      ...(email.reply_to ? { replyTo: email.reply_to } : {}),
      ...(attachments.length ? { attachments } : {}),
    })
  } catch (e) {
    return NextResponse.json({ error: `Send failed: ${(e as Error).message}` }, { status: 502 })
  }
  return NextResponse.json({ ok: true, to: admin.email })
}
