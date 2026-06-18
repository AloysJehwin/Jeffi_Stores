import { notFound } from 'next/navigation'
import { queryMany, queryOne } from '@/lib/db'
import PurchaseOrderViewClient from './PurchaseOrderViewClient'

export const dynamic = 'force-dynamic'

export default async function PurchaseOrderViewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const po = await queryOne<any>(
    `SELECT po.*, s.name AS supplier_name, s.contact_name, s.email AS supplier_email,
            s.address AS supplier_address, s.gstin AS supplier_gstin
     FROM purchase_orders po
     JOIN suppliers s ON s.id = po.supplier_id
     WHERE po.view_token = $1`,
    [token]
  )
  if (!po) notFound()

  const items = await queryMany<any>(
    `SELECT poi.quantity, poi.unit_cost,
            COALESCE(poi.product_name, p.name) AS product_name,
            pv.variant_name
     FROM purchase_order_items poi
     LEFT JOIN products p ON p.id = poi.product_id
     LEFT JOIN product_variants pv ON pv.id = poi.variant_id
     WHERE poi.po_id = $1`,
    [po.id]
  )
  const settingsRows = await queryMany<{ key: string; value: string }>(
    `SELECT key, value FROM site_settings WHERE key LIKE 'business_%'`,
    []
  )
  const s: Record<string, string> = {}
  for (const row of settingsRows) s[row.key] = row.value || ''

  return <PurchaseOrderViewClient po={po} items={items || []} settings={s} token={token} />
}
