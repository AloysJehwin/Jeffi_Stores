import type { PoolClient } from 'pg'
import { attributionFromCookieHeader, type Attribution } from '@/lib/shared/attribution'

/** The buyer's stored click / UTM attribution, read from the request's Cookie header. */
export function attributionFromRequest(request: Request): Attribution | null {
  return attributionFromCookieHeader(request.headers.get('cookie'))
}

/** Stamps attribution on a freshly created order. No-op when the buyer has none. */
export async function attachOrderAttribution(
  client: Pick<PoolClient, 'query'>,
  orderId: string,
  a: Attribution | null
): Promise<void> {
  if (!a) return
  await client.query(
    `UPDATE orders SET gclid = $2, gbraid = $3, wbraid = $4, utm_source = $5, utm_medium = $6,
       utm_campaign = $7, utm_term = $8, utm_content = $9, landing_path = $10, attributed_at = $11
     WHERE id = $1`,
    [
      orderId,
      a.gclid ?? null,
      a.gbraid ?? null,
      a.wbraid ?? null,
      a.utm_source ?? null,
      a.utm_medium ?? null,
      a.utm_campaign ?? null,
      a.utm_term ?? null,
      a.utm_content ?? null,
      a.landing_path,
      new Date(a.ts).toISOString(),
    ]
  )
}
