import { NextRequest, NextResponse } from 'next/server'
import { queryMany, queryOne } from '@/lib/db'
import { generatePurchaseOrderPDF, POItem, POBusinessSettings } from '@/lib/po-pdf'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const po = await queryOne<any>(
      `SELECT po.*, s.name AS supplier_name, s.contact_name, s.email AS supplier_email,
              s.address AS supplier_address, s.gstin AS supplier_gstin
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.view_token = $1`,
      [params.token]
    )
    if (!po) return NextResponse.json({ error: 'Not found' }, { status: 404 })

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

    const business: POBusinessSettings = {
      legalName: s.business_legal_name || '',
      tradeName: s.business_trade_name || '',
      address: s.business_address || '',
      phone: s.business_phone || '',
      email: s.business_email || '',
      gstin: s.business_gstin || '',
    }

    const poItems: POItem[] = (items || []).map((item: any) => ({
      product_name: item.product_name,
      variant_name: item.variant_name || null,
      quantity: Number(item.quantity),
      unit_cost: Number(item.unit_cost),
    }))

    const buffer = await generatePurchaseOrderPDF(po, poItems, business)
    const filename = `po-${po.po_number.replace(/\//g, '-')}.pdf`

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buffer.length),
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to generate PDF' }, { status: 500 })
  }
}
