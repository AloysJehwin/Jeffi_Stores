import { z } from 'zod'

export * from './whatsapp-rules'
export * from './wa-cloud'
export * from './google-tag'
export * from './product-sort'

// Shared request/response contracts for public.jeffistores.in. Used by the gateway, the services,
// the dashboard proxies, and OpenAPI generation. Keep every public shape here.

export const Channel = z.enum(['email', 'sms', 'whatsapp'])
export type Channel = z.infer<typeof Channel>
export const DocumentType = z.enum(['invoice', 'quotation', 'receipt', 'packing_slip', 'label', 'purchase_order'])
export type DocumentType = z.infer<typeof DocumentType>

export const Slug = z.string().regex(/^[a-z0-9][a-z0-9-/_]{1,79}$/, 'lowercase slug')
const Vars = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({})
const Phone = z.string().regex(/^\+?[0-9]{10,15}$/, 'E.164 or 10-digit Indian number')
const Email = z.string().email()

// ── messages ──
// Host header media for WhatsApp: a link from anywhere (any image format), or a file as base64.
export const HostMediaRequest = z
  .object({ url: z.string().url().optional(), data: z.string().optional(), content_type: z.string().optional() })
  .refine(b => !!b.url !== !!b.data, { message: 'Pass either url, or data with content_type' })
export const HostedMedia = z.object({ id: z.string(), url: z.string().url(), charged_inr: z.number() })
export const SendMessageRequest = z
  .object({
    channel: Channel,
    to: z.string().min(3),
    template: Slug.optional(),
    variables: Vars.optional(),
    subject: z.string().max(200).optional(),
    body: z.string().max(20000).optional(),
    from: z.string().optional(),
    provider_ref: z.string().max(80).optional(), // WhatsApp: a Twilio content SID when not using a stored template
    reference: z.string().max(120).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    brand: z.string().max(120).optional(),
    kicker: z.string().max(120).optional(),
    footer_contact: z.string().max(200).optional(),
    // WhatsApp templates with an image header / link button: pass full URLs, the service fills their {{n}}.
    media_url: z.string().url().optional(),
    button_url: z.string().url().optional(),
  })
  .refine(m => m.template || m.body, { message: 'Provide template or body' })
  .refine(m => (m.channel === 'email' ? Email.safeParse(m.to).success : Phone.safeParse(m.to).success), {
    message: 'to must be an email address for channel=email, or a phone number otherwise',
    path: ['to'],
  })
export type SendMessageRequest = z.infer<typeof SendMessageRequest>

