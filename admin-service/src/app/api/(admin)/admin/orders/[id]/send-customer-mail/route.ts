import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { sendAdminContactEmail } from '@/lib/email'
import { parseBody, zNonEmpty } from '@/lib/shared/validate'
import { renderTemplate } from '@/lib/templates/variables'
import { orderMailVars, unfilledTokens } from '@/lib/orders/customer-mail'
import { PAGES } from '@/lib/messaging/placements'
import { askAboutOrder } from '@/lib/replies/ask'

const Schema = z.object({
  subject: zNonEmpty,
  body: zNonEmpty,
  preheader: z.string().max(200).optional(),
  isHtml: z.boolean().optional(),
  layout: z.enum(['template', 'message']).optional(),
  // The order-page scenario the template is for; one whose reply is read sends with a reply address.
  scenario: z.string().max(40).optional(),
  itemId: z.string().uuid().optional(),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'orders:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  // Writing to a customer by hand is the mailer module. The route lives under /orders/, which
  // every plan has, so without this check the plan restriction could be bypassed from here.
  if (!hasScope(admin.role, admin.scopes, 'mailer:write'))
    return NextResponse.json({ error: 'Custom customer emails are not included in your plan.' }, { status: 403 })

  const parsed = parseBody(Schema, await request.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const { subject, body, isHtml, layout, itemId } = parsed.data
  const preheader = parsed.data.preheader ?? ''
  const scenario = PAGES.order.scenarios.find(s => s.id === parsed.data.scenario) ?? null
  if (scenario?.pickItem && !itemId) return NextResponse.json({ error: 'Choose the item this email is about.' }, { status: 400 })

  const texts = [subject, body, preheader]
  const usesPaymentLink = texts.some(t => /payment_url/i.test(t))
  // Check before creating a payment link: a send that would go out with gaps creates nothing.
  const check = await orderMailVars(id, { itemId, usesPaymentLink })
  if (!check) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (!check.recipient.email) return NextResponse.json({ error: 'No customer email for this order' }, { status: 400 })
  const missing = unfilledTokens(texts, check.vars)
  if (missing.length) return NextResponse.json({ error: `Fill in or remove: ${missing.join(', ')}`, missing }, { status: 422 })

  const { vars, recipient } = usesPaymentLink ? (await orderMailVars(id, { itemId, usesPaymentLink, createPaymentLink: true }))! : check
  const send = () =>
    sendAdminContactEmail(recipient.email, recipient.name, renderTemplate(subject.trim(), vars), renderTemplate(body.trim(), vars, { escape: !!isHtml }), {
      isHtml: !!isHtml,
      layout,
      preheader: renderTemplate(preheader, vars),
      entityType: 'orders',
      entityId: id,
    })
  const result = scenario?.reply ? await askAboutOrder(scenario.reply, id, send, scenario.pickItem ? { refId: itemId } : {}) : await send()
  if (!result.success) return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
  return NextResponse.json({ success: true })
}
