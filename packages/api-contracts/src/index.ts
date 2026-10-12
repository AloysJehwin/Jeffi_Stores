import { z } from 'zod'

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
  recipients: z.array(z.object({ to: z.string().min(3), variables: Vars.optional(), reference: z.string().optional() })).min(1).max(500),
  variables: Vars.optional(),
  subject: z.string().max(200).optional(),
})
export const BatchMessageResponse = z.object({ batch_id: z.string().uuid(), accepted: z.number(), rejected: z.array(z.object({ to: z.string(), reason: z.string() })) })

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
  discount: Money.default(0),
})
export const RenderDocumentRequest = z.object({
  template: Slug.default('classic'),
  number: z.string().max(40).optional(),
  date: z.string().optional(),
  due_date: z.string().optional(),
  seller: Party,
  buyer: Party,
  ship_to: Party.optional(),
  items: z.array(LineItem).min(1).max(200),
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
  totals: z.object({ subtotal: z.number(), cgst: z.number(), sgst: z.number(), igst: z.number(), total: z.number() }),
  pdf_url: z.string().url(),
  view_url: z.string().url(),
  price_inr: z.number(),
  reference: z.string().nullable(),
  created_at: z.string(),
})
export type Document = z.infer<typeof Document>

// ── wallet / pricing ──
export const Wallet = z.object({ balance_inr: z.number(), spent_today_inr: z.number(), currency: z.literal('INR') })
export const ErrorResponse = z.object({ error: z.string(), message: z.string(), details: z.unknown().optional() })

export const API_SCOPES = ['messages:send', 'templates:read', 'templates:write', 'documents:render', 'documents:read', 'wallet:read'] as const
export type ApiScope = (typeof API_SCOPES)[number]
