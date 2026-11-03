import { z } from 'zod'

// The daily ops email (Site Controls > Daily email): when it goes, to whom, which sections it shows in
// which order, and which documents it attaches. Stored as JSON in site_settings.daily_ops_email; a store
// that never saved one keeps the original briefing (on for plans with the AI assistant, at 08:00 IST).

export const OPS_EMAIL_KEY = 'daily_ops_email'

export const OPS_SECTIONS = {
  ai_headline: { label: 'AI headline', hint: 'Two or three sentences on what matters most today.', scope: 'agent:read' },
  kpis: { label: "Yesterday's numbers", hint: 'Revenue, orders and average order value against the 7-day average.' },
  to_ship: { label: 'To ship', hint: 'Confirmed and packing orders not shipped yet, the late ones first.', days: 'Late after (days)' },
  stuck: { label: 'Stuck shipments', hint: 'Shipped but not delivered.', days: 'Stuck after (days)' },
  pending_payments: { label: 'Pending payments', hint: 'Unpaid orders that are not cancelled.', days: 'From the last (days)' },
  top_products: { label: 'Top products', hint: "Yesterday's best sellers by revenue.", limit: 'How many' },
  low_stock: { label: 'Low stock', hint: 'Active products at or below the threshold.', scope: 'inventory:read', threshold: 'At or below', limit: 'How many' },
  abandoned: { label: 'Abandoned checkouts', hint: 'Checkouts dropped in the last 24 hours.' },
  campaigns: { label: 'Campaigns', hint: 'Emails sent, opened, clicked and converted in the last 24 hours.', scope: 'campaigns:read' },
  support: { label: 'Support', hint: 'Open chats and customer replies waiting for an admin.', scope: 'customers:read' },
} as const satisfies Record<string, { label: string; hint: string; scope?: string; days?: string; limit?: string; threshold?: string }>

export type OpsSectionId = keyof typeof OPS_SECTIONS
export const OPS_SECTION_IDS = Object.keys(OPS_SECTIONS) as OpsSectionId[]

const Section = z.object({
  id: z.enum(OPS_SECTION_IDS as [OpsSectionId, ...OpsSectionId[]]),
  on: z.boolean(),
  days: z.number().int().min(1).max(60).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  threshold: z.number().int().min(0).max(100000).optional(),
})

export const OpsEmailSchema = z.object({
  v: z.literal(1),
  enabled: z.boolean(),
  hour: z.number().int().min(0).max(23),
  recipients: z.object({
    mode: z.enum(['all', 'roles', 'admins']),
    roles: z.array(z.string().max(50)).max(20),
    adminIds: z.array(z.string().uuid()).max(200),
    extra: z.array(z.string().trim().email().max(254)).max(10),
  }),
  subject: z.string().trim().max(150),
  intro: z.string().trim().max(1000),
  sections: z.array(Section).max(OPS_SECTION_IDS.length),
  attachments: z.object({
    labels: z.boolean(),
    labelSize: z.enum(['4x6', 'a4']),
    slips: z.boolean(),
    invoices: z.boolean(),
    maxMb: z.number().min(1).max(7),
  }),
  updatedBy: z.string().uuid().nullable(),
})

export type OpsEmailConfig = z.infer<typeof OpsEmailSchema>
export type OpsSection = OpsEmailConfig['sections'][number]

/** Subject tokens: {store} {date} {orders} {revenue}. */
export const DEFAULT_OPS_SUBJECT = 'Ops briefing: {date}, {orders} orders, {revenue}'

const SECTION_DEFAULTS: Record<OpsSectionId, OpsSection> = {
  ai_headline: { id: 'ai_headline', on: true },
  kpis: { id: 'kpis', on: true },
  to_ship: { id: 'to_ship', on: true, days: 2 },
  stuck: { id: 'stuck', on: true, days: 3 },
  pending_payments: { id: 'pending_payments', on: false, days: 3 },
  top_products: { id: 'top_products', on: true, limit: 5 },
  low_stock: { id: 'low_stock', on: true, threshold: 10, limit: 15 },
  abandoned: { id: 'abandoned', on: true },
  campaigns: { id: 'campaigns', on: true },
  support: { id: 'support', on: false },
}

