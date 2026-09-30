import { NextRequest, NextResponse } from 'next/server'
import { authenticateAnyUser as authenticateUser } from '@/lib/auth/jwt'
import { query, queryMany, queryOne } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = await authenticateUser(request)
  if (!auth) return NextResponse.json({ history: [] })

  const rows = await queryMany<{ query: string }>(
    `SELECT query FROM user_search_history
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 5`,
    [auth.userId]
  )
  return NextResponse.json({ history: rows.map(r => r.query) })
}

export async function POST(request: NextRequest) {
  const auth = await authenticateUser(request)
  if (!auth) return NextResponse.json({ ok: false }, { status: 401 })

  const body = await request.json()
  const term: string = (body.query || '').trim().slice(0, 200)
  if (!term) return NextResponse.json({ ok: false }, { status: 400 })

  await queryOne(
    `DELETE FROM user_search_history
     WHERE user_id = $1
       AND lower(query) = lower($2)`,
    [auth.userId, term]
  )

  await queryOne(`INSERT INTO user_search_history (user_id, query) VALUES ($1, $2)`, [auth.userId, term])

  await queryOne(
    `DELETE FROM user_search_history
     WHERE id IN (
       SELECT id FROM user_search_history
       WHERE user_id = $1
       ORDER BY created_at DESC
       OFFSET 5
     )`,
    [auth.userId]
  )

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest) {
  const auth = await authenticateUser(request)
  if (!auth) return NextResponse.json({ ok: false }, { status: 401 })

  await query(`DELETE FROM user_search_history WHERE user_id = $1`, [auth.userId])
  return NextResponse.json({ ok: true })
}
