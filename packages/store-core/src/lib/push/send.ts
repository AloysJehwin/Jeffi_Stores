import { sendPush, pushConfigured, type PushMessage, type PushResult } from '@jeffi/push'
import { callService } from '@/lib/ecom/service-client'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { messagingInline } from '@/lib/shared/messaging/remote'

// FCM sends. MESSAGING_INLINE (default) calls FCM in-process; otherwise messaging-service's
// internal /push does it and logs a `messages` row per token.

const BATCH = 500

/** Can a push go out at all? Remote mode can't see the service's credentials, so it assumes yes. */
export const pushReady = () => !messagingInline() || pushConfigured()

export async function sendToTokens(tokens: string[], msg: PushMessage & { reference?: string }): Promise<PushResult[]> {
  if (!tokens.length) return []
  const { reference, ...m } = msg
  if (messagingInline()) return sendPush(tokens, m)
  const tenantId = await resolveTenantId().catch(() => null)
  const fail = (list: string[], error: string) => list.map(token => ({ token, ok: false, error, invalidToken: false }))
  if (!tenantId) return fail(tokens, 'no tenant context')
  const out: PushResult[] = []
  for (let i = 0; i < tokens.length; i += BATCH) {
    const chunk = tokens.slice(i, i + BATCH)
    const body = {
      tokens: chunk,
      title: m.title,
      body: m.body,
      image: m.image,
      link: m.link,
      category: m.category,
      collapse_key: m.collapseKey,
      data: m.data ? Object.fromEntries(Object.entries(m.data).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])) : undefined,
      reference,
    }
    const r = await callService('messaging', { id: tenantId, slug: '' }, '/push', { method: 'POST', body, internal: true }).catch(
      e => ({ status: 0, body: { message: String(e) } })
    )
    const results = (r.body as any)?.results
    if (r.status !== 200 || !Array.isArray(results)) {
      out.push(...fail(chunk, (r.body as any)?.message ?? `HTTP ${r.status}`))
      continue
    }
    for (const x of results) {
      out.push({ token: x.token, ok: !!x.ok, messageId: x.message_id ?? undefined, error: x.error ?? undefined, invalidToken: !!x.invalid_token })
    }
  }
  return out
}
