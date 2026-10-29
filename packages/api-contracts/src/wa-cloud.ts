// WhatsApp Cloud API message bodies, as AWS End User Messaging Social passes them through to Meta
// (SendWhatsAppMessage takes the Cloud API JSON as a blob). Shared by the app and messaging-service.

/**
 * An AWS template reference: `aws:<metaName>:<lang>`, optionally followed by `|h=<slot>:<kind>` for a
 * header media slot and `|b=<slot>@<index>` per URL button with a variable. The numbered slots are
 * the planSlots() layout, so the same variable map serves Twilio and AWS.
 */
export interface AwsTemplateRef {
  name: string
  lang: string
  header?: { slot: string; kind: 'image' | 'video' | 'document' }
  buttons: Array<{ slot: string; index: number }>
}

export function isAwsTemplateRef(ref: string | null | undefined): boolean {
  return !!ref && ref.startsWith('aws:')
}

export function formatAwsTemplateRef(r: AwsTemplateRef): string {
  let s = `aws:${r.name}:${r.lang}`
  if (r.header) s += `|h=${r.header.slot}:${r.header.kind}`
  for (const b of r.buttons) s += `|b=${b.slot}@${b.index}`
  return s
}

export function parseAwsTemplateRef(ref: string): AwsTemplateRef {
  const [head, ...parts] = ref.split('|')
  const m = /^aws:([a-z0-9_]+):([A-Za-z_]{2,8})$/.exec(head)
  if (!m) throw new Error(`invalid AWS template ref: ${ref}`)
  const out: AwsTemplateRef = { name: m[1], lang: m[2], buttons: [] }
  for (const p of parts) {
    const h = /^h=(\d+):(image|video|document)$/.exec(p)
    if (h) out.header = { slot: h[1], kind: h[2] as 'image' | 'video' | 'document' }
    const b = /^b=(\d+)@(\d+)$/.exec(p)
    if (b) out.buttons.push({ slot: b[1], index: Number(b[2]) })
  }
  return out
}

const base = (to: string) => ({ messaging_product: 'whatsapp', recipient_type: 'individual', to: to.replace(/^\+/, '') })

export function cloudText(to: string, body: string) {
  return { ...base(to), type: 'text', text: { preview_url: true, body } }
}

export type CloudMediaKind = 'image' | 'video' | 'audio' | 'document'

/** Media by uploaded id (preferred) or by link. Audio takes no caption; documents carry a filename. */
export function cloudMedia(to: string, kind: CloudMediaKind, ref: { id?: string; link?: string }, opts: { caption?: string; filename?: string } = {}) {
  const obj: Record<string, string> = ref.id ? { id: ref.id } : { link: ref.link! }
  if (opts.caption && kind !== 'audio') obj.caption = opts.caption.slice(0, 1024)
  if (opts.filename && kind === 'document') obj.filename = opts.filename.slice(0, 240)
  return { ...base(to), type: kind, [kind]: obj }
}

export function cloudRead(messageId: string) {
  return { messaging_product: 'whatsapp', status: 'read', message_id: messageId }
}

/** A template send from the numbered variable map (body slots in order, header media, URL buttons). */
export function cloudTemplate(to: string, ref: AwsTemplateRef, vars: Record<string, string>) {
  const special = new Set([ref.header?.slot, ...ref.buttons.map(b => b.slot)].filter(Boolean) as string[])
  const bodyKeys = Object.keys(vars)
    .filter(k => /^\d+$/.test(k) && !special.has(k))
    .sort((a, b) => Number(a) - Number(b))
  const components: any[] = []
  if (ref.header && vars[ref.header.slot]) {
    components.push({ type: 'header', parameters: [{ type: ref.header.kind, [ref.header.kind]: { link: vars[ref.header.slot] } }] })
  }
  if (bodyKeys.length) {
    components.push({ type: 'body', parameters: bodyKeys.map(k => ({ type: 'text', text: String(vars[k] ?? '') })) })
  }
  for (const b of ref.buttons) {
    if (vars[b.slot] === undefined) continue
    components.push({ type: 'button', sub_type: 'url', index: String(b.index), parameters: [{ type: 'text', text: String(vars[b.slot]) }] })
  }
  return { ...base(to), type: 'template', template: { name: ref.name, language: { code: ref.lang }, ...(components.length ? { components } : {}) } }
}

export function cloudMediaKind(mime: string): CloudMediaKind {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'document'
}

// ── inbound (the Meta webhook entry AWS forwards through SNS) ──

export interface CloudInboundMessage {
  id: string
  from: string
  timestamp: string
  type: string
  text?: { body: string }
  image?: { id: string; mime_type?: string; caption?: string }
  video?: { id: string; mime_type?: string; caption?: string }
  audio?: { id: string; mime_type?: string }
  document?: { id: string; mime_type?: string; caption?: string; filename?: string }
  sticker?: { id: string; mime_type?: string }
  button?: { text?: string; payload?: string }
  interactive?: { type: string; button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string } }
  location?: { latitude: number; longitude: number; name?: string; address?: string }
  /** Set when the customer used "reply" on one of our messages: that message's id. */
  context?: { from?: string; id?: string }
}

export interface CloudStatus {
  id: string
  status: 'sent' | 'delivered' | 'read' | 'failed' | string
  timestamp?: string
  recipient_id?: string
  errors?: Array<{ code?: number; title?: string; message?: string }>
  pricing?: { billable?: boolean; category?: string; pricing_model?: string }
}

export interface CloudWebhookValue {
  metadata?: { display_phone_number?: string; phone_number_id?: string }
  contacts?: Array<{ wa_id: string; profile?: { name?: string } }>
  messages?: CloudInboundMessage[]
  statuses?: CloudStatus[]
}

/** Flatten a webhook entry (object or JSON string) into its `value` blocks. */
export function cloudWebhookValues(entry: unknown): CloudWebhookValue[] {
  const e = typeof entry === 'string' ? JSON.parse(entry) : entry
  const changes = (e as any)?.changes
  if (!Array.isArray(changes)) return []
  return changes.filter((c: any) => c?.value).map((c: any) => c.value as CloudWebhookValue)
}

/** The text a customer sent, for any inbound type (captions, button and list replies included). */
export function cloudInboundText(m: CloudInboundMessage): string {
  return (
    m.text?.body ??
    m.button?.text ??
    m.interactive?.button_reply?.title ??
    m.interactive?.list_reply?.title ??
    m.image?.caption ??
    m.video?.caption ??
    m.document?.caption ??
    (m.location ? [m.location.name, m.location.address, `${m.location.latitude},${m.location.longitude}`].filter(Boolean).join(' · ') : '') ??
    ''
  )
}

/** The media item on an inbound message, if any. */
export function cloudInboundMedia(m: CloudInboundMessage): { id: string; mime: string; filename?: string } | null {
  const it = m.image ?? m.video ?? m.audio ?? m.document ?? m.sticker
  if (!it?.id) return null
  return { id: it.id, mime: it.mime_type || 'application/octet-stream', filename: (m.document as any)?.filename }
}
