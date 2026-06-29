import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface UserRow {
  id: string
  full_name: string
  email: string
}

export async function GET(req: NextRequest) {
  try {
    const admin = await authenticateAdmin(req)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'customers:read'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const { searchParams } = new URL(req.url)
    const mode = searchParams.get('mode') || 'all'
    const segment = searchParams.get('segment')
    const scoreMin = searchParams.get('score_min')
    const scoreMax = searchParams.get('score_max')

    let rows: UserRow[] = []

    if (mode === 'all') {
      rows = await queryMany<UserRow>(
        `SELECT u.id,
                TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS full_name,
                u.email
         FROM users u
         WHERE u.is_active = TRUE AND u.is_guest = FALSE AND u.email IS NOT NULL
         ORDER BY u.first_name ASC
         LIMIT 2000`,
        []
      )
    } else if (mode === 'segment' && segment) {
      const seg = segment
      let segCondition = ''
      if (seg === 'b2b') {
        segCondition = `(u.gst_number IS NOT NULL OR u.company_name IS NOT NULL)`
      } else if (seg === 'vip') {
        segCondition = `(SELECT COALESCE(SUM(o.total_amount), 0) FROM orders o WHERE o.user_id = u.id AND o.status = 'delivered') >= 50000`
      } else if (seg === 'loyal') {
        segCondition = `(SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.payment_status = 'paid') >= 5
          AND (SELECT COALESCE(SUM(o.total_amount), 0) FROM orders o WHERE o.user_id = u.id AND o.status = 'delivered') >= 25000`
      } else if (seg === 'repeat') {
        segCondition = `(SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) >= 3`
      } else if (seg === 'new') {
        segCondition = `u.created_at >= NOW() - INTERVAL '30 days'`
      } else if (seg === 'at_risk') {
        segCondition = `EXISTS (
          SELECT 1 FROM orders o WHERE o.user_id = u.id
          AND o.created_at >= NOW() - INTERVAL '180 days'
          AND o.created_at < NOW() - INTERVAL '90 days'
        )`
      } else if (seg === 'dormant') {
        segCondition = `NOT EXISTS (
          SELECT 1 FROM orders o WHERE o.user_id = u.id
          AND o.created_at >= NOW() - INTERVAL '180 days'
        ) AND EXISTS (SELECT 1 FROM orders o2 WHERE o2.user_id = u.id)`
      } else if (seg === 'one_time') {
        segCondition = `(SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) = 1`
      } else if (seg === 'lead') {
        segCondition = `NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id)`
      }

      if (!segCondition) return NextResponse.json({ error: 'Unknown segment' }, { status: 400 })

      rows = await queryMany<UserRow>(
        `SELECT u.id,
                TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS full_name,
                u.email
         FROM users u
         WHERE u.is_active = TRUE AND u.is_guest = FALSE AND u.email IS NOT NULL
           AND ${segCondition}
         ORDER BY u.first_name ASC
         LIMIT 2000`,
        []
      )
    } else if (mode === 'score') {
      const min = scoreMin != null ? parseInt(scoreMin, 10) : 0
      const max = scoreMax != null ? parseInt(scoreMax, 10) : 100

      rows = await queryMany<UserRow>(
        `SELECT u.id,
                TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS full_name,
                u.email
         FROM users u
         JOIN customer_health ch ON ch.user_id = u.id
         WHERE u.is_active = TRUE AND u.is_guest = FALSE AND u.email IS NOT NULL
           AND ch.score >= $1 AND ch.score < $2
         ORDER BY ch.score DESC
         LIMIT 2000`,
        [min, max]
      )
    } else {
      return NextResponse.json({ error: 'Invalid mode' }, { status: 400 })
    }

    return NextResponse.json({ users: rows, count: rows.length })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 })
  }
}
