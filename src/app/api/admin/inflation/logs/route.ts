import { NextRequest, NextResponse } from 'next/server'
import { queryMany } from '@/lib/db'
import { authenticateAdmin } from '@/lib/jwt'

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const logs = await queryMany(
    `SELECT id, category_id, category_name, percentage, applied_fields, product_count, applied_by, applied_at, snapshot, is_rollback, rolled_back_at, rolled_back_by
     FROM price_inflation_log
     ORDER BY applied_at DESC
     LIMIT 100`,
    []
  )

  return NextResponse.json({ logs: logs || [] })
}
