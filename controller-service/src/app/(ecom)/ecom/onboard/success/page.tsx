import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { getOwnerTenants, setSubscriptionStatus } from '@/lib/tenant-registry'
import { getSubscription } from '@controller/lib/payments/razorpay-subscriptions'
import { startStoreIfReady } from '@controller/lib/provisioning/start-store'
import { CheckMark } from '@controller/app/(ecom)/ecom/Shapes'
import PurchaseBeacon from './PurchaseBeacon'
import OnboardShell from '../OnboardShell'
import PageHeader from '../../dashboard/_components/PageHeader'
import { Card } from '../../dashboard/_components/Card'
import { statusSteps } from '../steps'
import { primaryBtn } from '../ui'

export const dynamic = 'force-dynamic'

// Razorpay redirects here after checkout.
// We verify the subscription status directly with Razorpay and activate the
// tenant immediately — this is the reliable path for local dev (no webhook) and
// also acts as a fallback when the webhook is delayed.
export default async function OnboardSuccessPage({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const h = await headers()
  const signals = {
    userAgent: h.get('user-agent'),
    acceptLanguage: h.get('accept-language'),
    uaPlatform: h.get('sec-ch-ua-platform'),
  }
  const owner = await resolveOwnerSession(sid, signals as any).catch(() => null)
  if (!owner) redirect('/signin')

  const { tenant: tenantSlug } = await searchParams

  // Find the tenant and verify subscription status with Razorpay.
  const tenants = await getOwnerTenants(owner.id)
  const tenant = tenantSlug ? tenants.find(t => t.slug === tenantSlug) : tenants[0]

  let paidNow = false
  if (tenant && tenant.razorpay_subscription_id && tenant.status !== 'active' && tenant.status !== 'provisioning') {
    const sub = await getSubscription(tenant.razorpay_subscription_id).catch(() => null)
    // Razorpay subscription statuses that mean payment was collected
    const paid = sub && ['active', 'authenticated', 'charged'].includes(sub.status)
    if (paid) {
      paidNow = true
      // Paid (the reliable path locally, and a fallback for a late webhook). The subscription covers
      // plan and servers, so this starts the store unless the webhook already did.
      await setSubscriptionStatus(tenant.id, 'active')
      if (!(await startStoreIfReady(tenant.id))) redirect('/onboard?paid=1')
    }
  }

  // Razorpay's return URL: every step, payment included, is done.
  const steps = statusSteps(true)
  return (
    <OnboardShell
      owner={{ email: owner.email, name: owner.name }}
      heading={tenant?.display_name ?? 'Your store'}
      subheading={tenantSlug ? `${tenantSlug}.jeffistores.in` : undefined}
      steps={steps}
      current={steps.length}
    >
      {paidNow && tenant && (
        <PurchaseBeacon
          subscriptionId={tenant.razorpay_subscription_id!}
          plan={{ slug: tenant.plan ?? 'basic', monthlyPrice: tenant.monthly_price_inr, interval: tenant.billing_interval }}
        />
      )}
      <div className="max-w-3xl">
      <PageHeader eyebrow="Payment" title="Payment confirmed!" />
      <Card>
        <div className="flex items-start gap-3">
          <span className="inline-flex shrink-0 items-center justify-center w-9 h-9 rounded-full org-sage org-sage-text">
            <CheckMark className="w-5 h-5" />
          </span>
          <p className="min-w-0 text-sm text-foreground-secondary break-words">
            {tenantSlug ? (
              <>
                Your store <span className="font-semibold text-foreground">{tenantSlug}.jeffistores.in</span> is being set up.
              </>
            ) : (
              <>Your store is being set up.</>
            )}{' '}
            You&apos;ll be notified when it&apos;s live.
          </p>
        </div>
        <Link href="/dashboard" className={`${primaryBtn} mt-5 w-full sm:w-auto`}>
          Go to dashboard →
        </Link>
      </Card>
      </div>
    </OnboardShell>
  )
}
