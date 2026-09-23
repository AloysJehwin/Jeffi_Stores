import { sendAuditedMail } from './mail-audit'
import { adminMailFrom, currentBrandNameAsync, currentAdminBaseUrl } from './brand'
import { ownerAdminEmails, listNotesSince, type CustomerNote } from './customer-notes'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const STYLES = `
  body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
  .container { background-color: #f9f9f9; border-radius: 10px; padding: 30px; border: 1px solid #e0e0e0; }
  .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 10px; text-align: center; margin-bottom: 30px; }
  .content { background-color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
  .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; }
  .info-label { font-weight: bold; color: #555; }
  .note-box { background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
  .tag { display: inline-block; background: #eef2ff; color: #4338ca; border-radius: 12px; padding: 2px 10px; font-size: 12px; margin: 0 6px 6px 0; }
  .thumb { width: 96px; height: 96px; object-fit: cover; border-radius: 6px; margin: 0 6px 6px 0; border: 1px solid #e0e0e0; }
  .button { display: inline-block; padding: 12px 30px; background-color: #28a745; color: #ffffff !important; text-decoration: none; border-radius: 5px; margin: 10px 5px; font-weight: bold; }
  .footer { text-align: center; color: #666; font-size: 12px; margin-top: 30px; }
`

function shell(brand: string, headerTitle: string, headerSub: string, content: string, cta: { href: string; label: string } | null): string {
  return `
      <!DOCTYPE html>
      <html>
        <head><style>${STYLES}</style></head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">${esc(headerTitle)}</h1>
              <p style="margin: 10px 0 0 0; opacity: 0.9;">${esc(headerSub)}</p>
            </div>
            ${content}
            ${cta ? `<div style="text-align: center; margin: 30px 0;"><a href="${cta.href}" class="button" style="color:#ffffff;">${esc(cta.label)}</a></div>` : ''}
            <div class="footer">
              <p>This is an automated notification from ${esc(brand)}.</p>
              <p>Open the customer in the admin panel to reply, share the note with the customer, or turn it into a task.</p>
            </div>
          </div>
        </body>
      </html>
    `
}

function noteCard(n: CustomerNote & { customerName?: string }, adminBase: string): string {
  const photos = n.attachments.filter(a => a.kind === 'image')
  const audio = n.attachments.filter(a => a.kind === 'audio')
  const rows: string[] = []
  if (n.customerName) rows.push(`<div class="info-row"><span class="info-label">Customer:</span><span><a href="${adminBase}/customers/${n.userId}" style="color:#667eea;">${esc(n.customerName)}</a></span></div>`)
  if (n.orderNumber) rows.push(`<div class="info-row"><span class="info-label">Order:</span><span>${esc(n.orderNumber)}</span></div>`)
  if (n.adminUsername) rows.push(`<div class="info-row"><span class="info-label">Added by:</span><span>${esc(n.adminUsername)}</span></div>`)
  rows.push(`<div class="info-row"><span class="info-label">Source:</span><span>${n.source === 'staff_form' ? 'Staff form' : 'Admin panel'}</span></div>`)
  rows.push(`<div class="info-row"><span class="info-label">Added:</span><span>${fmtDate(n.createdAt)}</span></div>`)
  if (n.sharedWithCustomer) rows.push(`<div class="info-row"><span class="info-label">Visibility:</span><span style="color:#28a745;font-weight:bold;">Shared with customer</span></div>`)
  return `
            <div class="content">
              ${n.title ? `<h2 style="color: #667eea; margin-top: 0;">${esc(n.title)}</h2>` : ''}
              ${rows.join('\n')}
              ${n.tags.length ? `<div style="margin-top: 14px;">${n.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
              ${n.body ? `<div class="note-box"><strong>Note:</strong><p style="margin: 10px 0 0 0; white-space: pre-wrap;">${esc(n.body)}</p></div>` : ''}
              ${photos.length ? `<div style="margin-top: 14px;">${photos.map(p => `<a href="${p.url}"><img class="thumb" src="${p.thumbnailUrl || p.url}" width="96" height="96" alt=""></a>`).join('')}</div>` : ''}
              ${audio.length ? `<p style="margin-top: 10px; font-size: 13px;">${audio.map(a => `<a href="${a.url}" style="color:#667eea;">Voice memo${a.durationSeconds ? ` (${a.durationSeconds}s)` : ''}</a>`).join(' &middot; ')}</p>` : ''}
            </div>`
}

/** Tell the store owner(s) a staff member captured a note (best-effort, never throws). */
export async function notifyOwnersOfNote(note: CustomerNote, actor: { email: string; name: string | null }): Promise<void> {
  try {
    const recipients = await ownerAdminEmails(actor.email)
    if (recipients.length === 0) return
    const brand = await currentBrandNameAsync()
    const adminBase = currentAdminBaseUrl()
    const subject = `New customer note${note.title ? ` - ${note.title}` : ''} - ${brand}`
    const html = shell(
      brand,
      'New Customer Note',
      `${actor.name || actor.email} added a note from the staff form`,
      noteCard(note, adminBase),
      { href: `${adminBase}/customers/${note.userId}`, label: 'Open Customer' }
    )
    await Promise.all(recipients.map(r =>
      sendAuditedMail({
        from: adminMailFrom(), to: r.email, subject, html,
        kind: 'admin_notification', templateName: 'customer_note_created',
        entityType: 'customer_note', entityId: note.id,
      }).catch(() => {})
    ))
  } catch { /* notification is best-effort */ }
}

/** Daily digest of notes added in the last `hours` hours, sent to owners. Returns the count. */
export async function sendNotesDigest(hours = 24): Promise<number> {
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString()
  const notes = await listNotesSince(since)
  if (notes.length === 0) return 0
  const recipients = await ownerAdminEmails(null)
  if (recipients.length === 0) return 0
  const brand = await currentBrandNameAsync()
  const adminBase = currentAdminBaseUrl()
  const count = `${notes.length} customer note${notes.length === 1 ? '' : 's'}`
  const html = shell(
    brand,
    'Customer Notes Digest',
    `${count} added in the last ${hours} hours`,
    notes.map(n => noteCard(n, adminBase)).join('\n'),
    { href: `${adminBase}/customers`, label: 'Open Customers' }
  )
  await Promise.all(recipients.map(r =>
    sendAuditedMail({
      from: adminMailFrom(), to: r.email, subject: `${count} added today - ${brand}`, html,
      kind: 'admin_notification', templateName: 'customer_notes_digest',
      entityType: null, entityId: null,
    }).catch(() => {})
  ))
  return notes.length
}
