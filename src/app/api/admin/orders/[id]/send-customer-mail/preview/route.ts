import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne } from '@/lib/db'
import { buildVarMap, substituteVars } from '@/lib/template-vars'
import { storeContactLine, currentBrandNameAsync } from '@/lib/brand'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contactLine = await storeContactLine().then(c => c ? `<p>${c}</p>` : '')
  const storeName = await (await import('@/lib/site-controls')).getStoreIdentity().then(i => i.name)
  const brand = await currentBrandNameAsync()
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'orders:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { subject, body } = await request.json().catch(() => ({}))

  const order = await queryOne<any>(
    `SELECT o.order_number, o.customer_name, o.customer_email,
       json_build_object('email', u.email, 'first_name', u.first_name, 'last_name', u.last_name) AS users
     FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.id = $1`,
    [id]
  )
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const email = order.users?.email || order.customer_email || ''
  const firstName = order.users?.first_name || (order.customer_name?.split(' ')[0] ?? '')
  const lastName = order.users?.last_name || ''
  const name = order.users?.first_name
    ? `${order.users.first_name} ${order.users.last_name || ''}`.trim()
    : order.customer_name || 'Valued Customer'

  const vars = {
    ...buildVarMap({ recipient: { email, first_name: firstName, last_name: lastName } }),
    order_number: order.order_number || '',
  }

  const finalBody = substituteVars((body || '').trim(), vars)

  const html = `<!DOCTYPE html>
<html>
  <head>
    <style>
      body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
      .container { background-color: #f9f9f9; border-radius: 10px; padding: 30px; border: 1px solid #e0e0e0; }
      .header { text-align: center; padding-bottom: 20px; margin-bottom: 30px; }
      .message-box { background-color: #fff; border-left: 4px solid #f97316; padding: 20px; border-radius: 4px; margin: 20px 0; }
      .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; color: #666; font-size: 13px; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <div style="font-size:28px;font-weight:bold;color:#f97316;letter-spacing:0.5px;">${brand}</div>
        <p style="color:#666;margin:4px 0 0;">Hardware &amp; Tools</p>
      </div>
      <div class="message-box">${finalBody}</div>
      <div class="footer">
        <p>This message was sent by the ${brand} admin team. Please do not reply directly to this email.</p>
        <p><strong>${storeName}</strong></p>${contactLine}
      </div>
    </div>
  </body>
</html>`

  return NextResponse.json({ html })
}
