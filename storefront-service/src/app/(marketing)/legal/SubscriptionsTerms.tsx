import Link from 'next/link'

// The auto-debit terms on /legal; its loading screen shows the same copy.
export default function SubscriptionsTerms() {
  return (
    <section
      id="subscriptions"
      className="bg-surface-elevated rounded-xl border border-border-default p-6 scroll-mt-24"
    >
      <h2 className="font-bold text-foreground text-base mb-2">Subscriptions &amp; auto-debit</h2>
      <ul className="list-disc pl-5 space-y-1.5 text-sm text-foreground-secondary">
        <li>
          Subscriptions renew automatically each cycle through a Razorpay payment mandate (UPI Autopay, card or
          e-mandate) until you cancel, up to ₹15,000 per cycle.
        </li>
        <li>
          Pause, resume or cancel any time from My subscriptions. Cancellation takes effect at the end of the
          current cycle; you are not charged again.
        </li>
        <li>A charged cycle of a digital subscription is non-refundable once access is granted.</li>
        <li>Each delivered cycle of a physical subscription follows the Return &amp; Refund Policy.</li>
        <li>
          The mandate shows the payment collector&apos;s name: &quot;Jeffi&quot; where the store collects through
          the Jeffi Commerce platform, otherwise the store&apos;s own name.
        </li>
      </ul>
      <p className="text-xs text-foreground-muted mt-3">
        Full terms:{' '}
        <Link href="/legal/terms-and-conditions" className="text-primary-600 hover:underline">
          Terms &amp; Conditions
        </Link>{' '}
        ·{' '}
        <Link href="/legal/return-refund-policy" className="text-primary-600 hover:underline">
          Return &amp; Refund Policy
        </Link>
      </p>
    </section>
  )
}
