import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { normalizeQuery } from '@jeffi/list-filters'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { parseBody, zNonEmpty } from '@/lib/shared/validate'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { ORDERS_ENTITY } from '@/lib/filters/entities/orders'
import { orderListMailTemplates } from '@/lib/orders/customer-mail'
import { BULK_MAIL_CAP, BULK_MAIL_INLINE, bulkMailSummary, ordersForMail, sendOrdersMail, type BulkMailResult } from '@/lib/orders/bulk-mail'

export const dynamic = 'force-dynamic'

// The Orders list's Mail button: one email per order to the customers of every order the list's
// filters match. The filters travel as the same query string the list page has (as the CSV export does).

const PLAN_ERROR = 'Custom customer emails are not included in your plan.'

/** Who may: the orders scope for the list, and the mailer module for writing to customers by hand. */
async function authorize(request: NextRequest, ordersScope: 'orders:read' | 'orders:write') {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, ordersScope)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  if (!hasScope(admin.role, admin.scopes, 'mailer:write')) return NextResponse.json({ error: PLAN_ERROR }, { status: 403 })
  return admin
}

function matching(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  return ordersForMail(normalizeQuery(ORDERS_ENTITY, sp), { sort: sp.get('sort') ?? undefined, dir: sp.get('dir') ?? undefined })
}

// GET — how many orders the filters match, and the templates offered for them.
export async function GET(request: NextRequest) {
  const admin = await authorize(request, 'orders:read')
  if (admin instanceof NextResponse) return admin
  const [{ orders, capped }, templates] = await Promise.all([matching(request), orderListMailTemplates().catch(() => [])])
  return NextResponse.json({
    count: orders.length,
    capped,
    cap: BULK_MAIL_CAP,
    // The preview is rendered with this order's details.
    sample: orders[0] ? { orderNumber: orders[0].orderNumber } : null,
    templates,
  })
}

const Schema = z.object({
  subject: zNonEmpty,
  body: zNonEmpty,
  preheader: z.string().max(200).optional(),
  isHtml: z.boolean().optional(),
  layout: z.enum(['template', 'message', 'raw']).optional(),
  scenario: z.string().max(40).optional(),
  // How many orders the administrator was shown: a list that changed since is not emailed blind.
  count: z.number().int().min(1),
})

// POST — send. A few orders are sent while the request waits; more run on after the response and
// leave their outcome in the audit log. Every email is in its own order's mail log either way.
export async function POST(request: NextRequest) {
  const admin = await authorize(request, 'orders:write')
  if (admin instanceof NextResponse) return admin
  const parsed = parseBody(Schema, await request.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const { count, ...mail } = parsed.data

  const { orders, capped } = await matching(request)
  if (capped)
    return NextResponse.json({ error: `More than ${BULK_MAIL_CAP} orders match. Narrow the filters and send in smaller batches.` }, { status: 400 })
  if (!orders.length) return NextResponse.json({ error: 'No orders match these filters.' }, { status: 400 })
  if (orders.length !== count)
    return NextResponse.json(
      { error: `The list changed: ${orders.length} orders match these filters now, not ${count}. Check and send again.`, count: orders.length },
      { status: 409 }
    )

  const query = request.nextUrl.searchParams.toString()
  const run = async (): Promise<BulkMailResult> => {
    const result = await sendOrdersMail(orders, mail)
    await logAdminAudit({
      adminId: admin.adminId,
      action: 'create',
      entityType: 'orders',
      summary: `Order list email "${mail.subject.trim().slice(0, 80)}": ${bulkMailSummary(result)}`,
      metadata: { query, ...result },
      request,
    }).catch(() => {})
    return result
  }

  if (orders.length <= BULK_MAIL_INLINE) {
    const result = await run()
    return NextResponse.json({ success: true, done: true, ...result, summary: bulkMailSummary(result) })
  }
  void run().catch(err => console.error('[orders/bulk-mail]', err))
  return NextResponse.json({ success: true, done: false, total: orders.length })
}
