import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { listPlans, getOwnerTenants, getDraft } from '@/lib/tenant-registry'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import OnboardWizard from './OnboardWizard'
import PaymentTrigger from './PaymentTrigger'

export const dynamic = 'force-dynamic'

const STEPS = [
  { id: 0, label: 'Plan', desc: 'Choose your subscription' },
  { id: 1, label: 'Store', desc: 'Name & subdomain' },
  { id: 2, label: 'Business', desc: 'Legal details' },
  { id: 3, label: 'GST', desc: 'Certificate & number' },
  { id: 4, label: 'Warehouse', desc: 'Pickup address' },
  { id: 5, label: 'Bank', desc: 'Payout account' },
  { id: 6, label: 'Review', desc: 'Submit for approval' },
  { id: 7, label: 'Payment', desc: 'Complete subscription' },
]

function SidebarLayout({ currentStep, children }: { currentStep: number; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[calc(100vh-56px)] bg-surface-secondary">
      <aside className="hidden lg:flex flex-col w-72 xl:w-80 bg-surface-elevated border-r border-border-default p-8 flex-shrink-0">
        <div className="mb-10">
          <h2 className="text-xl font-bold text-foreground">Launch your store</h2>
          <p className="text-sm text-foreground-muted mt-1">Complete each step to go live.</p>
        </div>
        <nav className="flex-1 space-y-1">
          {STEPS.map(s => {
            const done = s.id < currentStep
            const active = s.id === currentStep
            return (
              <div
                key={s.id}
                className={`flex items-center gap-3 px-3 py-3 rounded-xl ${active ? 'bg-accent-50 dark:bg-accent-900/20' : ''}`}
              >
                <span
                  className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold ${active ? 'bg-accent-600 text-white' : done ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400' : 'bg-surface-secondary text-foreground-muted'}`}
                >
                  {done ? '✓' : s.id + 1}
                </span>
                <div>
                  <div
                    className={`text-sm font-medium ${active ? 'text-accent-700 dark:text-accent-300' : done ? 'text-foreground-secondary' : 'text-foreground-muted'}`}
                  >
                    {s.label}
                  </div>
                  <div className="text-xs text-foreground-muted">{s.desc}</div>
                </div>
              </div>
            )
          })}
        </nav>
      </aside>
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-10">{children}</main>
    </div>
  )
}

export default async function OnboardPage() {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const h = await headers()
  const signals = {
    userAgent: h.get('user-agent'),
    acceptLanguage: h.get('accept-language'),
    uaPlatform: h.get('sec-ch-ua-platform'),
  }
  const owner = await resolveOwnerSession(sid, signals as any).catch(() => null)
  if (!owner) redirect('/signup')

  const existing = await getOwnerTenants(owner.id)
  if (existing.length > 0) {
    const t = existing[0]
    if (t.status === 'active') redirect('/dashboard')

    // Approved + awaiting payment → show the payment link (owner completes the subscription here).
    if (t.status === 'awaiting_payment' && t.razorpay_subscription_id) {
      return (
        <SidebarLayout currentStep={7}>
          <PaymentTrigger
            subscriptionId={t.razorpay_subscription_id}
            checkoutUrl={t.razorpay_checkout_url}
            slug={t.slug}
            displayName={t.display_name}
            ownerEmail={owner.email}
            ownerName={owner.name}
            planName={t.plan ?? 'Basic'}
            razorpayKeyId={process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? ''}
          />
        </SidebarLayout>
      )
    }

    // Approved but the Razorpay subscription/checkout link isn't ready yet.
    if (t.status === 'awaiting_payment') {
      return (
        <SidebarLayout currentStep={7}>
          <div className="max-w-lg w-full rounded-2xl border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 p-8 text-center">
            <p className="text-sm text-yellow-700 dark:text-yellow-400 font-medium">
              Payment link is being generated — please refresh in a moment.
            </p>
            <a
              href="/onboard"
              className="inline-block mt-4 px-5 py-2.5 rounded-xl border border-border-default text-sm text-foreground-secondary hover:bg-surface-secondary transition-colors"
            >
              Refresh
            </a>
          </div>
        </SidebarLayout>
      )
    }

    // Paid → the engine is actively building infra. Show a setting-up state (no payment link).
    if (t.status === 'provisioning') {
      return (
        <SidebarLayout currentStep={7}>
          <div className="max-w-lg w-full rounded-2xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-8 text-center">
            <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <h1 className="text-lg font-bold text-blue-800 dark:text-blue-200">Setting up your store</h1>
            <p className="text-sm text-blue-700 dark:text-blue-400 mt-2">
              Payment confirmed — we&apos;re provisioning <span className="font-semibold">{t.slug}.jeffistores.in</span>
              . This takes a few minutes; you&apos;ll be emailed when it&apos;s live.
            </p>
            <a
              href="/dashboard"
              className="inline-block mt-5 px-5 py-2.5 rounded-lg bg-accent-600 hover:bg-accent-700 text-white text-sm font-semibold transition-colors"
            >
              Go to dashboard →
            </a>
          </div>
        </SidebarLayout>
      )
    }

    if (t.status === 'rejected') {
      return (
        <SidebarLayout currentStep={6}>
          <div className="max-w-lg w-full rounded-2xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-6 h-6 text-red-600 dark:text-red-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-lg font-bold text-red-800 dark:text-red-200">Application rejected</h1>
            <p className="text-sm text-red-700 dark:text-red-400 mt-2">
              Your GST certificate or business details could not be verified. Please contact support.
            </p>
            <a
              href="mailto:support@jeffistores.in"
              className="inline-block mt-5 px-5 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors"
            >
              Contact support
            </a>
          </div>
        </SidebarLayout>
      )
    }

    // pending_approval — under review
    return (
      <SidebarLayout currentStep={6}>
        <div className="max-w-lg w-full rounded-2xl border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-yellow-100 dark:bg-yellow-900/40 flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-6 h-6 text-yellow-600 dark:text-yellow-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          </div>
          <h1 className="text-lg font-bold text-yellow-800 dark:text-yellow-200">Under review</h1>
          <p className="text-sm text-yellow-700 dark:text-yellow-400 mt-2">
            We&apos;re verifying your GST certificate for <span className="font-semibold">{t.display_name}</span> (
            {t.slug}.jeffistores.in). This usually takes 1–2 business days. You&apos;ll receive an email once approved.
          </p>
        </div>
      </SidebarLayout>
    )
  }

  const [plans, draft] = await Promise.all([listPlans(), getDraft(owner.id)])

  // A submitted draft belongs to a store that already exists. Replaying it whole put the
  // PREVIOUS store's name, slug and plan into the form for a second store, with nothing to
  // say they were stale. Only what belongs to the owner rather than the store carries over:
  // their legal entity, warehouse and bank. An in-progress draft is resumed as before.
  const submitted = draft?.status === 'submitted'
  const carried = submitted
    ? (({
        bizName,
        bizType,
        pan,
        bizAddress,
        gstNumber,
        gstS3Key,
        gstFilename,
        wh,
        bank,
        bankVerified,
        mobile,
        ownerName,
      }: any) => ({
        bizName,
        bizType,
        pan,
        bizAddress,
        gstNumber,
        gstS3Key,
        gstFilename,
        wh,
        bank,
        bankVerified,
        mobile,
        ownerName,
      }))(draft!.data ?? {})
    : (draft?.data ?? {})

  return (
    <OnboardWizard
      plans={plans}
      initialDraft={draft ? { current_step: submitted ? 0 : draft.current_step, data: carried } : null}
      reusingPreviousDetails={submitted}
      ownerName={owner.name}
    />
  )
}
