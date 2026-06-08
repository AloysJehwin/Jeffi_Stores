import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryMany, queryOne } from '@/lib/db'
import { sendQuotationFinalizedEmail } from '@/lib/email'

function calcTotals(items: any[]) {
  const subtotal = items.reduce((s: number, i: any) => s + i.amount, 0)
  const cgst = items.reduce((s: number, i: any) => s + i.amount * i.gst_rate / 200, 0)
  const sgst = cgst
  const total = Math.round(subtotal + cgst + sgst)
  return { subtotal, cgst_amount: cgst, sgst_amount: sgst, total_amount: total }
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await authenticateAdmin(_req)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'quotations')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const qt = await queryOne<any>(`SELECT * FROM quotations WHERE id = $1`, [params.id])
    if (!qt) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const items = await queryMany(`
      SELECT qi.*,
        COALESCE(sv.inventory_quantity, pv.inventory_quantity, p.inventory_quantity) AS inventory_quantity
      FROM quotation_items qi
      LEFT JOIN product_sub_variants sv ON sv.id = qi.sub_variant_id
      LEFT JOIN product_variants pv ON pv.id = qi.variant_id
      LEFT JOIN products p ON p.id = qi.product_id AND qi.variant_id IS NULL AND qi.sub_variant_id IS NULL
      WHERE qi.quotation_id = $1
      ORDER BY qi.position
    `, [params.id])
    return NextResponse.json({ quotation: qt, items: items || [] })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'quotations')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const existing = await queryOne<any>(`SELECT id, status FROM quotations WHERE id = $1`, [params.id])
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await request.json()
    const { items, ...fields } = body

    let totals = { subtotal: existing.subtotal, cgst_amount: existing.cgst_amount, sgst_amount: existing.sgst_amount, total_amount: existing.total_amount }

    if (Array.isArray(items)) {
      const computedItems = items.map((item: any) => ({
        ...item,
        amount: Number(item.quantity) * Number(item.rate),
      }))
      totals = calcTotals(computedItems)

      await query(`DELETE FROM quotation_items WHERE quotation_id = $1`, [params.id])
      for (let idx = 0; idx < computedItems.length; idx++) {
        const item = computedItems[idx]
        await query(
          `INSERT INTO quotation_items (quotation_id, position, description, hsn_code, gst_rate, quantity, unit, rate, discount_pct, amount, product_id, variant_id, sub_variant_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            params.id, idx,
            item.description, item.hsn_code || null, Number(item.gst_rate) || 18,
            Number(item.quantity), item.unit || 'PCS', Number(item.rate),
            Number(item.discount_pct) || 0, item.amount,
            item.product_id || null, item.variant_id || null, item.sub_variant_id || null,
          ]
        )
      }
    }

    const setClauses: string[] = ['updated_at = NOW()']
    const updateParams: any[] = []
    let pi = 1

    const textFields = [
      'quote_date', 'status',
      'consignee_name', 'consignee_addr1', 'consignee_addr2', 'consignee_city', 'consignee_state', 'consignee_gstin',
      'consignee_phone', 'consignee_pincode', 'consignee_email',
      'buyer_same', 'buyer_name', 'buyer_addr1', 'buyer_addr2', 'buyer_city', 'buyer_state', 'buyer_gstin',
      'buyer_phone', 'buyer_pincode', 'buyer_email', 'notes',
    ]
    for (const field of textFields) {
      if (field in fields) {
        setClauses.push(`${field} = $${pi++}`)
        updateParams.push(fields[field])
      }
    }

    setClauses.push(`subtotal = $${pi++}`, `cgst_amount = $${pi++}`, `sgst_amount = $${pi++}`, `total_amount = $${pi++}`)
    updateParams.push(totals.subtotal, totals.cgst_amount, totals.sgst_amount, totals.total_amount)
    updateParams.push(params.id)

    const qt = await queryOne<any>(
      `UPDATE quotations SET ${setClauses.join(', ')} WHERE id = $${pi} RETURNING *`,
      updateParams
    )

    const savedItems = await queryMany(`
      SELECT qi.*,
        COALESCE(sv.inventory_quantity, pv.inventory_quantity, p.inventory_quantity) AS inventory_quantity
      FROM quotation_items qi
      LEFT JOIN product_sub_variants sv ON sv.id = qi.sub_variant_id
      LEFT JOIN product_variants pv ON pv.id = qi.variant_id
      LEFT JOIN products p ON p.id = qi.product_id AND qi.variant_id IS NULL AND qi.sub_variant_id IS NULL
      WHERE qi.quotation_id = $1
      ORDER BY qi.position
    `, [params.id])

    if (fields.status === 'final' && qt?.consignee_email) {
      try {
        const viewUrl = `https://quotation.jeffistores.in/${qt.view_token}`
        await sendQuotationFinalizedEmail(
          qt.consignee_email,
          qt.consignee_name || 'Customer',
          qt.quote_number,
          Number(qt.total_amount),
          viewUrl
        )
      } catch (_emailErr) {
      }
    }

    return NextResponse.json({ quotation: qt, items: savedItems })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to update' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'quotations')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const existing = await queryOne<any>(`SELECT id, status FROM quotations WHERE id = $1`, [params.id])
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (existing.status !== 'draft') return NextResponse.json({ error: 'Only draft quotations can be deleted' }, { status: 400 })

    // Detach any RFQ that points to this quotation before deleting
    await query(
      `UPDATE business_rfqs SET converted_quotation_id = NULL, status = 'reviewed' WHERE converted_quotation_id = $1`,
      [params.id]
    )

    await query(`DELETE FROM quotations WHERE id = $1`, [params.id])
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    // FK violation fallback (shouldn't reach here after the detach above, but just in case)
    if (e?.code === '23503') {
      return NextResponse.json(
        { error: 'This quotation was created from a business RFQ and cannot be deleted while that link exists. Please handle the RFQ first.' },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: e?.message || 'Failed to delete' }, { status: 500 })
  }
}
