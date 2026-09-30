import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import {
  createTenant,
  linkOwnerTenant,
  hasVerifiedBank,
  saveSubscriptionId,
  listPlans,
  getOwnerTenants,
  saveKyc,
  markDraftSubmitted,
  getDraft,
  saveDraft,
  saveIntegrationCredential,
  updateOwnerName,
} from '@/lib/tenant-registry'
import { sendKycSubmittedEmail } from '@/lib/shared/ecom-emails'
import { OnboardSchema } from '@/lib/catalog/onboard-schema'
import { encryptToken } from '@/lib/crypto/token-cipher'
import { verifyDelhiveryToken } from '@/lib/shipping/delhivery'

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

  // A mistyped Delhivery token would otherwise only surface at the store's first shipment. Only a
  // positive refusal blocks the submit; if Delhivery cannot be reached the token is accepted, and
  // the owner can replace it from the dashboard.
  if (d.ownDelhivery && d.delhiveryToken && (await verifyDelhiveryToken(d.delhiveryToken.trim())) === 'invalid') {
    return NextResponse.json(
      { error: 'Delhivery did not accept this API token. Check it and try again.' },
      { status: 400 }
    )
  }

  // 1. Create tenant with status='pending_approval' (NOT provisioning yet).
  const result = await createTenant({
    slug: d.slug,
    displayName: d.displayName,
    planSlug: d.planSlug,
    billingInterval: d.billingInterval,
    dailyPayout: d.dailyPayout,
    ownDelhivery: d.ownDelhivery,
    ownRazorpay: d.ownRazorpay,
    warehouse: d.warehouse,
    status: 'pending_approval',
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  // 2. Link owner → tenant.
  await linkOwnerTenant(owner.id, result.tenantId)

  // 2a. Provisioning names the owner admin and addresses the access certificate from owners.name.
  await updateOwnerName(owner.id, d.ownerName)

  // 2b. Own-Razorpay tenant: persist their collection creds, encrypted. This is the ONLY place the
  //     raw key_secret/webhook_secret is handled — it arrives over TLS and is encrypted immediately;
  //     it never entered the cleartext onboarding draft. key_id is public.
  if (d.ownRazorpay && d.razorpayKeyId && d.razorpayKeySecret) {
    await saveIntegrationCredential({
      tenantId: result.tenantId,
      provider: 'razorpay',
      label: 'Razorpay',
      configEnc: encryptToken(
        JSON.stringify({
          key_id: d.razorpayKeyId,
          key_secret: d.razorpayKeySecret,
          webhook_secret: d.razorpayWebhookSecret || undefined,
        })
      ),
      meta: { key_id: d.razorpayKeyId },
    })
  }

  // 2c. Own-Delhivery tenant: persist their Delhivery token, encrypted. Same handling as the Razorpay
  //     secret — arrives over TLS, encrypted immediately, never entered the cleartext draft. This is
  //     what resolveDelhiveryToken / hasOwnDelhiveryToken read (cfg.token), so shipments sign with it.
  if (d.ownDelhivery && d.delhiveryToken) {
    await saveIntegrationCredential({
      tenantId: result.tenantId,
      provider: 'delhivery',
      label: 'Delhivery',
      configEnc: encryptToken(JSON.stringify({ token: d.delhiveryToken.trim() })),
      meta: {},
    })
  }

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
  sendKycSubmittedEmail({ email: owner.email, name: d.ownerName }).catch(() => {})

  return NextResponse.json({
    ok: true,
    tenantId: result.tenantId,
    slug: result.slug,
    status: 'pending_approval',
  })
}
