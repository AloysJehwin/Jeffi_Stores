import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { createTenant, getOwnerTenants, linkOwnerTenant, updateOwnerName, saveKyc, markDraftSubmitted, requestServiceApproval, controlPlanePool } from '@/lib/tenant-registry'
import { sendServicesRequestedEmail } from '@/lib/shared/ecom-emails'
import { parseBody } from '@/lib/shared/validate'

export const dynamic = 'force-dynamic'

const Schema = z.object({
  services: z.array(z.enum(['messaging', 'documents'])).min(1),
  slug: z.string().min(3).max(63),
  displayName: z.string().min(2).max(200),
  businessName: z.string().min(2).max(200),
  businessType: z.string().min(1).max(40),
  pan: z.string().length(10),
  businessAddress: z.string().min(5).max(1000),
  gstNumber: z.string().length(15).optional().or(z.literal('')),
  ownerName: z.string().min(1).max(120),
  mobile: z.string().regex(/^\+\d{8,15}$/, 'Enter the mobile with its country code'),
  legalsAccepted: z.literal(true),
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
    business_type: d.businessType,
    business_address: d.businessAddress,
    mobile: d.mobile,
    legals_accepted: true,
  })
  // KYC stays 'pending': Jeffi reviews API workspaces too. Until then they can explore but not send.
  await requestServiceApproval(result.tenantId, d.services)
  // New Messaging customers: Jeffi reviews their template changes before they are sent.
  if (d.services.includes('messaging'))
    await controlPlanePool().query(`INSERT INTO messaging_tenant_settings (tenant_id, review_required) VALUES ($1, true) ON CONFLICT DO NOTHING`, [result.tenantId])
  await markDraftSubmitted(owner.id).catch(() => {})
  sendServicesRequestedEmail({ email: owner.email, name: d.ownerName }, d.displayName, d.services).catch(() => {})
  return NextResponse.json({ ok: true, tenantId: result.tenantId, slug: result.slug })
}
