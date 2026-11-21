import { NextRequest, NextResponse, after } from 'next/server'
import { z } from 'zod'
import { ownerApi } from '@controller/lib/ecom/owner-api'
import { parseBody } from '@/lib/shared/validate'
import { checkGstin, checkPan, ENTITY_TYPES, idChars, isEntityType } from '@controller/lib/kyb/ids'
import { MESSAGING_POLICY_VERSION, messagingUseProblem, websiteProblem, type MessagingUse } from '@controller/lib/kyb/requirements'
import { getKybRecord, saveKybProfile, LOCKED_WHEN_APPROVED, type KybProfileInput } from '@controller/lib/kyb/store'
import { loadKybView, normalizedProfile } from '@controller/lib/kyb/view'
import { queueRecheck } from '@controller/lib/kyb/analyze'

export const dynamic = 'force-dynamic'

/** The business's KYB: answers, documents with their checks, and what each service still needs. */
export async function GET(request: NextRequest) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  return NextResponse.json({ kyb: await loadKybView(ctx.tenant, ctx.owner.id) })
}

const text = (max: number) => z.string().trim().max(max)
const optional = (max: number) => text(max).nullable().optional()

const Body = z.object({
  legalName: text(200).min(2, 'Enter the legal name').optional(),
  tradeName: optional(200),
  entityType: z.string().refine(isEntityType, 'Pick the business type').optional(),
  addressLine: text(300).min(3, 'Enter the address').optional(),
  city: text(100).min(2, 'Enter the city').optional(),
  state: text(64).min(2, 'Pick the state').optional(),
  pincode: z.string().trim().regex(/^[1-9][0-9]{5}$/, 'Enter the 6-digit PIN code').optional(),
  authorizedName: text(120).min(2, 'Enter who signs for the business').optional(),
  authorizedDesignation: optional(80),
  mobile: optional(20),
  pan: z.string().optional(),
  gstRegistered: z.boolean().optional(),
  gstin: z.string().nullable().optional(),
  gstExemptReason: z.enum(['below_threshold', 'exempt_supplies', 'applied', 'other']).nullable().optional(),
  gstExemptNote: optional(500),
  website: optional(255),
  messagingUse: z
    .object({
      purposes: z.array(z.string()).max(4),
      volume: z.string().max(16),
      optIn: text(1000),
      sample: text(1000),
      accept: z.boolean(),
    })
    .nullable()
    .optional(),
})

const IDENTITY: (keyof KybProfileInput)[] = ['legalName', 'tradeName', 'entityType', 'pan', 'gstin', 'authorizedName']

/** Saves the fields sent (a section at a time). Fields Jeffi verified are locked once the business is approved. */
export async function PUT(request: NextRequest) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  const parsed = parseBody(Body, await request.json().catch(() => ({})))
  if (!parsed.ok) return parsed.response
  const b = parsed.data
  const current = normalizedProfile(await getKybRecord(ctx.tenant.id))

  const input: KybProfileInput = {}
  for (const k of ['legalName', 'tradeName', 'addressLine', 'city', 'state', 'pincode', 'authorizedName', 'authorizedDesignation', 'mobile', 'gstRegistered', 'gstExemptReason', 'gstExemptNote'] as const)
    if (b[k] !== undefined) (input as any)[k] = b[k]
  if (b.entityType !== undefined) input.entityType = b.entityType as KybProfileInput['entityType']
  if (b.pan !== undefined) input.pan = idChars(b.pan, 10)
  if (b.gstin !== undefined) input.gstin = b.gstin ? idChars(b.gstin, 15) : null
  if (b.website !== undefined) input.website = b.website || null

  const fail = (field: string, error: string) => NextResponse.json({ error, fields: { [field]: error } }, { status: 400 })

  // What Jeffi verified stays as verified.
  if (current?.status === 'approved') {
    const was: Record<string, unknown> = {
      legalName: current.business_name,
      entityType: current.entity_type,
      pan: current.pan,
      gstRegistered: current.gst_registered,
      gstin: current.gst_number,
    }
    const changed = LOCKED_WHEN_APPROVED.find(k => k in input && (input[k] ?? null) !== (was[k] ?? null))
    if (changed) return NextResponse.json({ error: 'Your verified business details can’t be changed here. Contact support to change them.', field: changed }, { status: 409 })
  }

  const entity = input.entityType ?? (isEntityType(current?.entity_type) ? current!.entity_type : null)
  const pan = input.pan ?? current?.pan ?? null
  const state = input.state ?? current?.address_state ?? null
  if (input.pan !== undefined) {
    const c = checkPan(input.pan, entity as any)
    if (!c.ok) return fail('pan', c.problem!)
  }
  const registered = input.gstRegistered ?? current?.gst_registered ?? null
  if (input.gstin && registered !== false) {
    const c = checkGstin(input.gstin, { pan, state })
    if (!c.ok) return fail('gstin', c.problem!)
  }
  if (input.gstRegistered === false && !(input.gstExemptReason ?? current?.gst_exempt_reason))
    return fail('gstExemptReason', 'Tell us why the business isn’t registered for GST.')
  if (input.website) {
    const w = websiteProblem(input.website)
    if (w) return fail('website', w)
  }
  if (b.messagingUse) {
    const m: MessagingUse = {
      purposes: b.messagingUse.purposes,
      volume: b.messagingUse.volume,
      optIn: b.messagingUse.optIn,
      sample: b.messagingUse.sample,
      policyVersion: b.messagingUse.accept ? MESSAGING_POLICY_VERSION : '',
      acceptedAt: b.messagingUse.accept ? new Date().toISOString() : '',
    }
    const problem = messagingUseProblem(m)
    if (problem) return fail('messagingUse', problem)
    input.messagingUse = m
  } else if (b.messagingUse === null) input.messagingUse = null

  await saveKybProfile(ctx.tenant.id, ctx.owner.id, input)

  // A changed name, PAN or GSTIN makes the documents' checks out of date: they run again.
  if (IDENTITY.some(k => k in input)) {
    const job = await queueRecheck(ctx.tenant.id)
    if (job.count) after(job.run)
  }
  return NextResponse.json({ kyb: await loadKybView(ctx.tenant, ctx.owner.id), entityTypes: ENTITY_TYPES })
}
