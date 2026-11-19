import 'server-only'
import {
  AUDIENCE_CHANNELS, deleteTenantSender, listPendingWhatsAppSenders, listTenantSenders, saveTenantSender, setTenantSenderStatus, updateSenderMeta,
  type SenderAudience, type TenantSenderMeta,
} from '@/lib/messaging/tenant-senders'
import { numberProvider } from '@controller/lib/messaging/number-provider'

// A store's numbers bought by the platform: one Twilio number per audience, bound to every channel the audience has
// (customer: WhatsApp + SMS; admin: WhatsApp), registered as a WhatsApp sender, and released when the store stops.
// The rows carry no credentials (platform_account): they send through the platform's Twilio account. The WhatsApp row
// stays pending (lookups skip it, so the audience's previous number keeps sending) until the sender is Online.

export interface ProvisionResult {
  number: string
  numberSid: string
  whatsapp: { sid: string; status: string } | null
  error?: string
}

export async function provisionTenantNumber(i: {
  tenantId: string
  audience: SenderAudience
  number: string
  displayName: string
  storeSlug: string
  createdBy: string | null
}): Promise<ProvisionResult> {
  const p = numberProvider()
  const existing = (await listTenantSenders(i.tenantId)).filter(s => s.audience === i.audience)
  if (existing.length) throw new Error('This audience already has a number. Release it first.')
  const bought = await p.buy(i.number, `${i.storeSlug} ${i.audience}`)
  for (const channel of AUDIENCE_CHANNELS[i.audience]) {
    await saveTenantSender({
      tenantId: i.tenantId, channel, audience: i.audience, provider: 'twilio', sender: bought.number, config: {},
      platformAccount: true, extraMeta: { number_sid: bought.sid }, createdBy: i.createdBy, status: channel === 'whatsapp' ? 'pending' : 'active',
    })
  }
  try {
    const wa = await p.registerWhatsApp(bought.number, i.displayName)
    await updateSenderMeta(i.tenantId, 'whatsapp', i.audience, { wa_sender_sid: wa.sid, wa_status: wa.status, wa_display_name: i.displayName, wa_checked_at: new Date().toISOString() })
    if (wa.status === 'ONLINE') await setTenantSenderStatus(i.tenantId, 'whatsapp', i.audience, 'active')
    return { number: bought.number, numberSid: bought.sid, whatsapp: wa }
  } catch (e: any) {
    // The number is bought and bound for SMS; WhatsApp can be retried from the store page.
    const error = String(e?.message ?? e).slice(0, 300)
    await updateSenderMeta(i.tenantId, 'whatsapp', i.audience, { wa_status: 'NOT_REGISTERED', wa_error: error, wa_display_name: i.displayName })
    return { number: bought.number, numberSid: bought.sid, whatsapp: null, error }
  }
}

/** Retry WhatsApp registration for a bought number whose registration failed. */
export async function retryWhatsApp(tenantId: string, audience: SenderAudience, displayName: string): Promise<{ sid: string; status: string }> {
  const row = (await listTenantSenders(tenantId)).find(s => s.audience === audience && s.channel === 'whatsapp')
  if (!row?.meta.platform_account) throw new Error('No platform-bought WhatsApp number for this audience')
  const wa = await numberProvider().registerWhatsApp(row.sender, displayName)
  await updateSenderMeta(tenantId, 'whatsapp', audience, { wa_sender_sid: wa.sid, wa_status: wa.status, wa_display_name: displayName, wa_error: null, wa_checked_at: new Date().toISOString() })
  await setTenantSenderStatus(tenantId, 'whatsapp', audience, wa.status === 'ONLINE' ? 'active' : 'pending')
  return wa
}

/** Refresh the WhatsApp status of every platform-bought number of the store; returns the rows after. */
export async function refreshTenantNumbers(tenantId: string): Promise<TenantSenderMeta[]> {
  const p = numberProvider()
  for (const s of await listTenantSenders(tenantId)) {
    const sid = typeof s.meta.wa_sender_sid === 'string' ? s.meta.wa_sender_sid : null
    if (s.channel !== 'whatsapp' || !sid) continue
    const st = await p.whatsAppStatus(sid).catch(e => ({ status: 'UNKNOWN', reason: String(e?.message ?? e).slice(0, 200) }))
    await updateSenderMeta(tenantId, 'whatsapp', s.audience, { wa_status: st.status, wa_error: st.reason, wa_checked_at: new Date().toISOString() })
    if (st.status === 'ONLINE' && s.status === 'pending') await setTenantSenderStatus(tenantId, 'whatsapp', s.audience, 'active')
  }
  return listTenantSenders(tenantId)
}

/** The cron's pass over every store and the flagship: a pending WhatsApp number starts sending once it is Online. */
export async function activateOnlineWhatsAppNumbers(): Promise<{ checked: number; activated: number }> {
  const p = numberProvider()
  const pending = await listPendingWhatsAppSenders()
  let activated = 0
  for (const r of pending) {
    const st = await p.whatsAppStatus(r.senderSid).catch(e => ({ status: 'UNKNOWN', reason: String(e?.message ?? e).slice(0, 200) }))
    await updateSenderMeta(r.tenantId, 'whatsapp', r.audience, { wa_status: st.status, wa_error: st.reason, wa_checked_at: new Date().toISOString() })
    if (st.status !== 'ONLINE') continue
    await setTenantSenderStatus(r.tenantId, 'whatsapp', r.audience, 'active')
    activated++
  }
  return { checked: pending.length, activated }
}

/** Remove the audience's number from WhatsApp and from Twilio (charges stop), then unbind it from the store. */
export async function releaseTenantNumber(tenantId: string, audience: SenderAudience): Promise<void> {
  const rows = (await listTenantSenders(tenantId)).filter(s => s.audience === audience)
  if (!rows.length) return
  const numberSid = rows.map(r => r.meta.number_sid).find((v): v is string => typeof v === 'string') ?? null
  const senderSid = rows.map(r => r.meta.wa_sender_sid).find((v): v is string => typeof v === 'string') ?? null
  if (rows.some(r => r.meta.platform_account)) await numberProvider().release(numberSid, senderSid)
  for (const r of rows) await deleteTenantSender(tenantId, r.channel, audience)
}
