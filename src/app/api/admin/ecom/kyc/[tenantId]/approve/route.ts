import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import {
  approveKyc,
  getTenant,
  listPlans,
  getKyc,
  getOwnerById,
  getDraft,
  saveSubscriptionId,
  saveLinkedAccountId,
  getOwnerBankAccount,
  getOwnerBankWithRoute,
  persistLinkedAccountToOwnerBank,
} from '@/lib/tenant-registry'
import { createRazorpaySubscription } from '@/lib/payments/razorpay-subscriptions'
import {
  createLinkedAccount,
  createRouteStakeholder,
  configureRouteSettlement,
  mapBusinessType,
  inferProfileCategory,
  normalizeIndianPhone,
  isValidCompanyPan,
} from '@/lib/payments/razorpay-route'
import { sendKycApprovedEmail } from '@/lib/shared/ecom-emails'
// TEMPORARY payment bypass - see src/lib/ecom-payment-bypass.ts
import { stateFromPincode } from '@/lib/shipping/india-pincode-state'
import { isPaymentBypassed, bypassAuditNote } from '@/lib/payments/ecom-payment-bypass'
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
  // Only create if not already exists (idempotent — admin can retry). A returning owner whose
  // previous store was purged keeps their acc_xxx on the owner-scoped bank row (the tenant row
  // is gone) — reuse it rather than asking Razorpay for a second account on the same email,
  // which it refuses ("Merchant email already exists for account - acc_xxx").
  let linkedAccountId = tenant.razorpay_linked_account_id ?? null
  if (!linkedAccountId) {
    const survivor = await getOwnerBankWithRoute(kyc.owner_id).catch(() => null)
    if (survivor?.linkedAccountId) {
      linkedAccountId = survivor.linkedAccountId
      await saveLinkedAccountId(tenantId, linkedAccountId).catch(() => {})
      await persistLinkedAccountToOwnerBank(kyc.owner_id, linkedAccountId).catch(() => {})
    }
  }
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
      // Razorpay rejects a non-numeric postal code outright, which aborts linked-account
      // creation — and with it the stakeholder and the settlement bank, so no account number
      // ever reaches Route. The previous expression took the last comma-separated fragment and
      // stripped non-digits, then guarded with `??`, which does not catch the empty string that
      // produces. An address with no digits (or no commas) therefore sent postalCode: "".
      //
      // The onboarding draft already carries a real pincode the owner entered and we validated,
      // so prefer it; otherwise look for a 6-digit PIN anywhere in the address.
      const draftPin = String((draft?.data as any)?.wh?.originPincode ?? '').replace(/\D/g, '')
      const addressPin = (kyc.business_address ?? '').match(/\b(\d{6})\b/)?.[1]
      const postalCode = /^\d{6}$/.test(draftPin) ? draftPin : addressPin || ''
      if (!postalCode) {
        throw new Error(
          'no usable 6-digit postal code — checked the onboarding draft (wh.originPincode) and the KYC business address'
        )
      }

      // Razorpay validates the state name. It used to be taken positionally from the free-text
      // business address (`addressParts[length - 2]`), which yields 'IN' for an address with no
      // commas — rejected with "State name entered is incorrect". Derive it from the pincode,
      // the only structured location we hold, and fail with something actionable when the
      // prefix is one of the ambiguous ranges rather than guessing.
      const state = stateFromPincode(postalCode)
      if (!state) {
        throw new Error(
          `cannot determine the state from pincode ${postalCode} — its postal circle spans more than one state, so it must be set on the KYC record`
        )
      }
      const businessType = mapBusinessType(kyc.business_type ?? 'other')

      // Omitted rather than fatal, but the operator should know KYC is incomplete at Razorpay:
      // a PAN whose holder character disagrees with the business type is usually a data-entry
      // mistake (an individual PAN entered for a partnership, say), not a missing document.
      if (kyc.pan && !isValidCompanyPan(kyc.pan, businessType)) {
        process.stderr.write(
          `[route] company PAN not registered for ${tenantId}: PAN holder type '${kyc.pan.trim().toUpperCase()[3]}' ` +
            `does not match business type ${businessType} — add it from the Razorpay dashboard\n`
        )
      }

      linkedAccountId = await createLinkedAccount({
        businessName: kyc.business_name ?? tenant.display_name,
        businessType,
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
        state,
        postalCode,
      })
      await saveLinkedAccountId(tenantId, linkedAccountId)
      // Copy it onto the owner-scoped bank row immediately, not only at purge. Razorpay enforces
      // one linked account per merchant email, so if this tenant is later suspended/rolled back
      // (its tenants.razorpay_linked_account_id no longer readable as 'active') and re-provisioned,
      // the survivor row is the only place the acc_xxx persists — without it the retry hits
      // "Merchant email already exists for account - acc_xxx" and cannot recover.
      await persistLinkedAccountToOwnerBank(kyc.owner_id, linkedAccountId).catch(() => {})

      // Attach a stakeholder + settlement bank so payouts can settle. Both are
      // non-fatal: needs LIVE Razorpay keys to fully succeed and must not block go-live.
      try {
        await createRouteStakeholder(linkedAccountId, {
          name: kyc.business_name ?? owner.name ?? owner.email,
          email: owner.email,
          pan: kyc.pan ?? undefined,
        })
      } catch (sErr: any) {
        process.stderr.write(
          `[route] stakeholder creation failed for ${tenantId}: ${sErr?.error?.description ?? sErr?.message}\n`
        )
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
      // Non-fatal — subscription + provisioning proceed — but this is the step that makes a
      // store able to receive money, so it must not fail into a log line nobody reads. That is
      // how "The postal code must be an integer" sat unnoticed while the store went live with
      // no linked account, no stakeholder and no settlement bank in Route.
      const reason = err?.error?.description ?? err?.message ?? 'unknown error'
      process.stderr.write(`[route] linked account creation failed for ${tenantId}: ${reason}\n`)
      // Persist it: stderr does not survive the next deploy, and this failure was diagnosed
      // days later only by reconstructing the payload by hand.
      try {
        const { recordTenantStepEvent } = await import('@/lib/tenant-registry')
        await recordTenantStepEvent(tenantId, 'razorpay_linked_account', 'error', reason, {
          code: err?.error?.code ?? null,
          field: err?.error?.field ?? null,
          step: err?.error?.step ?? null,
          businessType: kyc.business_type ?? null,
        })
      } catch {
        /* never mask the original failure */
      }
      try {
        const { alertProvisioningFailure } = await import('@/lib/provisioning/alerts')
        await alertProvisioningFailure(tenant.slug, 'razorpay_linked_account', reason, tenantId)
      } catch {
        /* alerting must never mask the original failure */
      }
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
  const plan = plans.find(p => p.slug === tenant.plan) ?? plans[0]
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
    return NextResponse.json(
      {
        ok: false,
        kycApproved: true,
        linkedAccountId,
        error: `KYC approved but Razorpay subscription failed: ${err?.message ?? err}`,
      },
      { status: 500 }
    )
  }
}
