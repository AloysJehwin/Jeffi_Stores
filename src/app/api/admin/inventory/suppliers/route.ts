import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryMany, queryOne, query } from '@/lib/db'
import { buildSearchClause } from '@/lib/search'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') || ''
    const includeInactive = searchParams.get('all') === 'true'
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = parseInt(searchParams.get('limit') || '20')
    const offset = (page - 1) * limit

    const conditions = ['1=1']
    const params: any[] = []
    let i = 1

    if (!includeInactive) { conditions.push('s.is_active = TRUE') }
    if (search) {
      const sc = buildSearchClause(search, ['s.name', 's.gstin', 's.contact_name'], i)
      conditions.push(sc.clause)
      params.push(...sc.params)
      i = sc.nextIdx
    }

    const where = conditions.join(' AND ')
    const countRow = await queryOne<{ total: number }>(
      `SELECT COUNT(DISTINCT s.id)::int AS total FROM suppliers s WHERE ${where}`,
      params
    )
    const total = countRow?.total || 0

    const rows = await queryMany(
      `SELECT s.*, COUNT(po.id)::int AS po_count
       FROM suppliers s
       LEFT JOIN purchase_orders po ON po.supplier_id = s.id
       WHERE ${where}
       GROUP BY s.id
       ORDER BY s.name
       LIMIT $${i} OFFSET $${i + 1}`,
      [...params, limit, offset]
    )

    return NextResponse.json({ suppliers: rows || [], total, page, limit })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { name, gstin, contact_name, phone, email, address, payment_terms, notes, bank_name, account_number, ifsc, upi_id } = body

    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

    const inserted = await queryOne<{ id: string }>(
      `INSERT INTO suppliers (name, gstin, contact_name, phone, email, address, payment_terms, notes, bank_name, account_number, ifsc, upi_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [name, gstin || null, contact_name || null, phone || null, email || null,
       address || null, parseInt(payment_terms || '30'), notes || null,
       bank_name || null, account_number || null, ifsc || null, upi_id || null]
    )

    return NextResponse.json({ success: true, id: inserted?.id })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
