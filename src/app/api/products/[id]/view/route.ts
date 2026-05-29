import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { authenticateUser } from '@/lib/jwt'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const productId = params.id
  const sessionId = req.cookies.get('session_id')?.value || req.headers.get('x-session-id') || null
  const userAgent = req.headers.get('user-agent') || null
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null

  let userId: string | null = null
  try {
    const user = await authenticateUser(req)
    userId = user?.userId || null
  } catch {}

  try {
    await query(
      `INSERT INTO product_views (product_id, user_id, session_id, ip_address, user_agent)
       VALUES ($1, $2, $3, $4::inet, $5)`,
      [productId, userId, sessionHeader, ip, userAgent]
    )
  } catch {}

  return NextResponse.json({ ok: true })
}
