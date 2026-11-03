import 'server-only'
import { planSlots } from '@jeffi/api-contracts'
import { messagingTenant, serviceToken, type LibraryTemplate } from '@/lib/messaging/library'

// `_action` WhatsApp templates carry two {{n}} outside the body: the header image path (after a fixed
// CDN prefix) and the button's short-link code (after a fixed host). Meta approves the domains only,
// so each send fills them here, keyed by the slot Meta sees (planSlots numbers header and button after
// the body and {{brand_name}}). Returns null when no usable image exists — send the plain template then.

const MESSAGING_URL = (process.env.MESSAGING_URL || 'http://localhost:3101').replace(/\/$/, '')
const PH = /\{\{\s*(\d+)\s*\}\}/

export const plainSlug = (slug: string) => slug.replace(/_action$/, '')

export async function fillActionSlots(
  t: LibraryTemplate,
  ctx: { imageUrl?: string | null; linkUrl?: string | null }
): Promise<Record<string, string> | null> {
  const blocks = (t.blocks ?? {}) as any
  const media: string = blocks.types?.['twilio/media']?.media?.[0] ?? ''
  const plan = planSlots(t.body, blocks)
  const bi = (blocks.buttons ?? []).findIndex((b: any) => b.type === 'url' && PH.test(b.value ?? ''))
  const out: Record<string, string> = {}

  const mediaSlot = plan.media?.to
  if (mediaSlot) {
    const prefix = media.slice(0, media.search(PH))
    const { getStoreIdentity } = await import('@/lib/catalog/site-controls')
    const logo = await getStoreIdentity().then(s => s.logoUrl).catch(() => '')
    const image = [ctx.imageUrl, logo].find(u => u && u.startsWith(prefix))
    if (!image) return null
    out[mediaSlot] = image.slice(prefix.length)
  }

  const linkSlot = bi >= 0 ? plan.links[bi]?.to : undefined
  if (linkSlot) {
    const { storeBaseUrlAsync } = await import('@/lib/catalog/brand')
    const destination = ctx.linkUrl || (await storeBaseUrlAsync())
    const { tenantId, slug } = await messagingTenant()
    const r = await fetch(`${MESSAGING_URL}/short-links`, {
      method: 'POST',
      headers: { authorization: `Bearer ${serviceToken(tenantId, slug)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ destination_url: destination, kind: 'page' }),
    }).catch(() => null)
    const code = r?.ok ? (await r.json()).code : null
    if (!code) return null
    out[linkSlot] = code
  }
  return out
}
