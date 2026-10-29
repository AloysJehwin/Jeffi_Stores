import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { adminContactHtml } from '@/lib/email'
import { renderTemplate } from '@/lib/templates/variables'
import { applyMailTheme } from '@/lib/shared/mail-template'
import { storeMailTheme } from '@/lib/catalog/brand'
import { orderMailVars, unfilledTokens } from '@/lib/orders/customer-mail'
import { PAGES } from '@/lib/messaging/placements'

export const dynamic = 'force-dynamic'

// POST — exactly what the customer will get (same shell, logo, colours and order details), plus the
// tokens that are still unfilled; Send refuses until they are filled or removed.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'orders:read'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  // Writing to a customer by hand is the mailer module. The route lives under /orders/, which
  // every plan has, so without this check the plan restriction could be bypassed from here.
  if (!hasScope(admin.role, admin.scopes, 'mailer:write'))
    return NextResponse.json({ error: 'Custom customer emails are not included in your plan.' }, { status: 403 })

  const b = await request.json().catch(() => ({}))
  const subject = String(b.subject ?? '')
  const body = String(b.body ?? '')
  const preheader = String(b.preheader ?? '')
  const texts = [subject, body, preheader]
  const ctx = await orderMailVars(id, { itemId: b.itemId || null, usesPaymentLink: texts.some(t => /payment_url/i.test(t)) })
  if (!ctx) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const scenario = PAGES.order.scenarios.find(s => s.id === b.scenario) ?? null
  const finalSubject = renderTemplate(subject.trim(), ctx.vars)
  const html = await adminContactHtml(finalSubject, renderTemplate(body.trim(), ctx.vars, { escape: true }), {
    isHtml: true,
    layout: b.layout === 'template' ? 'template' : 'message',
    preheader: renderTemplate(preheader, ctx.vars),
  })
  return NextResponse.json({
    subject: finalSubject,
    html: applyMailTheme(html, { ...(await storeMailTheme()), replyHint: !!scenario?.reply }),
    missing: unfilledTokens(texts, ctx.vars),
  })
}
