import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany } from '@/lib/db'
import { logActivity } from '@/lib/activity'
import { WA_TEMPLATE_REGISTRY, sendTemplateByKey, sendFreeTextWhatsApp } from '@/lib/whatsapp'
import { APP_URL } from '@/lib/automation-emails'

export const dynamic = 'force-dynamic'

function last10(phone: string | null | undefined): string {
  return String(phone || '').replace(/\D/g, '').slice(-10)
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'customers:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const user = await queryOne<{ phone: string | null; email: string | null }>('SELECT email, phone FROM users WHERE id = $1', [id])
  const phone = user?.phone ?? null
  const email = user?.email ?? null
  const digits = last10(phone)

  let thread: any[] = []
  if (digits) {
    thread = await queryMany(
      `SELECT id, direction, to_number, from_number, body, kind, status, error, provider_sid, sent_at
       FROM message_logs
       WHERE channel = 'whatsapp'
         AND (regexp_replace(to_number, '\\D', '', 'g') LIKE '%' || $1
              OR regexp_replace(from_number, '\\D', '', 'g') LIKE '%' || $1)
       ORDER BY sent_at ASC
       LIMIT 200`,
      [digits]
    )
  }

  // --- Best-effort prefill data (each query isolated so one failure doesn't break the response) ---

  let cartItemsSummary = ''
  let cartCount = 0
  try {
    const cartRows = await queryMany<{ name: string; quantity: number }>(
      `SELECT p.name, ci.quantity::float AS quantity
       FROM cart_items ci
       JOIN products p ON p.id = ci.product_id
       WHERE ci.user_id = $1 AND ci.saved_for_later = FALSE`,
      [id]
    )
    cartCount = cartRows.length
    if (cartRows.length > 0) {
      const parts = cartRows.slice(0, 3).map(r => `${r.name} x${r.quantity}`)
      const extra = cartRows.length - 3
      cartItemsSummary = extra > 0 ? `${parts.join(', ')} and ${extra} more` : parts.join(', ')
    }
  } catch {}

  let latestOrder: { order_number: string; total_amount: string | number; id: string } | null = null
  try {
    latestOrder = await queryOne<{ order_number: string; total_amount: string | number; id: string }>(
      `SELECT order_number, total_amount, id FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [id]
    )
  } catch {}

  let latestOrderProduct = ''
  if (latestOrder) {
    try {
      const item = await queryOne<{ product_name: string }>(
        `SELECT product_name FROM order_items WHERE order_id = $1 LIMIT 1`,
        [latestOrder.id]
      )
      latestOrderProduct = item?.product_name ?? ''
    } catch {}
  }

  let notifyProduct = ''
  if (email) {
    try {
      const notify = await queryOne<{ name: string }>(
        `SELECT p.name
         FROM back_in_stock_notify n
         JOIN products p ON p.id = n.product_id
         WHERE n.email = $1 AND n.notified = false
         ORDER BY n.created_at DESC LIMIT 1`,
        [email]
      )
      notifyProduct = notify?.name ?? ''
    } catch {}
  }

  let feedbackUrl = ''
  try {
    let form = await queryOne<{ slug: string }>(
      `SELECT slug FROM review_forms WHERE is_active = true AND template_type = 'product_feedback' ORDER BY created_at DESC LIMIT 1`
    )
    if (!form) {
      form = await queryOne<{ slug: string }>(
        `SELECT slug FROM review_forms WHERE is_active = true ORDER BY created_at DESC LIMIT 1`
      )
    }
    if (form?.slug) feedbackUrl = `https://forms.jeffistores.in/${form.slug}`
  } catch {}

  const cartUrl = `${APP_URL}/cart`

  let amountFormatted = ''
  if (latestOrder) {
    try {
      amountFormatted = new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0,
      }).format(Number(latestOrder.total_amount))
    } catch {}
  }

  const prefill = {
    cartItemsSummary,
    cartCount,
    latestOrder,
    latestOrderProduct,
    notifyProduct,
    feedbackUrl,
    cartUrl,
    amountFormatted,
  }

  const availability = {
    abandoned_cart: cartCount > 0,
    back_in_stock: !!notifyProduct,
    reorder_reminder: !!latestOrderProduct,
    return_initiated: !!latestOrder,
    refund_processed: !!latestOrder,
    feedback_request: !!latestOrder,
    promo_offer: true,
    new_arrivals: true,
    festive_greeting: true,
    support_reply: true,
    support_ticket_created: true,
    support_resolved: true,
  }

  return NextResponse.json({ phone, thread, templates: WA_TEMPLATE_REGISTRY, prefill, availability })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'customers:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { templateKey, variables, text } = await req.json()

  const user = await queryOne<{ phone: string | null }>('SELECT phone FROM users WHERE id = $1', [id])
  const phone = user?.phone ?? null
  if (!phone) return NextResponse.json({ error: 'Customer has no phone number' }, { status: 400 })

  let ok = false
  if (templateKey) {
    ok = await sendTemplateByKey(phone, String(templateKey), variables || {})
  } else if (text && String(text).trim()) {
    ok = await sendFreeTextWhatsApp({ phone, body: String(text).trim() })
  } else {
    return NextResponse.json({ error: 'templateKey or text is required' }, { status: 400 })
  }

  if (ok) {
    logActivity({
      userId: id,
      actorId: admin.adminId,
      kind: 'whatsapp_sent',
      summary: 'WhatsApp message sent',
      metadata: { templateKey: templateKey ?? null },
    }).catch(() => {})
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({
    success: false,
    error: 'Send failed (may require an approved template or 24h window)',
  })
}
