import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryMany } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const q = new URL(request.url).searchParams.get('q')?.trim() || ''
    if (q.length < 2) return NextResponse.json({ results: [] })

    const pattern = `%${q}%`

    const rows = await queryMany<any>(
      `SELECT DISTINCT ON (u.id)
         u.id, (u.first_name || ' ' || u.last_name) AS full_name, u.email, u.phone,
         cp.company_name, cp.gst_number,
         a.full_name AS addr_name, a.address_line1, a.address_line2, a.city, a.state, a.postal_code
       FROM users u
       LEFT JOIN customer_profiles cp ON cp.user_id = u.id
       LEFT JOIN addresses a ON a.user_id = u.id AND a.is_default = true
       WHERE u.is_guest = false
         AND (
           (u.first_name || ' ' || u.last_name) ILIKE $1
           OR u.email ILIKE $1
           OR u.phone ILIKE $1
           OR cp.company_name ILIKE $1
         )
       ORDER BY u.id ASC
       LIMIT 10`,
      [pattern]
    )

    return NextResponse.json({ results: rows || [] })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 })
  }
}
