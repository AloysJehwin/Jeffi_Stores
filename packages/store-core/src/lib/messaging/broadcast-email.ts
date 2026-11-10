import { getS3Url } from '@jeffi/tenancy'
import { queryOne } from '@/lib/shared/db'
import { renderBlocks } from '@/lib/templates/blocks'
import { renderTemplate } from '@/lib/templates/variables'
import { renderCampaignTemplate } from '@/lib/shared/automation-emails'
import { baseLayout } from '@/lib/shared/email-campaigns'
import { unsubscribeFooter } from '@/lib/shared/marketing'
import type { LibraryTemplate } from '@/lib/messaging/library'
import { MAX_ATTACHMENT_BYTES, emailLayoutKey, isCustomEmail, type EmailAttachment, type MessagingEmail } from './broadcast-shared'

// One renderer for a Messaging email — the composer's preview, the test send and the real send all use it,
// so what the admin sees is what goes out.

function bodySource(email: MessagingEmail, template: LibraryTemplate | null): string {
  if (isCustomEmail(email)) return email.format === 'blocks' ? renderBlocks(email.blocks ?? []) : email.body ?? ''
  if (!template) return ''
  const blocks = template.blocks_format === 'email-blocks' && Array.isArray(template.blocks?.blocks) ? renderBlocks(template.blocks.blocks) : ''
  return blocks || template.body
}

function innerDocument(doc: string): string {
  const styles = (doc.match(/<style[\s\S]*?<\/style>/gi) ?? []).join('')
  const inner = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(doc)?.[1] ?? doc.replace(/<\/?(html|head|body)[^>]*>|<!doctype[^>]*>|<meta[^>]*>|<title>[\s\S]*?<\/title>/gi, '')
  return styles + inner
}

export function renderBroadcastEmail(p: {
  email: MessagingEmail
  template: LibraryTemplate | null
  scenario: Record<string, string>
  registered: Record<string, string>
  baseUrl: string
  fallbackSubject: string
  /** Real sends carry the recipient's unsubscribe link; previews pass '#'. */
  unsubscribeUrl?: string | null
}): { subject: string; preheader: string; html: string; layout: string } {
  const { email, template, scenario, registered } = p
  const custom = isCustomEmail(email)
  const subject = renderCampaignTemplate(email.subject || (custom ? '' : template?.subject) || p.fallbackSubject, scenario, registered, false)
  const preheader = renderCampaignTemplate(email.preheader || (custom ? '' : template?.preheader) || '', scenario, registered, false)
  const footer = p.unsubscribeUrl ? unsubscribeFooter(p.unsubscribeUrl, registered.store_name) : ''
  const layout = emailLayoutKey(email, template?.layout)
  let body = renderCampaignTemplate(bodySource(email, template), scenario, registered, true)
  // A full designed document inside the store layout would nest one email inside another: keep its styles and body only.
  if (layout !== 'none' && /^\s*(<!doctype|<html)/i.test(body)) body = innerDocument(body)
  // A full designed document keeps its own <body>: the footer goes inside it.
  body = /<\/body>/i.test(body) ? body.replace(/<\/body>/i, `${footer}</body>`) : body + footer
  const html = renderTemplate(baseLayout(subject, body, p.baseUrl, layout, preheader || undefined), registered, { escape: true })
  return { subject, preheader, html, layout }
}

/** Downloads the message's attachments once per send. Only files uploaded through the composer are accepted. */
export async function loadAttachments(list?: EmailAttachment[] | null): Promise<{ filename: string; content: Buffer; contentType: string }[]> {
  if (!list?.length) return []
  const allowed = getS3Url('template-assets/mailer/')
  let total = 0
  const out: { filename: string; content: Buffer; contentType: string }[] = []
  for (const a of list) {
    if (!a.url.startsWith(allowed)) throw new Error(`Attachment ${a.name} is not a file uploaded for this store`)
    const r = await fetch(a.url)
    if (!r.ok) throw new Error(`Attachment ${a.name} could not be downloaded (HTTP ${r.status})`)
    const content = Buffer.from(await r.arrayBuffer())
    total += content.length
    if (total > MAX_ATTACHMENT_BYTES) throw new Error('Attachments are over 5 MB in total')
    out.push({ filename: a.name, content, contentType: a.mime || 'application/octet-stream' })
  }
  return out
}

/** The message's library template (null for one written in the composer); `missing` when the slug is gone. */
export async function loadBroadcastTemplate(email: MessagingEmail): Promise<{ template: LibraryTemplate | null; missing: boolean }> {
  if (isCustomEmail(email) || !email.slug) return { template: null, missing: !isCustomEmail(email) }
  const { getLibraryTemplate } = await import('@/lib/messaging/library')
  const template = await getLibraryTemplate('email', email.slug)
  return { template, missing: !template }
}

export async function loadBroadcastCoupon(id: unknown): Promise<{ id: string; code: string; discount_type: string; discount_value: number } | null> {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return null
  return queryOne(`SELECT id, code, discount_type, discount_value FROM coupons WHERE id = $1`, [id])
}
