import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne } from '@/lib/db'

export const dynamic = 'force-dynamic'

// Returns the next available sequence number for a serial prefix like "SAF0011M-20260709"
// so auto-generate never clashes with existing in-stock serials.
export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'inventory:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const prefix = request.nextUrl.searchParams.get('prefix')
    if (!prefix) return NextResponse.json({ error: 'prefix required' }, { status: 400 })

    const row = await queryOne<{ max_seq: number }>(
      `SELECT COALESCE(MAX(
         CASE WHEN serial_number ~ ('^' || $1 || '-[0-9]+$')
              THEN (regexp_match(serial_number, '-([0-9]+)$'))[1]::integer
              ELSE 0
         END
       ), 0) AS max_seq
       FROM product_serials
       WHERE serial_number LIKE $2 AND status != 'sold'`,
      [prefix, `${prefix}-%`]
    )

    return NextResponse.json({ next_seq: (row?.max_seq ?? 0) + 1 })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
