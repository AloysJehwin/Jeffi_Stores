import 'server-only'
import { query, queryOne } from '@/lib/shared/db'
import { storeBaseUrlAsync } from '@/lib/catalog/brand'
import { sendSupportReplyWhatsApp, sendWhatsAppDirect } from '@/lib/shared/whatsapp'
import { cloudMediaKind } from '@jeffi/api-contracts'
import { getFileRow, signFile, s3Location } from '@/lib/drive/files'
import { getWhatsAppProvider } from '@/lib/shared/messaging'
import { setMessageStatus } from './messages'
import type { SessionRow } from './sessions'
import type { SupportMessage, SupportPayload } from './types'

// Agent/AI replies to a customer who wrote from WhatsApp. Inside the 24h window: free text plus each
// attachment as media. Outside it: the approved support/reply template, with a link to the web chat
// for anything that can't ride in a template.

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

/** Rich chat cards as plain WhatsApp text. */
export async function payloadText(payloads: SupportPayload[]): Promise<string> {
  const base = await storeBaseUrlAsync().catch(() => '')
  const parts: string[] = []
  for (const p of payloads) {
    if (p.type === 'orders') {
      parts.push(p.orders.map(o => `• #${o.number}: ${o.status.replace(/_/g, ' ')} · ${inr(o.total)}${o.tracking ? ` · AWB ${o.tracking}` : ''}`).join('\n'))
    } else if (p.type === 'confirm' && p.status === 'pending') {
      parts.push(`*${p.title}*${p.detail ? `\n${p.detail}` : ''}\n\nReply *YES* to confirm or *NO* to cancel.`)
    } else if (p.type === 'chips' && p.chips.length) {
      parts.push(`You can reply: ${p.chips.map(c => c.label).join(' · ')}`)
    } else if (p.type === 'links') {
      parts.push(p.links.map(l => `${l.label}: ${l.href.startsWith('http') ? l.href : `${base}${l.href}`}`).join('\n'))
    }
  }
  return parts.join('\n\n')
}

async function customerPhone(s: SessionRow): Promise<string | null> {
  if (s.contact_phone) return s.contact_phone
  if (!s.user_id) return null
  const u = await queryOne<{ phone: string | null }>(`SELECT phone FROM users WHERE id = $1`, [s.user_id])
  return u?.phone ?? null
}

export async function relayToWhatsApp(s: SessionRow, m: SupportMessage, textForCustomer: string): Promise<void> {
  const phone = await customerPhone(s)
  if (!phone) {
    await setMessageStatus(m.id, 'failed', 'No WhatsApp number for this customer')
    return
  }
  const fresh = await queryOne<{ wa_window_expires_at: string | null }>(`SELECT wa_window_expires_at FROM support_sessions WHERE id = $1`, [s.id])
  const inWindow = !!fresh?.wa_window_expires_at && new Date(fresh.wa_window_expires_at).getTime() > Date.now()
  const extra = await payloadText(m.payloads)
  const text = [textForCustomer, extra].filter(Boolean).join('\n\n').trim()

  if (!inWindow) {
    const link = `${await storeBaseUrlAsync().catch(() => '')}/support`
    const note = m.attachments.length ? `\n\n${m.attachments.length} attachment(s): ${link}` : ''
    const ok = await sendSupportReplyWhatsApp({ phone, message: `${text || 'You have a new message from support.'}${note}`.slice(0, 1000) })
    await setMessageStatus(m.id, ok ? 'sent' : 'failed', ok ? null : 'WhatsApp template send failed')
    return
  }

  const provider = await getWhatsAppProvider()
  let firstSid: string | null = null
  let failed: string | null = null
  if (text) {
    const sid = await sendWhatsAppDirect({ phone, text, kind: 'support_reply' })
    if (sid) firstSid = sid
    else failed = 'WhatsApp send failed'
  }
  for (const a of m.attachments) {
    const fileId = a.id ? await attachmentFileId(a.id) : null
    if (!fileId) continue
    const out = await sendDriveFileWhatsApp(phone, fileId, 'support_reply')
    if (out.sid) firstSid ??= out.sid
    else failed = `Couldn't send ${out.name ?? 'a file'} on WhatsApp`
  }
  if (firstSid) {
    await query(`UPDATE support_messages SET provider = $2, provider_sid = $3 WHERE id = $1`, [m.id, provider.name, firstSid])
    await setMessageStatus(m.id, 'sent')
  }
  if (failed) await setMessageStatus(m.id, 'failed', failed)
}

/** One Drive file as WhatsApp media (inside the 24h window), through a short-lived signed link. */
export async function sendDriveFileWhatsApp(phone: string, fileId: string, kind: string): Promise<{ sid: string | null; name: string | null }> {
  const f = await getFileRow(fileId, { withDeleted: true })
  if (!f) return { sid: null, name: null }
  const provider = await getWhatsAppProvider()
  const url = await signFile(f, { ttlSeconds: 15 * 60 })
  const sid = await sendWhatsAppDirect({
    phone,
    kind,
    media: {
      kind: cloudMediaKind(f.mime_type),
      mime: f.mime_type,
      filename: f.name,
      url,
      ...(provider.name === 'aws' && s3Location(f) ? { s3: s3Location(f)! } : {}),
    },
  })
  return { sid, name: f.name }
}

async function attachmentFileId(attachmentId: string): Promise<string | null> {
  const r = await queryOne<{ drive_file_id: string | null }>(`SELECT drive_file_id FROM support_message_attachments WHERE id = $1`, [attachmentId])
  return r?.drive_file_id ?? null
}
