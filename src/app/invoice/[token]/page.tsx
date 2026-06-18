import { notFound } from 'next/navigation'
import { queryMany, queryOne } from '@/lib/db'
import InvoiceViewClient from './InvoiceViewClient'

export const dynamic = 'force-dynamic'

export default async function InvoiceViewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const order = await queryOne<any>(
    `SELECT o.*, a.full_name, a.address_line1, a.address_line2, a.city, a.state, a.postal_code, a.phone AS address_phone
     FROM orders o
     LEFT JOIN addresses a ON o.shipping_address_id = a.id
     WHERE o.view_token = $1 AND o.invoice_number IS NOT NULL`,
    [token]
  )
  if (!order) notFound()

  const items = await queryMany<any>(
    `SELECT * FROM order_items WHERE order_id = $1 ORDER BY created_at`,
    [order.id]
  )
  const settingsRows = await queryMany<{ key: string; value: string }>(
    `SELECT key, value FROM site_settings WHERE key LIKE 'business_%' OR key LIKE 'bank_%'`,
    []
  )
  const s: Record<string, string> = {}
  for (const row of settingsRows) s[row.key] = row.value || ''

  return <InvoiceViewClient order={order} items={items || []} settings={s} token={token} />
}