export const MessageStatus = z.enum(['queued', 'sent', 'delivered', 'failed', 'skipped'])
export const Message = z.object({
  id: z.string().uuid(),
  channel: Channel,
  to: z.string(),
  template: z.string().nullable(),
  status: MessageStatus,
  provider_ref: z.string().nullable(),
  price_inr: z.number(),
  charged_inr: z.number(),
  error: z.string().nullable(),
  reference: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type Message = z.infer<typeof Message>

export const BatchMessageRequest = z.object({
  channel: Channel,
  template: Slug,
  recipients: z.array(z.object({
    to: z.string().min(3), variables: Vars.optional(), reference: z.string().optional(),
    media_url: z.string().url().optional(), button_url: z.string().url().optional(),
  })).min(1).max(500),
  variables: Vars.optional(),
  subject: z.string().max(200).optional(),
  media_url: z.string().url().optional(),
  button_url: z.string().url().optional(),
})
const BulkRecipient = z.object({
  to: z.string().min(3), variables: Vars.optional(), reference: z.string().optional(),
  media_url: z.string().url().optional(), button_url: z.string().url().optional(),
})
export const BulkMessagesRequest = z.object({
  channel: Channel,
  template: Slug,
  recipients: z.array(BulkRecipient).min(1).max(10000),
  variables: Vars.optional(),
  subject: z.string().max(200).optional(),
  media_url: z.string().url().optional(),
  button_url: z.string().url().optional(),
  reference: z.string().max(120).optional(),
})
export type BulkMessagesRequest = z.infer<typeof BulkMessagesRequest>
export const BatchMessageResponse = z.object({ batch_id: z.string().uuid(), accepted: z.number(), rejected: z.array(z.object({ to: z.string(), reason: z.string() })) })

// ── push (internal only: the store's own app over FCM; not a public Channel) ──
export const PushCategory = z.enum(['orders', 'account', 'offers', 'price_alerts'])
export type PushCategory = z.infer<typeof PushCategory>
export const SendPushRequest = z.object({
  tokens: z.array(z.string().min(20).max(512)).min(1).max(500),
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(1000),
  image: z.string().url().optional(),
  link: z.string().max(500).optional(), // storefront path the app opens on tap
  category: PushCategory,
  collapse_key: z.string().max(64).optional(),
  data: z.record(z.string(), z.string()).optional(),
  reference: z.string().max(120).optional(),
})
export type SendPushRequest = z.infer<typeof SendPushRequest>
export const SendPushResponse = z.object({
  results: z.array(z.object({ token: z.string(), ok: z.boolean(), message_id: z.string().nullable(), error: z.string().nullable(), invalid_token: z.boolean() })),
})
export type SendPushResponse = z.infer<typeof SendPushResponse>

// ── templates ──
export const Template = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  channel: Channel,
  name: z.string(),
  subject: z.string().nullable(),
  body: z.string(),
  variables: z.array(z.string()),
  provider_ref: z.string().nullable(),
  system: z.boolean(),
  status: z.enum(['active', 'archived']),
  created_at: z.string(),
})
export const UpsertTemplateRequest = z.object({
  slug: Slug,
  channel: Channel,
  name: z.string().min(1).max(120),
  subject: z.string().max(200).optional(),
  body: z.string().min(1).max(20000),
  provider_ref: z.string().max(80).optional(),
})
// Templates library (v2): a template per (slug, channel); every save is a new version.
const WaButton = z.object({ type: z.enum(['quick_reply', 'url', 'phone']), label: z.string().min(1).max(25), value: z.string().max(2000).optional() })
export const TemplateBlocks = z.object({
  variables: z.record(z.string(), z.string()).optional().describe('WhatsApp: sample value per {{n}}, sent to Meta for review'),
  buttons: z.array(WaButton).max(3).optional(),
  carousel: z.object({ cards: z.array(z.object({ title: z.string().optional(), body: z.string().optional(), media_url: z.string().optional(), buttons: z.array(WaButton).max(2).optional() })).max(10) }).optional(),
  types: z.record(z.string(), z.unknown()).optional(),
}).passthrough()
export const UpsertLibraryTemplateRequest = z.object({
  slug: Slug,
  channel: Channel,
  name: z.string().min(1).max(120),
  category: z.string().max(32).optional(),
  description: z.string().max(500).optional(),
  locale: z.string().max(10).optional(),
  subject: z.string().max(200).optional(),
  body: z.string().min(1).max(20000),
  blocks: z.union([TemplateBlocks, z.array(z.unknown()), z.string()]).optional(),
  blocks_format: z.enum(['tiptap', 'tiptap-html', 'email-blocks', 'maily', 'mjml', 'wa-content', 'sms-text']).optional(),
  meta_category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']).optional(),
  media_type: z.enum(['image', 'video', 'document']).optional(),
  provider_ref: z.string().max(80).optional(),
  note: z.string().max(500).optional(),
  layout: z.enum(['store', 'none']).optional().describe("Email: 'store' (default) wraps the body in your branded layout; 'none' sends your HTML as written"),
  publish: z.boolean().default(true),
})
export type UpsertLibraryTemplateRequest = z.infer<typeof UpsertLibraryTemplateRequest>
export const UpdateLibraryTemplateRequest = UpsertLibraryTemplateRequest.omit({ slug: true, channel: true }).partial({ name: true, body: true })
export const LibraryTemplate = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  category: z.string().nullable(),
  channel: Channel,
  status: z.string(),
  source: z.enum(['tenant', 'platform']).optional(),
  provider_ref: z.string().nullable().optional(),
  approval_status: z.string().nullable().optional(),
  approval_reason: z.string().nullable().optional(),
  needs_resubmission: z.boolean().optional(),
  meta_category: z.string().nullable().optional(),
  media_type: z.string().nullable().optional(),
  current_version: z.object({
    id: z.string().uuid(), version: z.number(), subject: z.string().nullable(), body: z.string(),
    blocks: z.unknown(), blocks_format: z.string().nullable(), variables: z.array(z.string()), created_at: z.string(),
  }).nullable().optional(),
})
export const TemplatePreviewRequest = z.object({ channel: Channel, slug: Slug, locale: z.string().optional(), variables: Vars.optional() })

export const TemplateQuery = z.object({ channel: Channel.optional(), include_system: z.coerce.boolean().default(true) })

// ── documents ──
const Money = z.number().nonnegative()
export const Party = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
  gstin: z.string().length(15).optional(),
  email: Email.optional(),
  phone: z.string().optional(),
})
export const LineItem = z.object({
  description: z.string().min(1),
  hsn: z.string().optional(),
  quantity: z.number().positive(),
  unit: z.string().optional(),
  unit_price: Money,
  gst_rate: z.number().min(0).max(28).default(18),
  discount: Money.default(0).describe('Discount on this line, in rupees'),
  discount_pct: z.number().min(0).max(100).optional().describe('Discount on this line as a percentage (instead of `discount`)'),
}).refine(i => !(i.discount > 0 && i.discount_pct != null), { message: 'Use discount or discount_pct, not both', path: ['discount_pct'] })
  .refine(i => i.discount <= i.unit_price * i.quantity, { message: 'discount is more than the line amount', path: ['discount'] })
