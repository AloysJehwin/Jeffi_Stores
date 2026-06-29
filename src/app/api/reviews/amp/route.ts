import { type NextRequest, NextResponse } from 'next/server'
import { verifyReviewToken } from '@/lib/jwt'
import { queryOne } from '@/lib/db'

function ampResponse(body: Record<string, unknown>, origin: string | null, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'AMP-Access-Control-Allow-Source-Origin': origin || 'https://jeffistores.in',
      'Access-Control-Allow-Origin': origin || 'https://jeffistores.in',
      'Access-Control-Allow-Credentials': 'true',
    },
  })
}

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('amp-same-origin') === 'true'
    ? req.headers.get('origin')
    : null
  return ampResponse({}, origin)
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin')

  let body: { token?: string; rating?: number; comment?: string; title?: string; tags?: string[] }
  try {
    body = await req.json()
  } catch {
    return ampResponse({ error: 'Invalid request' }, origin, 400)
  }

  const { token, rating, comment, title, tags } = body

  if (!token) return ampResponse({ error: 'Missing token' }, origin, 400)
  if (!rating || rating < 1 || rating > 5) return ampResponse({ error: 'Invalid rating' }, origin, 400)
  if (!comment?.trim()) return ampResponse({ error: 'Comment required' }, origin, 400)

  const payload = await verifyReviewToken(token)
  if (!payload) return ampResponse({ error: 'Token expired or invalid' }, origin, 401)

  const { orderId, productId, userId } = payload

  const existing = await queryOne(
    `SELECT id FROM product_reviews WHERE user_id = $1 AND product_id = $2`,
    [userId, productId]
  )
  if (existing) return ampResponse({ error: 'Already reviewed' }, origin, 409)

  await queryOne(
    `INSERT INTO product_reviews
       (user_id, product_id, order_id, rating, title, comment, tags, is_verified_purchase, is_approved)
     VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, FALSE)
     RETURNING id`,
    [userId, productId, orderId, rating, title?.trim() || null, comment.trim(), JSON.stringify(tags ?? [])]
  )

  return ampResponse({ success: true }, origin)
}