export function defaultOpsEmail(enabled: boolean): OpsEmailConfig {
  return {
    v: 1,
    enabled,
    hour: 8,
    recipients: { mode: 'all', roles: [], adminIds: [], extra: [] },
    subject: DEFAULT_OPS_SUBJECT,
    intro: '',
    sections: OPS_SECTION_IDS.map(id => ({ ...SECTION_DEFAULTS[id] })),
    attachments: { labels: false, labelSize: '4x6', slips: false, invoices: false, maxMb: 7 },
    updatedBy: null,
  }
}

/** Unknown and repeated sections dropped, missing ones (and missing options) added with their defaults. */
export function normaliseOpsEmail(cfg: OpsEmailConfig): OpsEmailConfig {
  const seen = new Set<OpsSectionId>()
  const sections: OpsSection[] = []
  for (const s of cfg.sections) {
    if (!(s.id in OPS_SECTIONS) || seen.has(s.id)) continue
    seen.add(s.id)
    const d = SECTION_DEFAULTS[s.id]
    const out: OpsSection = { id: s.id, on: s.on }
    if (d.days !== undefined) out.days = s.days ?? d.days
    if (d.limit !== undefined) out.limit = s.limit ?? d.limit
    if (d.threshold !== undefined) out.threshold = s.threshold ?? d.threshold
    sections.push(out)
  }
  for (const id of OPS_SECTION_IDS) if (!seen.has(id)) sections.push({ ...SECTION_DEFAULTS[id], on: false })
  return { ...cfg, subject: cfg.subject || DEFAULT_OPS_SUBJECT, sections }
}

/** Validates a draft from the editor; unknown sections are dropped before validation. */
export function parseOpsEmailInput(input: unknown): { ok: true; value: OpsEmailConfig } | { ok: false; error: string } {
  const raw = typeof input === 'string' ? safeJson(input) : input
  if (raw && typeof raw === 'object' && Array.isArray((raw as any).sections))
    (raw as any).sections = (raw as any).sections.filter((s: any) => s && s.id in OPS_SECTIONS)
  const r = OpsEmailSchema.safeParse(raw)
  if (!r.success) {
    const i = r.error.issues[0]
    return { ok: false, error: `Daily email: ${i.path.join('.') || 'value'} ${i.message.toLowerCase()}` }
  }
  return { ok: true, value: normaliseOpsEmail(r.data) }
}

/** The stored value, or the defaults when it is missing or unreadable. */
export function readOpsEmail(stored: string | null | undefined, enabledByDefault: boolean): OpsEmailConfig {
  if (!stored) return defaultOpsEmail(enabledByDefault)
  const r = parseOpsEmailInput(stored)
  return r.ok ? r.value : defaultOpsEmail(enabledByDefault)
}

/** A section the plan includes; the rest show locked in the editor and are skipped when sending. */
export function sectionAvailable(id: OpsSectionId, has: (scope: string) => boolean): boolean {
  const scope = (OPS_SECTIONS[id] as { scope?: string }).scope
  return !scope || has(scope)
}

export const sectionOn = (cfg: OpsEmailConfig, id: OpsSectionId) => cfg.sections.find(s => s.id === id && s.on) ?? null

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

/** The plan scope each attachment needs (labels go with orders, which every plan has). */
export const OPS_ATTACHMENTS = {
  labels: { label: 'Shipping labels', scope: null },
  slips: { label: 'Packing slips', scope: 'packing_slips:read' },
  invoices: { label: 'Invoices', scope: 'invoices:read' },
} as const

export const attachmentAvailable = (kind: keyof typeof OPS_ATTACHMENTS, has: (scope: string) => boolean) => {
  const scope = OPS_ATTACHMENTS[kind].scope
  return !scope || has(scope)
}
