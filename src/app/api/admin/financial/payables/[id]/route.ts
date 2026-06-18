import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'financial')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const expense = await queryOne<any>(
      `SELECT
        e.*,
        s.name AS supplier_name_from_db,
        s.gstin AS supplier_gstin_from_db,
        s.contact_name AS supplier_contact,
        s.phone AS supplier_phone,
        s.account_number AS supplier_account_number,
        s.ifsc AS supplier_ifsc,
        s.upi_id AS supplier_upi_id,
        s.bank_name AS supplier_bank_name,
        po.po_number,
        po.status AS po_status,
        po.order_date AS po_order_date,
        po.expected_date AS po_expected_date
      FROM expenses e
      LEFT JOIN purchase_orders po ON po.id = e.po_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE e.id = $1`,
      [id]
    )

    if (!expense) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const payments = await queryMany<any>(
      `SELECT id, amount, payment_date, payment_method, reference, payout_id, payout_status, notes, created_at
       FROM expense_payments
       WHERE expense_id = $1
       ORDER BY payment_date DESC, created_at DESC`,
      [id]
    )

    return NextResponse.json({ expense, payments: payments || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
