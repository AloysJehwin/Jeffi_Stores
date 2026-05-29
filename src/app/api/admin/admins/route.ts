import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'customers')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const admins = await queryMany(`
    SELECT a.id, a.username, a.role, u.first_name, u.last_name
    FROM admins a
    LEFT JOIN users u ON u.id = a.user_id
    WHERE a.is_active = true
    ORDER BY u.first_name NULLS LAST, a.username
  `)

  return NextResponse.json({ admins })
}
