import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'inventory:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const { id } = await params

    const supplier = await queryOne<any>(
      `SELECT id, name, gstin, contact_name, phone, email, address,
              payment_terms, notes, is_active, bank_name, account_number,
              ifsc, upi_id, created_at, updated_at
       FROM suppliers
       WHERE id = $1`,
      [id]
    )

    if (!supplier) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const [stats, pos, expenses, linkedProducts, purchasedProducts] = await Promise.all([
      queryOne<any>(
        `SELECT
          COUNT(DISTINCT po.id)::int AS po_count,
          COALESCE(SUM(DISTINCT po.total_amount), 0) AS po_total,
          COUNT(DISTINCT e.id)::int AS expense_count,
          COALESCE(SUM(e.total_amount), 0) AS expense_total
         FROM purchase_orders po
         LEFT JOIN expenses e ON e.po_id = po.id
         WHERE po.supplier_id = $1`,
        [id]
      ),
      queryMany<any>(
        `SELECT po.id, po.po_number, po.status, po.order_date, po.expected_date,
                po.total_amount, po.notes
         FROM purchase_orders po
         WHERE po.supplier_id = $1
         ORDER BY po.order_date DESC
         LIMIT 50`,
        [id]
      ),
      queryMany<any>(
        `SELECT e.id, e.expense_number, e.expense_date, e.due_date,
                e.amount, e.tax_amount, e.total_amount, e.status,
                e.description, po.po_number
         FROM expenses e
         JOIN purchase_orders po ON po.id = e.po_id AND po.supplier_id = $1
         ORDER BY e.expense_date DESC
         LIMIT 50`,
        [id]
      ),
      // Linked products: current (latest-dated, active) product_suppliers rows for this
      // supplier, one per leaf, with product/variant/sub-variant names.
      queryMany<any>(
        `SELECT DISTINCT ON (ps.product_id, ps.variant_id, ps.sub_variant_id)
                ps.product_id, p.name AS product_name,
                ps.variant_id, pv.variant_name,
                ps.sub_variant_id, psv.sub_variant_name,
                ps.unit_cost, ps.currency, ps.is_preferred, ps.moq,
                ps.lead_time_days, ps.effective_date
         FROM product_suppliers ps
         JOIN products p ON p.id = ps.product_id
         LEFT JOIN product_variants pv ON pv.id = ps.variant_id
         LEFT JOIN product_sub_variants psv ON psv.id = ps.sub_variant_id
         WHERE ps.supplier_id = $1 AND ps.is_active = true
         ORDER BY ps.product_id, ps.variant_id, ps.sub_variant_id, ps.effective_date DESC, ps.created_at DESC`,
        [id]
      ),
      // Purchased products: aggregate of what has actually been bought from this
      // supplier via POs, grouped by product + variant.
      queryMany<any>(
        `SELECT poi.product_id, p.name AS product_name,
                poi.variant_id, pv.variant_name,
                poi.sub_variant_id, psv.sub_variant_name,
                SUM(poi.quantity) AS total_qty,
                COUNT(DISTINCT po.id)::int AS po_count,
                MAX(po.order_date) AS last_order_date,
                (ARRAY_AGG(poi.unit_cost ORDER BY po.order_date DESC))[1] AS last_unit_cost
         FROM purchase_order_items poi
         JOIN purchase_orders po ON po.id = poi.po_id AND po.supplier_id = $1
         JOIN products p ON p.id = poi.product_id
         LEFT JOIN product_variants pv ON pv.id = poi.variant_id
         LEFT JOIN product_sub_variants psv ON psv.id = poi.sub_variant_id
         GROUP BY poi.product_id, p.name, poi.variant_id, pv.variant_name, poi.sub_variant_id, psv.sub_variant_name
         ORDER BY MAX(po.order_date) DESC
         LIMIT 100`,
        [id]
      ),
    ])

    return NextResponse.json({
      supplier: { ...supplier, ...stats },
      pos: pos || [],
      expenses: expenses || [],
      linkedProducts: linkedProducts || [],
      purchasedProducts: purchasedProducts || [],
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
