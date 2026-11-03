import Link from 'next/link'
import type { TenantRow } from '@/lib/tenant-registry'
import { Card } from '../_components/Card'

/** Store application state for a services workspace: the explainer, or where the application stands. */
export default function AddStoreClient({
  tenant,
  paymentsEnabled = process.env.ECOM_PAYMENTS_ENABLED === 'true',
}: {
  tenant: Pick<TenantRow, 'slug' | 'store_request' | 'razorpay_checkout_url'>
  /** Off (default): approval starts the build, billing starts later. */
  paymentsEnabled?: boolean
}) {
  const r = tenant.store_request
  if (r === 'pending_approval') {
    return (
      <Card title="Store under review">
        <p className="text-sm text-foreground-secondary">
          We are reviewing your store application (usually same day).{' '}
          {paymentsEnabled
            ? 'We email you when it is approved and ready for payment.'
            : 'Once approved, we set up your store right away and email you when it is live.'}{' '}
          Messaging and documents keep working meanwhile.
        </p>
      </Card>
    )
  }
  if (r === 'awaiting_payment') {
    if (!paymentsEnabled) {
      return (
        <Card title="Approved — setting up your store">
          <p className="text-sm text-foreground-secondary">Your store is approved and its setup is starting. Billing starts later.</p>
        </Card>
      )
    }
    return (
      <Card title="Approved — complete payment">
        <p className="text-sm text-foreground-secondary">Your store is approved. Pay the first subscription charge and we start setting it up.</p>
        {tenant.razorpay_checkout_url
          ? <a href={tenant.razorpay_checkout_url} className="ecom-accent-bg inline-block mt-4 rounded-full px-5 py-2 text-sm font-semibold text-white">Complete payment →</a>
          : <p className="mt-3 text-sm text-foreground-muted">The payment link is being generated — refresh in a moment.</p>}
      </Card>
    )
  }
  if (r === 'provisioning') {
    return (
      <Card title="Setting up your store">
        <div className="flex items-center gap-2 text-sm text-foreground-secondary">
          <span className="w-4 h-4 border-2 border-[var(--console-terracotta)] border-t-transparent rounded-full animate-spin" />
          {paymentsEnabled ? 'Payment confirmed' : 'Approved'} — we are setting up {tenant.slug}.jeffistores.in. We email you when it is live.
        </div>
      </Card>
    )
  }
  return (
    <Card title="Set up your store">
      <ol className="list-decimal ml-5 text-sm text-foreground-secondary space-y-1">
        <li>Choose a plan, and give us your store, business, GST, warehouse, bank and branding details — what we already have is filled in.</li>
        <li>We review your application (usually same day).</li>
        <li>
          {paymentsEnabled
            ? 'Pay the first subscription charge; provisioning takes a few minutes.'
            : 'Once approved, we set up your store in a few minutes. Billing starts later.'}
        </li>
        <li>Your store goes live on <strong>this workspace</strong> — same wallet, same keys.</li>
      </ol>
      <Link href="/onboard?mode=add-store" className="ecom-accent-bg inline-block mt-5 rounded-full px-6 py-2.5 text-sm font-semibold text-white">Set up my store →</Link>
    </Card>
  )
}
