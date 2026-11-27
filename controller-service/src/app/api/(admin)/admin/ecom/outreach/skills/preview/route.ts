import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { outreachGuard, firstIssue, serverError } from '@controller/lib/outreach/guard'
import { outreachPool } from '@controller/lib/outreach/db'
import { getContact } from '@controller/lib/outreach/contacts'
import { knownBrief } from '@controller/lib/outreach/session'
import { greeting, shopperGreeting, type KnownBrief } from '@controller/lib/outreach/prompt'
import { allowedTools, llmSchemas } from '@controller/lib/outreach/agent/catalog'
import { personaNameFor, renderSystemPrompt, skillLanguage, STORE_NAME } from '@controller/lib/outreach/agent/skill/render'
import { getVersion } from '@controller/lib/outreach/agent/skill/store'
import { validateSkill } from '@controller/lib/outreach/agent/skill/validate'
import type { InputSpec, RenderContext, ResolvedRefs } from '@controller/lib/outreach/agent/types'

export const dynamic = 'force-dynamic'

const Schema = z.object({
  content: z.string().max(200_000).optional(),
  versionId: z.string().uuid().optional(),
  channel: z.enum(['voice', 'whatsapp', 'follow_up']),
  language: z.string().max(10).optional(),
  contactId: z.string().uuid().optional(),
})

const SAMPLE = { business: 'Sri Lakshmi Sweets', owner: 'Lakshmi', category: 'Sweet shop', city: 'Madurai', status: 'interested' as const }

const SAMPLE_INPUT: Partial<Record<InputSpec['type'], unknown>> = {
  phone: '+919876543210', email: 'asha@example.com', number: 3, money: 1240, date: '2026-11-20', datetime: '2026-11-20T10:30:00+05:30',
  url: 'https://example.com', boolean: true, language: 'en', order_ref: '1042', checkout_ref: 'cart:sample', product_ref: 'sample', customer_ref: 'sample',
}
const SAMPLE_REFS: ResolvedRefs = {
  order: { id: 'sample', number: '1042', status: 'delivered', paymentStatus: 'paid', paymentMethod: 'upi', total: '₹1,240', itemCount: 3, itemsShort: 'Drill set and 2 more', placedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(), deliveredAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), hasTracking: true },
  checkout: { key: 'cart:sample', kind: 'cart', total: '₹1,240', itemCount: 3, itemsShort: 'Drill set and 2 more', at: new Date(Date.now() - 3_600_000).toISOString() },
  product: { id: 'sample', name: 'Cordless drill', price: '₹2,499', inStock: true, slug: null },
  customer: { userId: 'sample', firstName: 'Asha', orderCount: 2, lastOrderAt: null },
}

// A shopper agent previews with a sample job: made-up inputs and references, never a real customer.
const sampleJob = (inputs: Record<string, InputSpec>): { inputs: Record<string, unknown>; refs: ResolvedRefs } => ({
  inputs: Object.fromEntries(Object.entries(inputs).map(([n, s]) => [n, s.role === 'name' ? 'Asha' : s.enum?.[0] ?? SAMPLE_INPUT[s.type] ?? `sample ${n}`])),
  refs: SAMPLE_REFS,
})

// POST → the exact system prompt, greeting and tool list the agent would get, for a sample or a real contact. No AI call.
export async function POST(req: NextRequest) {
  const admin = await outreachGuard(req, 'read')
  if (admin instanceof NextResponse) return admin
  const parsed = Schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 })
  const body = parsed.data
  if (body.content === undefined && !body.versionId) return NextResponse.json({ error: 'Send content or versionId' }, { status: 400 })
  try {
    let content = body.content
    if (content === undefined) {
      const v = await getVersion(body.versionId!)
      if (!v) return NextResponse.json({ error: 'Version not found' }, { status: 404 })
      content = v.content
    }
    const validation = validateSkill(content)
    const skill = validation.skill
    if (!skill) return NextResponse.json({ systemPrompt: '', greeting: null, tools: [], language: body.language ?? 'en', validation })

    let ctx: Omit<RenderContext, 'channel' | 'language' | 'personaName' | 'scriptVersion'> & { language?: string | null }
    if (body.contactId) {
      const c = await getContact(body.contactId)
      if (!c) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
      const [known, answered] = await Promise.all([
        knownBrief(c.id),
        outreachPool().query(`SELECT 1 FROM outreach_calls WHERE contact_id = $1 AND answered_at IS NOT NULL LIMIT 1`, [c.id]),
      ])
      ctx = {
        business: c.business_name,
        owner: c.owner_name,
        category: c.category,
        city: c.city,
        status: c.status,
        now: new Date(),
        continuing: answered.rows.length > 0,
        consentWhatsApp: !!c.consent_whatsapp_at,
        previewStarted: !!c.showcase_site_id,
        published: c.status === 'published' || c.status === 'claimed',
        known,
        windowOpen: true,
        language: c.language,
      }
    } else {
      ctx = { ...SAMPLE, now: new Date(), continuing: false, consentWhatsApp: false, previewStarted: false, published: false, known: {} as KnownBrief, windowOpen: true }
    }

    const shopper = skill.meta.audience === 'shopper'
    if (shopper) ctx = { ...ctx, ...sampleJob(skill.meta.inputs), audience: 'shopper', owner: 'Asha', business: '', consentWhatsApp: false }
    const language = skillLanguage(skill, body.language ?? ctx.language)
    const personaName = personaNameFor(skill, language)
    const full: RenderContext = {
      ...ctx,
      channel: body.channel,
      language,
      personaName,
      scriptVersion: skill.meta.scriptVersion ?? `${skill.meta.name}@preview`,
      trigger: body.channel === 'follow_up' ? { kind: 'follow_up', taskId: 'preview', reason: 'Preview', instruction: null } : undefined,
    }
    const tools = llmSchemas(allowedTools(body.channel, skill.meta.tools[body.channel]))
    return NextResponse.json({
      systemPrompt: renderSystemPrompt(skill, full),
      greeting: body.channel !== 'voice' ? null : shopper ? shopperGreeting({ language, personaName, store: STORE_NAME, name: full.owner, continuing: full.continuing }) : greeting({ language, personaName, business: full.business, owner: full.owner, continuing: full.continuing }),
      tools,
      language,
      validation,
    })
  } catch (e) {
    return serverError(e)
  }
}
