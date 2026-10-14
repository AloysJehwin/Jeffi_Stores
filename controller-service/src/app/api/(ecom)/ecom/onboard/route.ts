import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { cookies } from 'next/headers'
import {
  createTenant,
  linkOwnerTenant,
  hasVerifiedBank,
  saveSubscriptionId,
  listPlans,
  getOwnerTenants,
} from '@/lib/tenant-registry'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { createRazorpaySubscription } from '@/lib/payments/razorpay-subscriptions'

export const dynamic = 'force-dynamic'

const Schema = z.object({
  slug: z.string().min(3).max(63),
  displayName: z.string().min(1).max(200),
  planSlug: z.enum(['basic', 'growth', 'pro', 'enterprise']),
  billingInterval: z.enum(['monthly', 'yearly']).default('monthly'),
  dailyPayout: z.boolean().optional(),
  warehouse: z
    .object({
      originPincode: z.string().optional(),
      pickupLocation: z.string().optional(),
      sellerName: z.string().optional(),
      sellerAddress: z.string().optional(),
      sellerPhone: z.string().optional(),
    })
    .optional(),
})

// Owner-authed onboarding. Creates the tenant (status='provisioning'), creates a
// Razorpay Subscription, saves the subscription id, and returns the Razorpay
// hosted checkout URL. The wizard redirects the owner there; after payment Razorpay
// redirects to /onboard/success and fires a webhook that promotes status → 'active'.
export async function POST(request: NextRequest) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const raw = await request.json().catch(() => null)
  if (!raw) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  const parsed = Schema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid input' }, { status: 400 })
  }

  // One store per owner — enforce at API level (not just UI).
  const existing = await getOwnerTenants(owner.id)
  if (existing.length > 0) {
    return NextResponse.json({ error: 'You already have a store. Each account can have one store.' }, { status: 400 })
  }

  // Mandatory-before-go-live: no verified payout account → no store.
  if (!(await hasVerifiedBank(owner.id))) {
    return NextResponse.json({ error: 'Please verify your bank account before creating your store.' }, { status: 400 })
  }

  // 1. Create tenant row (status='provisioning').
  const result = await createTenant(parsed.data)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  // 2. Link owner → tenant.
  await linkOwnerTenant(owner.id, result.tenantId)

  // 3. Create Razorpay Subscription and get hosted checkout URL.
  const plans = await listPlans()
  const plan = plans.find(p => p.slug === parsed.data.planSlug)

  const baseUrl = process.env.NEXT_PUBLIC_ECOM_URL || 'https://ecom.jeffistores.in'
  const callbackUrl = `${baseUrl}/onboard/success?tenant=${result.slug}`

  const { subscriptionId, shortUrl } = await createRazorpaySubscription({
    planSlug: parsed.data.planSlug,
    planName: plan?.name ?? parsed.data.planSlug,
    interval: parsed.data.billingInterval,
    ownerEmail: owner.email,
    ownerName: owner.name,
    tenantId: result.tenantId,
    tenantSlug: result.slug,
    callbackUrl,
  })

  // 4. Persist the subscription id + interval so the webhook can find the tenant.
  await saveSubscriptionId(result.tenantId, subscriptionId, parsed.data.billingInterval)

  return NextResponse.json({
    success: true,
    tenantId: result.tenantId,
    slug: result.slug,
    subscriptionId,
    checkoutUrl: shortUrl,
    status: 'provisioning',
  })
}
