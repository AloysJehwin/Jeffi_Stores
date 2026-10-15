import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { listPlans, getOwnerTenants, getDraft, hasService, reopenDraft, getKyc, getOwnerBankAccount } from '@/lib/tenant-registry'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import OnboardEntry from './OnboardEntry'
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
                className={`flex items-center gap-3 px-3 py-3 rounded-xl ${active ? 'bg-accent-50' : ''}`}
              >
                <span
                  className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 text-xs font-bold ${active ? 'bg-accent-600 text-white' : done ? 'org-sage org-sage-text' : 'bg-surface-secondary text-foreground-muted'}`}
                >
                  {done ? '✓' : s.id + 1}
                </span>
                <div>
                  <div
                    className={`text-sm font-medium ${active ? 'text-accent-700' : done ? 'text-foreground-secondary' : 'text-foreground-muted'}`}
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

export default async function OnboardPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
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
    if (!hasService(t, 'store') && !t.store_request) {
      if ((await searchParams).mode !== 'add-store') redirect('/dashboard')
      return <UpgradeWizard ownerId={owner.id} ownerName={owner.name} tenant={t} />
    }
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
          <div className="max-w-lg w-full rounded-2xl border border-[var(--org-apricot)] org-peach p-8 text-center">
            <p className="text-sm org-brown font-medium">
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
          <div className="max-w-lg w-full rounded-2xl border border-border-default org-sand p-8 text-center">
            <div className="w-10 h-10 border-2 border-border-default border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <h1 className="text-lg font-bold org-brown">Setting up your store</h1>
            <p className="text-sm org-brown mt-2">
              Payment confirmed — we&apos;re provisioning <span className="font-semibold">{t.slug}.jeffistores.in</span>
              . This takes a few minutes; you&apos;ll be emailed when it&apos;s live.
            </p>
            <a
              href="/dashboard"
              className="inline-block mt-5 px-5 py-2.5 rounded-xl bg-accent-600 hover:bg-accent-700 text-white text-sm font-semibold transition-colors"
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
          <div className="max-w-lg w-full rounded-2xl border border-[#e0a89c] bg-[#f2d4cd] p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-[#f2d4cd] flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-6 h-6 text-[#8a2e1f]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-lg font-bold text-[#8a2e1f]">Application rejected</h1>
            <p className="text-sm text-[#8a2e1f] mt-2">
              Your GST certificate or business details could not be verified. Please contact support.
            </p>
            <a
              href="mailto:support@jeffistores.in"
              className="inline-block mt-5 px-5 py-2.5 rounded-xl org-sand hover:org-sand text-white text-sm font-semibold transition-colors"
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
        <div className="max-w-lg w-full rounded-2xl border border-[var(--org-apricot)] org-peach p-8 text-center">
          <div className="w-12 h-12 rounded-full org-peach flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-6 h-6 org-brown"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          </div>
          <h1 className="text-lg font-bold org-brown">Under review</h1>
          <p className="text-sm org-brown mt-2">
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
    <OnboardEntry
      plans={plans}
      initialDraft={draft ? { current_step: submitted ? 0 : draft.current_step, data: carried } : null}
      reusingPreviousDetails={submitted}
      ownerName={owner.name}
    />
  )
}

// A services workspace applying for a store: the full wizard on its existing tenant, prefilled
// with the business and bank details already on file.
async function UpgradeWizard({
  ownerId,
  ownerName,
  tenant,
}: {
  ownerId: string
  ownerName: string | null
  tenant: { id: string; slug: string; display_name: string }
}) {
  const draft = await getDraft(ownerId)
  const reopened = draft?.status === 'submitted'
  if (reopened) await reopenDraft(ownerId)
  const [allPlans, kyc, bank] = await Promise.all([
    listPlans(),
    getKyc(tenant.id),
    getOwnerBankAccount(ownerId).catch(() => null),
  ])
  const plans = allPlans.filter(p => p.slug !== 'services')
  const saved = draft?.data ?? {}
  const bankOk = bank?.verification_status === 'verified' || bank?.verification_status === 'unverified'
  const data: Record<string, any> = {
    ...saved,
    planSlug: plans.some(p => p.slug === saved.planSlug) ? saved.planSlug : plans[0]?.slug,
    displayName: saved.displayName || tenant.display_name,
    slug: tenant.slug,
    bizName: saved.bizName || kyc?.business_name || '',
    bizType: saved.bizType || kyc?.business_type || '',
    pan: saved.pan || kyc?.pan || '',
    bizAddress: saved.bizAddress || kyc?.business_address || '',
    gstNumber: saved.gstNumber || kyc?.gst_number || '',
    mobile: saved.mobile || kyc?.mobile || '',
    ownerName: saved.ownerName || ownerName || '',
    ...(bank && bankOk
      ? {
          bank: { accountNumber: bank.account_number ?? '', ifsc: bank.ifsc ?? '', holderName: bank.holder_name ?? '' },
          bankVerified: true,
        }
      : {}),
  }
  return (
    <OnboardWizard
      plans={plans}
      initialDraft={{ current_step: reopened ? 0 : (draft?.current_step ?? 0), data }}
      ownerName={ownerName}
      upgrade={{ tenantId: tenant.id, slug: tenant.slug, displayName: tenant.display_name }}
    />
  )
}
