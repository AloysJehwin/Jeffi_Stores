import 'server-only'
import { findSenderByNumber, hasOwnAudienceSender, PLATFORM_TENANT_ID, type SenderAudience } from '@/lib/messaging/tenant-senders'

// Inbound WhatsApp / SMS: the number a message was sent to says which store and which audience it is for
// (tenant_messaging_senders), so a store's customer, admin and (flagship) ecom numbers can share one webhook URL.
// A number with no row is the platform env's customer number, or the store named by the legacy `?t=` hint.

export interface InboundTarget {
  /** null = the flagship. */
  tenantId: string | null
  audience: SenderAudience
  /** The store's own Twilio auth token, to check a signature made by its own account. */
  authToken?: string
  /** The store has a separate admin WhatsApp number, so its customer number never reaches the admin assistant. */
  separateAdminNumber: boolean
}

export async function resolveInbound(to: string, channel: 'sms' | 'whatsapp', hint?: string | null): Promise<InboundTarget> {
  const own = await findSenderByNumber(to, channel)
  const raw = own?.tenantId ?? (hint || null)
  const tenantId = raw && raw !== PLATFORM_TENANT_ID ? raw : null
  const audience = own?.audience ?? 'customer'
  const separateAdminNumber =
    audience === 'admin' || (channel === 'whatsapp' && (await hasOwnAudienceSender(tenantId ?? PLATFORM_TENANT_ID, 'whatsapp', 'admin')))
  return { tenantId, audience, authToken: own?.provider === 'twilio' ? own.config.auth_token : undefined, separateAdminNumber }
}
