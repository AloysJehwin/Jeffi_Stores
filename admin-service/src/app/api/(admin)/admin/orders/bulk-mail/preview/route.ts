import { NextRequest, NextResponse } from 'next/server'
import { normalizeQuery } from '@jeffi/list-filters'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { adminContactHtml } from '@/lib/email'
import { renderTemplate } from '@/lib/templates/variables'
import { applyMailTheme } from '@/lib/shared/mail-template'
import { storeMailTheme } from '@/lib/catalog/brand'
import { ORDERS_ENTITY } from '@/lib/filters/entities/orders'
import { orderMailVars, unfilledTokens } from '@/lib/orders/customer-mail'
import { ordersForMail } from '@/lib/orders/bulk-mail'
import { PAGES } from '@/lib/messaging/placements'

export const dynamic = 'force-dynamic'

// POST — the email as the customer of the list's first order will get it, plus the tokens that
// order has nothing for. Other orders may differ: one with a gap is skipped when the email is sent.
export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'orders:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  if (!hasScope(admin.role, admin.scopes, 'mailer:write'))
    return NextResponse.json({ error: 'Custom customer emails are not included in your plan.' }, { status: 403 })

  const sp = request.nextUrl.searchParams
  const { orders } = await ordersForMail(normalizeQuery(ORDERS_ENTITY, sp), { sort: sp.get('sort') ?? undefined, dir: sp.get('dir') ?? undefined, cap: 1 })
  if (!orders[0]) return NextResponse.json({ error: 'No orders match these filters.' }, { status: 404 })

  const b = await request.json().catch(() => ({}))
  const subject = String(b.subject ?? '')
  const body = String(b.body ?? '')
  const preheader = String(b.preheader ?? '')
  const texts = [subject, body, preheader]
  const ctx = await orderMailVars(orders[0].id, { usesPaymentLink: texts.some(t => /payment_url/i.test(t)) })
  if (!ctx) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const scenario = PAGES.order.scenarios.find(s => s.id === b.scenario) ?? null
  const finalSubject = renderTemplate(subject.trim(), ctx.vars)
  const html = await adminContactHtml(finalSubject, renderTemplate(body.trim(), ctx.vars, { escape: true }), {
    isHtml: true,
    layout: b.layout === 'template' || b.layout === 'raw' ? b.layout : 'message',
    preheader: renderTemplate(preheader, ctx.vars),
  })
  return NextResponse.json({
    subject: finalSubject,
    html: applyMailTheme(html, { ...(await storeMailTheme()), replyHint: !!scenario?.reply }),
    missing: unfilledTokens(texts, ctx.vars),
    sample: { orderNumber: orders[0].orderNumber },
  })
}