// Document-level discount, applied after line discounts and before GST, spread over the lines by value.
export const DocumentDiscount = z.object({
  amount: Money.optional(),
  percent: z.number().min(0).max(100).optional(),
  label: z.string().max(60).optional().describe('Shown on the document, e.g. "Festive offer"'),
}).refine(d => (d.amount != null) !== (d.percent != null), { message: 'Give either amount or percent' })
// Extra charges (shipping, packing, installation…) taxed at their own rate, priced like the items.
export const DocumentCharge = z.object({
  label: z.string().min(1).max(60),
  amount: Money,
  gst_rate: z.number().min(0).max(28).default(18),
  hsn: z.string().optional(),
})
export const DocumentFont = z.enum(['modern', 'geometric', 'classic', 'editorial', 'technical', 'system'])
const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a #rrggbb colour')
// Per-call branding; each field overrides the workspace's saved document settings.
export const DocumentBranding = z.object({ logo_url: z.string().url().optional(), accent: HexColor.optional(), font: DocumentFont.optional() })
export const RenderDocumentRequest = z.object({
  template: Slug.optional(), // design key; omitted = the workspace default
  branding: DocumentBranding.optional(),
  number: z.string().max(40).optional(),
  date: z.string().optional(),
  due_date: z.string().optional(),
  seller: Party,
  buyer: Party,
  ship_to: Party.optional(),
  items: z.array(LineItem).min(1).max(200),
  discount: DocumentDiscount.optional(),
  charges: z.array(DocumentCharge).max(10).optional(),
  round_off: z.boolean().optional().describe('Round the total to the nearest rupee'),
  amount_paid: Money.optional().describe('Already paid; the document shows the balance due'),
  prices_include_gst: z.boolean().default(true),
  notes: z.string().max(2000).optional(),
  terms: z.string().max(4000).optional(),
  currency: z.literal('INR').default('INR'),
  reference: z.string().max(120).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
export type RenderDocumentRequest = z.infer<typeof RenderDocumentRequest>
export const Document = z.object({
  id: z.string().uuid(),
  type: DocumentType,
  number: z.string(),
  template: z.string(),
  totals: z.object({
    subtotal: z.number(), discount: z.number(), charges: z.number(), taxable: z.number(),
    cgst: z.number(), sgst: z.number(), igst: z.number(), round_off: z.number(), total: z.number(),
    amount_paid: z.number(), balance_due: z.number(),
  }),
  pdf_url: z.string().url(),
  view_url: z.string().url(),
  price_inr: z.number(),
  reference: z.string().nullable(),
  created_at: z.string(),
})
export type Document = z.infer<typeof Document>
// Bulk: job-level type/template/branding/seller are defaults; each item is a render request that may omit them.
export const BulkDocumentsRequest = z.object({
  type: DocumentType.optional(),
  template: Slug.optional(),
  branding: DocumentBranding.optional(),
  seller: Party.optional(),
  reference: z.string().max(120).optional(),
  items: z.array(z.record(z.string(), z.unknown())).min(1).max(1000)
    .describe('Each item: the POST /v1/documents/{type} body, plus optional `type`. Missing type/template/branding/seller come from the job.'),
})
export type BulkDocumentsRequest = z.infer<typeof BulkDocumentsRequest>
export const BulkJob = z.object({
  id: z.string().uuid(), kind: z.enum(['documents', 'messages']),
  status: z.enum(['queued', 'running', 'completed', 'partial', 'failed', 'cancelled']),
  total: z.number(), succeeded: z.number(), failed: z.number(), skipped: z.number(), pending: z.number(),
  spent_inr: z.number(), reference: z.string().nullable(), error: z.string().nullable(),
  created_at: z.string(), started_at: z.string().nullable(), finished_at: z.string().nullable(),
  zip_url: z.string().optional(),
})
export const BulkItem = z.object({
  seq: z.number(), status: z.enum(['pending', 'running', 'done', 'failed', 'skipped']), error: z.string().nullable(),
  reference: z.string().nullable(), result: z.record(z.string(), z.unknown()).nullable(),
})
export const DocumentDesign = z.object({ key: z.string(), name: z.string(), description: z.string(), accent: z.string(), font: DocumentFont, thumbnail_url: z.string() })
export const DocumentSettings = z.object({ design: z.string().nullable(), accent: HexColor.nullable(), font: DocumentFont.nullable(), has_logo: z.boolean() })
export const DocumentSettingsUpdate = z.object({ design: Slug.nullable().optional(), accent: HexColor.nullable().optional(), font: DocumentFont.nullable().optional() })

// ── wallet / pricing ──
export const Wallet = z.object({ balance_inr: z.number(), spent_today_inr: z.number(), currency: z.literal('INR') })
export const ErrorResponse = z.object({ error: z.string(), message: z.string(), details: z.unknown().optional() })

export const API_SCOPES = ['messages:send', 'templates:read', 'templates:write', 'documents:render', 'documents:read', 'wallet:read'] as const
export type ApiScope = (typeof API_SCOPES)[number]
