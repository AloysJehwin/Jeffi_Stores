import { NextRequest, NextResponse } from 'next/server'
import { queryMany } from '@/lib/shared/db'
import { driveActor } from '@/lib/drive/http'

export const dynamic = 'force-dynamic'

// Who a folder or file can be shared with: active staff and their roles.
export async function GET(request: NextRequest) {
  const actor = await driveActor(request, 'drive:write')
  if (actor instanceof NextResponse) return actor
  const admins = await queryMany<{ id: string; name: string | null; email: string | null; role: string }>(
    `SELECT a.id, NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), '') AS name, u.email, a.role
       FROM admins a JOIN users u ON u.id = a.user_id WHERE a.is_active = true ORDER BY name NULLS LAST, u.email`
  )
  return NextResponse.json({ admins: admins.filter(a => a.id !== actor.adminId), roles: [...new Set(admins.map(a => a.role))].sort() })
}
