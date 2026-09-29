import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/owner-session'
import { getOwnerTenants, setSubscriptionStatus } from '@/lib/tenant-registry'
import { getSubscription } from '@/lib/razorpay-subscriptions'
import { triggerProvisioning, resolveRestoreKey } from '@/lib/provisioning/trigger'
import { CheckMark } from '@/app/ecom/Shapes'

export const dynamic = 'force-dynamic'

// Razorpay redirects here after checkout.
// We verify the subscription status directly with Razorpay and activate the
// tenant immediately — this is the reliable path for local dev (no webhook) and
// also acts as a fallback when the webhook is delayed.
export default async function OnboardSuccessPage({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const h = await headers()
  const signals = { userAgent: h.get('user-agent'), acceptLanguage: h.get('accept-language'), uaPlatform: h.get('sec-ch-ua-platform') }
  const owner = await resolveOwnerSession(sid, signals as any).catch(() => null)
  if (!owner) redirect('/signin')

  const { tenant: tenantSlug } = await searchParams

  // Find the tenant and verify subscription status with Razorpay.
  const tenants = await getOwnerTenants(owner.id)
  const tenant = tenantSlug ? tenants.find((t) => t.slug === tenantSlug) : tenants[0]

  if (tenant && tenant.razorpay_subscription_id && tenant.status !== 'active' && tenant.status !== 'provisioning') {
    const sub = await getSubscription(tenant.razorpay_subscription_id).catch(() => null)
    // Razorpay subscription statuses that mean payment was collected
    const paid = sub && ['active', 'authenticated', 'charged'].includes(sub.status)
    if (paid) {
      // Payment confirmed → flip to 'provisioning' and kick the engine (only place provisioning
      // starts). Do NOT set 'active' — only the engine's activate step does, after infra exists.
      // Reliable local path (no webhook) + webhook fallback; enqueueProvisioning is idempotent.
      await setSubscriptionStatus(tenant.id, 'active', 'provisioning')
      const restoreFromKey = await resolveRestoreKey(tenant.id, tenant.slug)
      await triggerProvisioning({
        action: 'provision',
        tenantId: tenant.id,
        slug: tenant.slug,
        plan: tenant.plan,
        ownerId: owner.id,
        restoreFromKey,
        reason: 'first_payment',
      }).catch(() => {})
    }
  }

  return (
    <div className="min-h-[calc(100vh-56px)] flex items-center justify-center bg-surface-secondary px-4">
      <div className="max-w-md w-full rounded-2xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-10 text-center">
        <span className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-green-600 text-white mx-auto mb-5">
          <CheckMark className="w-7 h-7" />
        </span>
        <h1 className="text-2xl font-bold text-green-800 dark:text-green-200">Payment confirmed!</h1>
        <p className="text-sm text-green-700 dark:text-green-400 mt-3">
          {tenantSlug ? (
            <>Your store <span className="font-semibold">{tenantSlug}.jeffistores.in</span> is being set up.</>
          ) : (
            <>Your store is being set up.</>
          )}
          {' '}You&apos;ll be notified when it&apos;s live.
        </p>
        <Link href="/dashboard" className="inline-block mt-7 w-full px-5 py-2.5 rounded-xl bg-accent-600 hover:bg-accent-700 text-white text-sm font-semibold transition-colors">
          Go to dashboard →
        </Link>
      </div>
    </div>
  )
}
