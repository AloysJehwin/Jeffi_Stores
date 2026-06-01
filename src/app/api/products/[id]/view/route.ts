import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { authenticateUser } from '@/lib/jwt'
import { logActivity } from '@/lib/activity'

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
      [productId, userId, sessionId, ip, userAgent]
    )
  } catch {}

  if (userId) {
    try {
      const recent = await queryOne<{ id: string }>(
        `SELECT id FROM customer_activity_log
          WHERE user_id = $1::uuid AND kind = 'product_viewed' AND reference_id = $2::uuid
            AND created_at > NOW() - INTERVAL '1 day'
          LIMIT 1`,
        [userId, productId]
      )
      if (!recent) {
        const product = await queryOne<{ name: string }>('SELECT name FROM products WHERE id = $1', [productId])
        if (product) {
          logActivity({
            userId,
            kind: 'product_viewed',
            referenceId: productId,
            referenceType: 'products',
            summary: `Viewed "${product.name}"`,
          }).catch(() => {})
        }
      }
    } catch {}
  }

  return NextResponse.json({ ok: true })
}
