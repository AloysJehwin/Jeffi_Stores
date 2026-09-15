import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasPlanScope } from '@/lib/plan-gate'
import { queryMany } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!(await hasPlanScope(admin.role, admin.scopes, 'inventory:read'))) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const onlyActive = request.nextUrl.searchParams.get('active') !== 'false'

    const suppliers = await queryMany<{ id: string; name: string; is_active: boolean }>(
      `SELECT id, name, is_active FROM suppliers
       ${onlyActive ? 'WHERE is_active = true' : ''}
       ORDER BY name`,
      []
    )

    return NextResponse.json(suppliers)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
