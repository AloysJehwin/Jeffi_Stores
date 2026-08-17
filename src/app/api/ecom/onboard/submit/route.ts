import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/owner-session'
import { extractSessionSignals } from '@/lib/session-signals-request'
import { createTenant, linkOwnerTenant, hasVerifiedBank, saveSubscriptionId,
         listPlans, getOwnerTenants, saveKyc, markDraftSubmitted, getDraft, saveDraft } from '@/lib/tenant-registry'
import { sendKycSubmittedEmail } from '@/lib/ecom-emails'

export const dynamic = 'force-dynamic'

const Schema = z.object({
  // Step 0 — Plan
  planSlug: z.enum(['basic', 'growth', 'pro', 'enterprise']),
  billingInterval: z.enum(['monthly', 'yearly']).default('monthly'),
  // Step 1 — Store
  displayName: z.string().min(1).max(200),
  slug: z.string().min(3).max(63),
  productCategories: z.string().optional(),
  // Step 2 — Business
  businessName: z.string().min(1).max(200),
  businessType: z.enum(['proprietor', 'partnership', 'pvt_ltd', 'llp', 'other']),
  pan: z.string().min(10).max(10),
  businessAddress: z.string().min(5),
  // Step 3 — GST
  gstNumber: z.string().min(15).max(15),
  gstCertS3Key: z.string().optional(),
  // Step 4 — Warehouse (optional)
  dailyPayout: z.boolean().optional(),
  warehouse: z.object({
    originPincode: z.string().optional(),
    pickupLocation: z.string().optional(),
    sellerName: z.string().optional(),
    sellerAddress: z.string().optional(),
    sellerPhone: z.string().optional(),
  }).optional(),
  // Restore-on-re-onboard — owner opted to restore a prior deprovisioned store's data.
  restorePreviousData: z.boolean().optional(),
})

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
  const parsed = Schema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })

  const d = parsed.data

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
