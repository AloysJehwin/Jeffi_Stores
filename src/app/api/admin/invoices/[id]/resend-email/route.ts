import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne } from '@/lib/db'
import { sendInvoiceFinalizedEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const order = await queryOne<any>(
      `SELECT customer_email, customer_name, invoice_number, total_amount, order_number, view_token FROM orders WHERE id = $1`,
      [params.id]
    )
    if (!order) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    if (!order.customer_email) return NextResponse.json({ error: 'No email address on file' }, { status: 400 })
    if (!order.invoice_number) return NextResponse.json({ error: 'Invoice not yet finalized' }, { status: 400 })

    const viewUrl = `https://invoice.jeffistores.in/${order.view_token}`

    await sendInvoiceFinalizedEmail(
      order.customer_email,
      order.customer_name,
      order.invoice_number,
      Number(order.total_amount),
      order.order_number,
      viewUrl
    )

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
