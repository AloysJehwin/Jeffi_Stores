import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { approveKyc, getTenant, listPlans, getKyc, getOwnerById, getDraft, saveSubscriptionId, saveLinkedAccountId, getOwnerBankAccount } from '@/lib/tenant-registry'
import { createRazorpaySubscription } from '@/lib/razorpay-subscriptions'
import { createLinkedAccount, createRouteStakeholder, configureRouteSettlement, mapBusinessType, inferProfileCategory, normalizeIndianPhone } from '@/lib/razorpay-route'
import { sendKycApprovedEmail } from '@/lib/ecom-emails'
// TEMPORARY payment bypass - see src/lib/ecom-payment-bypass.ts
import { isPaymentBypassed, bypassAuditNote } from '@/lib/ecom-payment-bypass'
import { setSubscriptionStatus } from '@/lib/tenant-registry'
import { triggerProvisioning, resolveRestoreKey } from '@/lib/provisioning/trigger'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantId } = await params
  const tenant = await getTenant(tenantId)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  const kyc = await getKyc(tenantId)
  if (!kyc) return NextResponse.json({ error: 'KYC record not found' }, { status: 404 })

  const owner = await getOwnerById(kyc.owner_id)
  if (!owner) return NextResponse.json({ error: 'Owner not found' }, { status: 404 })

  // Approve KYC — sets tenant status to 'provisioning'
  await approveKyc(tenantId, admin.email ?? 'admin')

  // 1. Create Razorpay Route linked account for POBO transfers.
  // Only create if not already exists (idempotent — admin can retry).
  let linkedAccountId = tenant.razorpay_linked_account_id ?? null
  if (!linkedAccountId) {
    try {
      // The owner phone for the Route account comes from the onboarding warehouse config
      // (wh.sellerPhone) — the only phone collected during onboarding. Normalize it to the
      // 10-digit form Razorpay requires; skip linked-account creation (non-fatal) if there's
      // no valid phone rather than sending a bad value that Razorpay rejects.
      const draft = await getDraft(kyc.owner_id).catch(() => null)
      const ownerPhone = normalizeIndianPhone((draft?.data as any)?.wh?.sellerPhone)
      if (!ownerPhone) {
        throw new Error('no valid owner phone (wh.sellerPhone) for linked account')
      }
      const { category, subcategory } = inferProfileCategory(kyc.product_categories)
      const addressParts = (kyc.business_address ?? '').split(',').map(s => s.trim())
      linkedAccountId = await createLinkedAccount({
        businessName: kyc.business_name ?? tenant.display_name,
        businessType: mapBusinessType(kyc.business_type ?? 'other'),
        legalBusinessName: kyc.business_name ?? tenant.display_name,
        profileCategory: category,
        profileSubcategory: subcategory,
        ownerEmail: owner.email,
        ownerPhone,
        ownerName: owner.name ?? owner.email,
        pan: kyc.pan ?? '',
        gstNumber: kyc.gst_number ?? undefined,
        streetAddress: addressParts[0] ?? '',
        city: addressParts[addressParts.length - 3] ?? 'India',
        state: addressParts[addressParts.length - 2] ?? 'IN',
        postalCode: addressParts[addressParts.length - 1]?.replace(/\D/g, '') ?? '000000',
      })
      await saveLinkedAccountId(tenantId, linkedAccountId)

      // Attach a stakeholder + settlement bank so payouts can settle. Both are
      // non-fatal: needs LIVE Razorpay keys to fully succeed and must not block go-live.
      try {
        await createRouteStakeholder(linkedAccountId, {
          name: kyc.business_name ?? owner.name ?? owner.email,
          pan: kyc.pan ?? undefined,
        })
      } catch (sErr: any) {
        process.stderr.write(`[route] stakeholder creation failed for ${tenantId}: ${sErr?.error?.description ?? sErr?.message}\n`)
      }
      const bank = await getOwnerBankAccount(kyc.owner_id).catch(() => null)
      if (bank) {
        const settlement = await configureRouteSettlement(linkedAccountId, {
          accountNumber: bank.account_number,
          ifsc: bank.ifsc,
          beneficiaryName: bank.verified_name ?? bank.holder_name,
        })
        if (!settlement.ok) {
          process.stderr.write(`[route] settlement config failed for ${tenantId}: ${settlement.error}\n`)
        }
      } else {
        process.stderr.write(`[route] no bank account on file for owner ${kyc.owner_id} — settlement not configured\n`)
      }
    } catch (err: any) {
      // Non-fatal — log but continue. Transfers will fail until this is fixed,
      // but subscription + provisioning should proceed.
      // In production: alert ops team to manually create the linked account.
      process.stderr.write(`[route] linked account creation failed for ${tenantId}: ${err?.error?.description ?? err?.message}\n`)
    }
  }

  // ── TEMPORARY payment bypass ────────────────────────────────────────────────
  // Skips Razorpay entirely for an allow-listed owner and starts provisioning
  // straight away, mirroring what the subscription.charged webhook would do.
  // Remove this block together with src/lib/ecom-payment-bypass.ts.
  if (isPaymentBypassed(owner.email)) {
    process.stderr.write(`[ecom] ${bypassAuditNote(owner.email)} tenant=${tenantId}\n`)
    await setSubscriptionStatus(tenantId, 'active', 'provisioning')
    const restoreFromKey = await resolveRestoreKey(tenantId, tenant.slug)
    triggerProvisioning({
      action: 'provision',
      tenantId,
      slug: tenant.slug,
      plan: tenant.plan,
      ownerId: kyc.owner_id,
      restoreFromKey,
      reason: 'first_payment',
    }).catch(() => {})
    return NextResponse.json({
      ok: true,
      paymentBypassed: true,
      linkedAccountId,
      message: 'Payment bypassed (internal testing) - provisioning started.',
    })
  }
  // ── end TEMPORARY payment bypass ────────────────────────────────────────────

  // 2. Create Razorpay Subscription and return checkout URL.
  const plans = await listPlans()
  const plan = plans.find((p) => p.slug === tenant.plan) ?? plans[0]
  const baseUrl = process.env.NEXT_PUBLIC_ECOM_URL || 'https://ecom.jeffistores.in'

  try {
    const { subscriptionId, shortUrl } = await createRazorpaySubscription({
      planSlug: tenant.plan ?? 'basic',
      planName: plan?.name ?? 'Basic',
      interval: (tenant.billing_interval as any) ?? 'monthly',
      ownerEmail: owner.email,
      ownerName: owner.name,
      tenantId,
      tenantSlug: tenant.slug,
      callbackUrl: `${baseUrl}/onboard/success?tenant=${tenant.slug}`,
    })
    await saveSubscriptionId(tenantId, subscriptionId, tenant.billing_interval ?? 'monthly', shortUrl)
    sendKycApprovedEmail(
      { email: owner.email, name: owner.name },
      { display_name: tenant.display_name, slug: tenant.slug },
      shortUrl
    ).catch(() => {})
    return NextResponse.json({ ok: true, checkoutUrl: shortUrl, linkedAccountId })
  } catch (err: any) {
    return NextResponse.json({
      ok: false,
      kycApproved: true,
      linkedAccountId,
      error: `KYC approved but Razorpay subscription failed: ${err?.message ?? err}`,
    }, { status: 500 })
  }
}
