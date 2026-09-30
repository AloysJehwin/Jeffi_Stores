import { query, queryMany } from '@/lib/shared/db'

const ATTRIBUTION_WINDOW_HOURS = 24

type ImplicitSignal = 'clicked' | 'added_to_cart' | 'purchased'

export async function recordImplicitSignal(userId: string, productId: string, signal: ImplicitSignal): Promise<void> {
  if (!userId || !productId) return
  try {
    const matches = await queryMany<{ id: string }>(
      `SELECT id FROM ai_queries
       WHERE user_id = $1
         AND created_at > NOW() - ($3 || ' hours')::interval
         AND $2 = ANY(recommended_product_ids)
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, productId, ATTRIBUTION_WINDOW_HOURS]
    )
    if (matches.length === 0) return
    await query(
      `INSERT INTO ai_feedback (ai_query_id, user_id, product_id, signal)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [matches[0].id, userId, productId, signal]
    )
  } catch {}
}

export async function recordImplicitSignalsForProducts(
  userId: string,
  productIds: string[],
  signal: ImplicitSignal
): Promise<void> {
  for (const pid of productIds) {
    await recordImplicitSignal(userId, pid, signal)
  }
}
