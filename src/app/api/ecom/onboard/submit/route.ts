import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/owner-session'
import { extractSessionSignals } from '@/lib/session-signals-request'
import { createTenant, linkOwnerTenant, hasVerifiedBank, saveSubscriptionId,
         listPlans, getOwnerTenants, saveKyc, markDraftSubmitted, getDraft, saveDraft } from '@/lib/tenant-registry'
import { sendKycSubmittedEmail } from '@/lib/ecom-emails'
import { OnboardSchema } from '@/lib/onboard-schema'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  // One store per owner
  const existing = await getOwnerTenants(owner.id)
  if (existing.length > 0) return NextResponse.json({ error: 'You already have a store.' }, { status: 400 })

  // Bank must be verified before submitting
  if (!(await hasVerifiedBank(owner.id))) {
    return NextResponse.json({ error: 'Please verify your bank account before submitting.' }, { status: 400 })
  }

  const raw = await request.json().catch(() => null)
  if (!raw) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  const parsed = OnboardSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })

  const d = parsed.data

  // Legal consent is required to generate the tenant's legal pages.
  if (!d.legalsAccepted) {
    return NextResponse.json({ error: 'Please accept the legal terms to continue.' }, { status: 400 })
  }

  // 1. Create tenant with status='pending_approval' (NOT provisioning yet).
  const result = await createTenant({
    slug: d.slug,
    displayName: d.displayName,
    planSlug: d.planSlug,
    billingInterval: d.billingInterval,
    dailyPayout: d.dailyPayout,
    warehouse: d.warehouse,
    status: 'pending_approval',
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  // 2. Link owner → tenant.
  await linkOwnerTenant(owner.id, result.tenantId)

  // 3. Save KYC details for admin review.
  await saveKyc(result.tenantId, owner.id, {
    gst_number: d.gstNumber,
    gst_cert_s3_key: d.gstCertS3Key ?? null,
    pan: d.pan,
    business_name: d.businessName,
    business_type: d.businessType,
    business_address: d.businessAddress,
    product_categories: d.productCategories ?? null,
    mobile: d.mobile ?? null,
    logo_s3_key: d.logoS3Key ?? null,
    seal_s3_key: d.sealS3Key ?? null,
    legals_accepted: !!d.legalsAccepted,
  })

  // 4. Persist restore intent (if any) into the draft, then mark submitted. The
  //    provision step reads this to decide whether to restore the owner's prior backup.
  if (d.restorePreviousData) {
    const existing = (await getDraft(owner.id))?.data ?? {}
    await saveDraft(owner.id, 6, { ...existing, restorePreviousData: true })
  }
  await markDraftSubmitted(owner.id)

  // 5. Notify owner + platform admin.
  sendKycSubmittedEmail({ email: owner.email, name: owner.name }).catch(() => {})

  return NextResponse.json({
    ok: true,
    tenantId: result.tenantId,
    slug: result.slug,
    status: 'pending_approval',
  })
}
