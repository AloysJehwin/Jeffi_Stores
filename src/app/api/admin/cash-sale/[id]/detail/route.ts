import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'invoices')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const { id } = await params

    const [sale, items] = await Promise.all([
      queryOne<any>(`SELECT * FROM cash_sales WHERE id = $1`, [id]),
      queryMany<any>(`SELECT * FROM cash_sale_items WHERE sale_id = $1 ORDER BY created_at`, [id]),
    ])

    if (!sale) return NextResponse.json({ error: 'Sale not found' }, { status: 404 })

    return NextResponse.json({ sale, items: items || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
