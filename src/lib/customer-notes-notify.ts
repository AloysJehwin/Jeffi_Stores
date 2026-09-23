import { transporter } from './email'
import { ownerAdminEmails, listNotesSince, type CustomerNote } from './customer-notes'
import { getStoreIdentity } from './site-controls'

const FROM = process.env.EMAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@jeffistores.in'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function noteHtml(n: CustomerNote & { customerName?: string }): string {
  const photos = n.attachments.filter(a => a.kind === 'image')
  const audio = n.attachments.filter(a => a.kind === 'audio')
  return `
    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin:0 0 12px">
      ${n.customerName ? `<div style="font-size:12px;color:#6b7280">${esc(n.customerName)}${n.orderNumber ? ` &middot; Order ${esc(n.orderNumber)}` : ''}</div>` : ''}
      ${n.title ? `<div style="font-weight:600;margin-top:4px">${esc(n.title)}</div>` : ''}
      ${n.body ? `<div style="margin-top:4px;white-space:pre-wrap">${esc(n.body)}</div>` : ''}
      ${n.tags.length ? `<div style="margin-top:6px;font-size:12px;color:#6b7280">Tags: ${n.tags.map(esc).join(', ')}</div>` : ''}
      ${photos.length ? `<div style="margin-top:8px">${photos.map(p => `<a href="${p.url}"><img src="${p.thumbnailUrl || p.url}" width="96" height="96" style="object-fit:cover;border-radius:6px;margin:0 6px 6px 0" alt=""></a>`).join('')}</div>` : ''}
      ${audio.length ? `<div style="margin-top:6px;font-size:12px">${audio.map(a => `<a href="${a.url}">Voice memo${a.durationSeconds ? ` (${a.durationSeconds}s)` : ''}</a>`).join(' &middot; ')}</div>` : ''}
      <div style="margin-top:6px;font-size:11px;color:#9ca3af">${n.adminUsername ? `by ${esc(n.adminUsername)} &middot; ` : ''}${new Date(n.createdAt).toLocaleString('en-IN')}</div>
    </div>`
}

/** Tell the store owner(s) a staff member captured a note (best-effort, never throws). */
export async function notifyOwnersOfNote(note: CustomerNote, actor: { email: string; name: string | null }): Promise<void> {
  try {
    const recipients = await ownerAdminEmails(actor.email)
    if (recipients.length === 0) return
    const { name: storeName } = await getStoreIdentity()
    const subject = `${storeName}: new customer note${note.title ? ` - ${note.title}` : ''}`
    const html = `
      <div style="font-family:system-ui,sans-serif;max-width:560px">
        <p>${esc(actor.name || actor.email)} added a customer note from the staff form.</p>
        ${noteHtml(note)}
        <p style="font-size:12px;color:#6b7280">Open the customer in the admin panel to reply, share it with the customer, or turn it into a task.</p>
      </div>`
    await Promise.all(recipients.map(r => transporter.sendMail({ from: FROM, to: r.email, subject, html }).catch(() => {})))
  } catch { /* notification is best-effort */ }
}

/** Daily digest of notes added in the last `hours` hours, sent to owners. Returns the count. */
export async function sendNotesDigest(hours = 24): Promise<number> {
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString()
  const notes = await listNotesSince(since)
  if (notes.length === 0) return 0
  const recipients = await ownerAdminEmails(null)
  if (recipients.length === 0) return 0
  const { name: storeName } = await getStoreIdentity()
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px">
      <p>${notes.length} customer note${notes.length === 1 ? '' : 's'} were added in the last ${hours} hours.</p>
      ${notes.map(noteHtml).join('')}
    </div>`
  await Promise.all(recipients.map(r =>
    transporter.sendMail({ from: FROM, to: r.email, subject: `${storeName}: ${notes.length} new customer note${notes.length === 1 ? '' : 's'}`, html }).catch(() => {})
  ))
  return notes.length
}
