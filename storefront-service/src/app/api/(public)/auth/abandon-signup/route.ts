import { NextRequest, NextResponse } from 'next/server'
import { authenticateAnyUser } from '@/lib/auth/jwt'
import { queryOne, query } from '@/lib/shared/db'
import { deleteObjectKey } from '@/lib/shared/s3'

const RECENT_WINDOW_MINUTES = 30

// Deletes only the caller's own unverified, brand-new, order-less account; never an approved business.
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateAnyUser(request)
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const u = await queryOne<{
      id: string
      phone_verified: boolean
      user_type: string
      avatar_s3_key: string | null
      approval_status: string | null
      is_recent: boolean
      order_count: string
    }>(
      `SELECT u.id, u.phone_verified, u.user_type, u.avatar_s3_key, bp.approval_status,
              (u.created_at > NOW() - ($2 || ' minutes')::interval) AS is_recent,
              (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS order_count
         FROM users u
         LEFT JOIN business_profiles bp ON bp.user_id = u.id
        WHERE u.id = $1`,
      [auth.userId, String(RECENT_WINDOW_MINUTES)]
    )

    if (!u) return NextResponse.json({ deleted: false, reason: 'not_found' })

    const businessOk = u.user_type !== 'business' || u.approval_status !== 'approved'
    const safeToDelete = u.phone_verified === false && u.is_recent === true && Number(u.order_count) === 0 && businessOk

    if (!safeToDelete) {
      return NextResponse.json({ deleted: false, reason: 'not_eligible' })
    }

    const removed = await query(`DELETE FROM users WHERE id = $1 AND phone_verified = false`, [auth.userId])
    if (!removed.rowCount) return NextResponse.json({ deleted: false, reason: 'not_eligible' })

    if (u.avatar_s3_key) await deleteObjectKey(u.avatar_s3_key).catch(() => {})

    return NextResponse.json({ deleted: true })
  } catch {
    return NextResponse.json({ deleted: false, reason: 'error' })
  }
}
