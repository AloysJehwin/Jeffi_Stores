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

    const rows = await queryMany(
      `SELECT s.*, COUNT(po.id)::int AS po_count
       FROM suppliers s
       LEFT JOIN purchase_orders po ON po.supplier_id = s.id
       WHERE ${conditions.join(' AND ')}
       GROUP BY s.id
       ORDER BY s.name`,
      params
    )

    return NextResponse.json({ suppliers: rows || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { name, gstin, contact_name, phone, email, address, payment_terms, notes } = body

    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

    const inserted = await queryOne<{ id: string }>(
      `INSERT INTO suppliers (name, gstin, contact_name, phone, email, address, payment_terms, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [name, gstin || null, contact_name || null, phone || null, email || null,
       address || null, parseInt(payment_terms || '30'), notes || null]
    )

    return NextResponse.json({ success: true, id: inserted?.id })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
