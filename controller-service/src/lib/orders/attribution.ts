import type { PoolClient } from 'pg'
import { attributionFromCookieHeader, type Attribution } from '@/lib/shared/attribution'
import { CONSENT_COOKIE } from '@/lib/analytics/google-tag'
import { parseConsent } from '@/lib/client/consent'

/** The buyer's stored click / UTM attribution, read from the request's Cookie header. */
export function attributionFromRequest(request: Request): Attribution | null {
  return attributionFromCookieHeader(request.headers.get('cookie'))
}

/** The buyer's advertising-cookie choice from the consent cookie; null when none was made. */
export function adsConsentFromRequest(request: Request): boolean | null {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i >= 0 && part.slice(0, i).trim() === CONSENT_COOKIE) return parseConsent(part.slice(i + 1).trim())?.ads ?? null
  }
  return null
}

/** Stamps attribution and the ads consent choice on a freshly created order. No-op when there is neither. */
export async function attachOrderAttribution(
  client: Pick<PoolClient, 'query'>,
  orderId: string,
  a: Attribution | null,
  adsConsent: boolean | null = null
): Promise<void> {
  if (!a) {
    if (adsConsent !== null) await client.query(`UPDATE orders SET ads_consent = $2 WHERE id = $1`, [orderId, adsConsent])
    return
  }
  await client.query(
    `UPDATE orders SET gclid = $2, gbraid = $3, wbraid = $4, utm_source = $5, utm_medium = $6,
       utm_campaign = $7, utm_term = $8, utm_content = $9, landing_path = $10, attributed_at = $11, ads_consent = $12
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
      adsConsent,
    ]
  )
}
