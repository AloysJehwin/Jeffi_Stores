import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth/jwt'
import { query, queryOne } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'

const ALLOWED_SIGNALS = new Set([
  'helpful',
  'not_helpful',
  'overall_helpful',
  'overall_not_helpful',
  'clicked',
  'added_to_cart',
  'purchased',
])

export async function POST(req: NextRequest) {
  const user = await authenticateUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const aiQueryId = typeof body.aiQueryId === 'string' ? body.aiQueryId : null
  const productId = typeof body.productId === 'string' && body.productId ? body.productId : null
  const signal = typeof body.signal === 'string' ? body.signal : ''
  const comment = typeof body.comment === 'string' ? body.comment.slice(0, 500) : null

  if (!ALLOWED_SIGNALS.has(signal)) {
    return NextResponse.json({ error: 'Invalid signal' }, { status: 400 })
  }
  if (!aiQueryId) {
    return NextResponse.json({ error: 'aiQueryId is required' }, { status: 400 })
  }

  const owns = await queryOne<{ id: string }>(`SELECT id FROM ai_queries WHERE id = $1 AND user_id = $2`, [
    aiQueryId,
    user.userId,
  ])
  if (!owns) return NextResponse.json({ error: 'AI query not found' }, { status: 404 })

  await query(
    `INSERT INTO ai_feedback (ai_query_id, user_id, product_id, signal, comment)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING`,
    [aiQueryId, user.userId, productId, signal, comment]
  )

  return NextResponse.json({ ok: true }, { status: 200 })
}
