import { callService } from '@/lib/ecom/service-client'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'

// MESSAGING_INLINE (default 'true') keeps sends in-process. Set to 'false' to route the monolith's own
// transactional SMS / WhatsApp / email through messaging-service at provider cost (internal=true).
export const messagingInline = () => process.env.MESSAGING_INLINE !== 'false'

export async function remoteSend(req: {
  channel: 'sms' | 'whatsapp' | 'email'
  to: string
  body?: string
  subject?: string
  from?: string
  provider_ref?: string
  variables?: Record<string, string>
  reference?: string
  reply_to?: string
  metadata?: Record<string, unknown>
}): Promise<{ ok: boolean; id?: string; providerRef?: string; error?: string }> {
  const tenantId = await resolveTenantId()
  if (!tenantId) return { ok: false, error: 'no tenant context' }
  const r = await callService('messaging', { id: tenantId, slug: '' }, '/messages', { method: 'POST', body: req, internal: true }).catch(e => ({ status: 0, body: { message: String(e) } }))
  const b = r.body as any
  if (r.status !== 200 || b?.status === 'failed' || b?.status === 'skipped') return { ok: false, id: b?.id, error: b?.error ?? b?.message ?? `HTTP ${r.status}` }
  return { ok: true, id: b.id, providerRef: b.provider_ref ?? undefined }
}
