import { createHmac } from 'node:crypto'
import { resolveTenant } from '@/lib/tenancy/tenant-context'
import { FLAGSHIP_TENANT_ID } from '@/lib/payments/wallet'

// Server-side access to the messaging-templates library (messaging-service). The flagship store has
// no tenant context, so it speaks to messaging-service as the platform tenant (whose templates ARE the
// standard library) — without this, every flagship send/lookup was silently skipped.

const MESSAGING_URL = (process.env.MESSAGING_URL || 'http://localhost:3101').replace(/\/$/, '')
export type Channel = 'email' | 'sms' | 'whatsapp'

export async function messagingTenant(): Promise<{ tenantId: string; slug: string }> {
  const t = await resolveTenant()
  return t ? { tenantId: t.tenantId, slug: t.slug } : { tenantId: FLAGSHIP_TENANT_ID, slug: 'platform' }
}

export function serviceToken(tenantId: string, tenantSlug: string): string {
  const secret = process.env.SERVICE_AUTH_SECRET
  if (!secret) throw new Error('SERVICE_AUTH_SECRET is not set')
  const payload = JSON.stringify({ service: 'platform', internal: true, tenantId, tenantSlug, exp: Math.floor(Date.now() / 1000) + 60 })
  const sig = createHmac('sha256', secret).update(payload).digest()
  return `${Buffer.from(payload).toString('base64url')}.${sig.toString('base64url')}`
}

export interface LibraryTemplate {
  id: string
  slug: string
  name: string
  channel: Channel
  category: string | null
  subject: string | null
  body: string
  blocks: any
  blocks_format: string | null
  variables: string[]
  provider_ref: string | null
  approval_status: string | null
  media_type: string | null
  /** Email: 'none' = send the HTML as written, without the store layout. */
  layout: 'store' | 'none'
}

const cache = new Map<string, { at: number; t: LibraryTemplate | null }>()
const TTL = 60_000

/** The tenant's copy of a template, else the standard one. Cached 60 s per tenant. */
export async function getLibraryTemplate(channel: Channel, slug: string): Promise<LibraryTemplate | null> {
  const { tenantId, slug: tenantSlug } = await messagingTenant()
  const key = `${tenantId}|${channel}|${slug}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.t
  let t: LibraryTemplate | null = null
  try {
    const r = await fetch(`${MESSAGING_URL}/v2/templates/${channel}/${encodeURIComponent(slug)}`, {
      headers: { authorization: `Bearer ${serviceToken(tenantId, tenantSlug)}` },
      cache: 'no-store',
    })
    if (r.ok) {
      const a = await r.json()
      const v = a.current_version ?? {}
      t = {
        id: a.id, slug: a.slug, name: a.name, channel: a.channel, category: a.category ?? null,
        subject: v.subject ?? null, body: v.body ?? '', blocks: v.blocks ?? null, blocks_format: v.blocks_format ?? null,
        variables: v.variables ?? [], provider_ref: a.provider_ref ?? null, approval_status: a.approval_status ?? null,
        media_type: a.media_type ?? null, layout: v.layout === 'none' ? 'none' : 'store',
      }
    }
  } catch { /* messaging-service down → caller falls back */ }
  cache.set(key, { at: Date.now(), t })
  return t
}
