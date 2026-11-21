import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { createTenant, getOwnerTenants, linkOwnerTenant, updateOwnerName, saveKyc, markDraftSubmitted, requestServiceApproval, controlPlanePool } from '@/lib/tenant-registry'
import { sendServicesRequestedEmail } from '@/lib/shared/ecom-emails'
import { parseBody } from '@/lib/shared/validate'
import { GSTIN_MESSAGE, GSTIN_SHAPE, PAN_MESSAGE, PAN_SHAPE } from '@controller/lib/catalog/tax-ids'
import { KybProfileFields } from '@controller/lib/catalog/onboard-schema'
import { checkGstin, checkPan, kycBusinessType } from '@controller/lib/kyb/ids'
import { saveKybProfile } from '@controller/lib/kyb/store'

export const dynamic = 'force-dynamic'

// The business details KYB needs (lib/kyb); its documents are uploaded later, on the console's Business verification page.
const Schema = z
  .object({
    services: z.array(z.enum(['messaging', 'documents'])).min(1),
    slug: z.string().min(3).max(63),
    displayName: z.string().min(2).max(200),
    businessName: z.string().trim().min(2).max(200),
    ...KybProfileFields,
    pan: z.string().trim().toUpperCase().regex(PAN_SHAPE, PAN_MESSAGE),
    gstNumber: z.string().trim().toUpperCase().refine(v => v === '' || GSTIN_SHAPE.test(v), GSTIN_MESSAGE).optional(),
    ownerName: z.string().min(1).max(120),
    mobile: z.string().regex(/^\+\d{8,15}$/, 'Enter the mobile with its country code'),
    legalsAccepted: z.literal(true),
  })
  .superRefine((d, ctx) => {
    // The PAN suits the business type; a GSTIN carries that PAN and the address's state.
    const pan = PAN_SHAPE.test(d.pan) ? checkPan(d.pan, d.entityType) : null
    if (pan && !pan.ok) ctx.addIssue({ code: 'custom', path: ['pan'], message: pan.problem! })
    const gst = d.gstNumber ? checkGstin(d.gstNumber, { pan: d.pan, state: d.state }) : null
    if (gst && !gst.ok) ctx.addIssue({ code: 'custom', path: ['gstNumber'], message: gst.problem! })
  })

/**
 * Services-only onboarding (messaging / documents API, no store). Creates an ACTIVE tenant on the
 * free `services` plan — no subscription, no provisioning, no bank — with the welcome wallet credit.
 * The same tenant row (and wallet) is upgraded in place if the owner adds a store later.
 */
export async function POST(request: NextRequest) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  if ((await getOwnerTenants(owner.id)).length > 0) return NextResponse.json({ error: 'You already have a workspace.' }, { status: 400 })

  const parsed = parseBody(Schema, await request.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const d = parsed.data

  const result = await createTenant({ slug: d.slug, displayName: d.displayName, planSlug: 'services', status: 'active', serviceTypes: d.services })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  await linkOwnerTenant(owner.id, result.tenantId)
  await updateOwnerName(owner.id, d.ownerName)
  await saveKyc(result.tenantId, owner.id, {
    gst_number: d.gstNumber || null,
    pan: d.pan,
    business_name: d.businessName,
    business_type: kycBusinessType(d.entityType),
    business_address: [d.addressLine, d.city, `${d.state} ${d.pincode}`].join(', '),
    mobile: d.mobile,
    legals_accepted: true,
  })
  // The KYB answers. Without a GSTIN the GST question stays open: the Business verification page asks it with the
  // documents. A failed save must not lose the workspace; that page asks again.
  await saveKybProfile(result.tenantId, owner.id, {
    legalName: d.businessName,
    entityType: d.entityType,
    addressLine: d.addressLine,
    city: d.city,
    state: d.state,
    pincode: d.pincode,
    authorizedName: d.authorizedName,
    authorizedDesignation: d.authorizedDesignation,
    pan: d.pan,
    ...(d.gstNumber ? { gstRegistered: true, gstin: d.gstNumber } : {}),
  }).catch(e => console.error('[onboard] services KYB not saved', (e as Error)?.message || e))
  // KYC stays 'pending': Jeffi reviews API workspaces too. Until then they can explore but not send.
  await requestServiceApproval(result.tenantId, d.services)
  // New Messaging customers: Jeffi reviews their template changes before they are sent.
  if (d.services.includes('messaging'))
    await controlPlanePool().query(`INSERT INTO messaging_tenant_settings (tenant_id, review_required) VALUES ($1, true) ON CONFLICT DO NOTHING`, [result.tenantId])
  await markDraftSubmitted(owner.id).catch(() => {})
  sendServicesRequestedEmail({ email: owner.email, name: d.ownerName }, d.displayName, d.services).catch(() => {})
  return NextResponse.json({ ok: true, tenantId: result.tenantId, slug: result.slug })
}
