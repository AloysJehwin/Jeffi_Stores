import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { listPlans, getOwnerTenants, getDraft, hasService, reopenDraft, getKyc, getOwnerBankAccount, controlPlanePool } from '@/lib/tenant-registry'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import OnboardEntry from './OnboardEntry'
import OnboardWizard from './OnboardWizard'
import PaymentTrigger from './PaymentTrigger'
import OnboardShell from './OnboardShell'
import PageHeader from '../dashboard/_components/PageHeader'
import { Card, Row } from '../dashboard/_components/Card'
import { statusSteps, REVIEW_STEP, FINAL_STEP } from './steps'
import { Badge, primaryBtn, secondaryBtn } from './ui'
import { startStoreIfReady } from '@controller/lib/provisioning/start-store'
import { computeSpecEnabled } from '@controller/lib/compute/catalog'

export const dynamic = 'force-dynamic'

// Payments off (default): approval starts the build, so the last step is setup, not checkout.
const paymentsEnabled = () => process.env.ECOM_PAYMENTS_ENABLED === 'true'

/** A plan + interval carried from the pricing page, kept only when it names an active store plan. */
function pickedPlan(
  plans: { slug: string }[],
  q: { plan?: string; interval?: string }
): { planSlug: string; interval: 'monthly' | 'yearly' } | null {
  if (!q.plan || !plans.some(p => p.slug === q.plan)) return null
  return { planSlug: q.plan, interval: q.interval === 'yearly' ? 'yearly' : 'monthly' }
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

/** After submit: the console shell with the store's name in the rail and the steps so far. */
function StatusLayout({
  owner,
  tenant,
  currentStep,
  children,
}: {
  owner: { email: string; name: string | null }
  tenant: { slug: string; display_name: string }
  currentStep: number
  children: React.ReactNode
}) {
  return (
    <OnboardShell
      owner={owner}
      heading={tenant.display_name}
      subheading={`${tenant.slug}.jeffistores.in`}
      steps={statusSteps(paymentsEnabled())}
      current={currentStep}
    >
      <div className="max-w-3xl">{children}</div>
    </OnboardShell>
  )
}

export default async function OnboardPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; plan?: string; interval?: string }>
}) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const h = await headers()
  const signals = {
    userAgent: h.get('user-agent'),
    acceptLanguage: h.get('accept-language'),
    uaPlatform: h.get('sec-ch-ua-platform'),
  }
  const owner = await resolveOwnerSession(sid, signals as any).catch(() => null)
  if (!owner) redirect('/signup')
  const who = { email: owner.email, name: owner.name }

  const existing = await getOwnerTenants(owner.id)
  if (existing.length > 0) {
    const t = existing[0]
    if (!hasService(t, 'store') && !t.store_request) {
      if ((await searchParams).mode !== 'add-store') redirect('/dashboard')
      return <UpgradeWizard ownerId={owner.id} owner={who} tenant={t} />
    }
    if (t.status === 'active') redirect('/dashboard')

    // Subscription just went active (first charge landed via webhook before the engine kicked off).
    if (t.status === 'awaiting_payment' && t.subscription_status === 'active') {
      if (await startStoreIfReady(t.id)) redirect('/onboard')
    }

    // Approved + awaiting payment → show the payment link (owner completes the subscription here).
    if (t.status === 'awaiting_payment' && t.razorpay_subscription_id) {
      return (
        <StatusLayout owner={who} tenant={t} currentStep={FINAL_STEP}>
          <PaymentTrigger
            subscriptionId={t.razorpay_subscription_id}
            checkoutUrl={t.razorpay_checkout_url}
            slug={t.slug}
            displayName={t.display_name}
            ownerEmail={owner.email}
            ownerName={owner.name}
            planName={t.plan ?? 'Basic'}
            plan={{ slug: t.plan ?? 'basic', monthlyPrice: t.monthly_price_inr, interval: t.billing_interval }}
            razorpayKeyId={process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? ''}
          />
        </StatusLayout>
      )
    }

    // Approved but the Razorpay subscription/checkout link isn't ready yet.
    if (t.status === 'awaiting_payment') {
      return (
        <StatusLayout owner={who} tenant={t} currentStep={FINAL_STEP}>
          <PageHeader eyebrow="Store application" title="Approved" actions={<Badge tone="sage">Approved</Badge>} />
          <Card>
            <p className="text-sm text-foreground-secondary">
              {paymentsEnabled()
                ? 'Payment link is being generated — please refresh in a moment.'
                : 'Approved — your store setup is starting. Please refresh in a moment.'}
            </p>
            <a href="/onboard" className={`${secondaryBtn} mt-4 w-full sm:w-auto`}>
              Refresh
            </a>
          </Card>
        </StatusLayout>
      )
    }

    // Paid → the engine is actively building infra. Show a setting-up state (no payment link).
    if (t.status === 'provisioning') {
      return (
        <StatusLayout owner={who} tenant={t} currentStep={FINAL_STEP}>
          <PageHeader eyebrow="Store application" title="Setting up your store" actions={<Badge tone="peach">Setting up</Badge>} />
          <Card>
            <div className="flex items-start gap-3 text-sm text-foreground-secondary">
              <span className="mt-0.5 w-4 h-4 shrink-0 border-2 border-[var(--console-terracotta)] border-t-transparent rounded-full animate-spin" />
              <p className="min-w-0 break-words">
                {paymentsEnabled() ? 'Payment confirmed' : 'Approved'} — we&apos;re setting up{' '}
                <span className="font-semibold text-foreground">{t.slug}.jeffistores.in</span>. This takes a few minutes;
                you&apos;ll be emailed when it&apos;s live.
              </p>
            </div>
            <a href="/dashboard" className={`${primaryBtn} mt-5 w-full sm:w-auto`}>
              Go to dashboard →
            </a>
          </Card>
        </StatusLayout>
      )
    }

    if (t.status === 'rejected') {
      return (
        <StatusLayout owner={who} tenant={t} currentStep={REVIEW_STEP}>
          <PageHeader eyebrow="Store application" title="Application rejected" actions={<Badge tone="red">Rejected</Badge>} />
          <Card>
            <p className="text-sm text-foreground-secondary">
              Your GST certificate or business details could not be verified. Please contact support.
            </p>
            <a href="mailto:support@jeffistores.in" className={`${primaryBtn} mt-5 w-full sm:w-auto`}>
              Contact support
            </a>
          </Card>
        </StatusLayout>
      )
    }

    // pending_approval — under review
    const [allPlans, priceRow] = await Promise.all([
      listPlans('any'),
      controlPlanePool()
        .query<{ price: string | null }>(`SELECT price_inr_month AS price FROM tenant_compute WHERE tenant_id = $1`, [t.id])
        .catch(() => ({ rows: [] as { price: string | null }[] })),
    ])
    const planName = allPlans.find(p => p.slug === t.plan)?.name ?? t.plan
    const priceMonth = priceRow.rows[0]?.price == null ? null : Number(priceRow.rows[0].price)
    const yearly = t.billing_interval === 'yearly'
    return (
      <StatusLayout owner={who} tenant={t} currentStep={REVIEW_STEP}>
        <PageHeader
          eyebrow="Store application"
          title="Under review"
          description="This usually takes 1–2 business days. You’ll receive an email once approved."
          actions={<Badge tone="peach">Under review</Badge>}
        />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card title="Application">
            <div className="space-y-2.5">
              <Row label="Store" value={t.display_name} />
              <Row label="Subdomain" mono value={`${t.slug}.jeffistores.in`} />
              {planName && <Row label="Plan" value={planName} />}
              {planName && priceMonth != null && (
                <Row label="Price" value={`${yearly ? `${inr(priceMonth * 10)}/yr` : `${inr(priceMonth)}/mo`} incl. GST`} />
              )}
            </div>
          </Card>
          <Card title="What happens next">
            <p className="text-sm text-foreground-secondary break-words">
              We&apos;re verifying your GST certificate for <span className="font-semibold text-foreground">{t.display_name}</span>.{' '}
              {paymentsEnabled()
                ? "Once approved, you'll complete payment and your store goes live."
                : 'Once approved, we set up your store right away. Billing starts later.'}
            </p>
          </Card>
        </div>
      </StatusLayout>
    )
  }

  const [plans, draft, query] = await Promise.all([listPlans(), getDraft(owner.id), searchParams])

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

  // A plan picked on the pricing page starts the wizard on it, unless a draft is already in progress.
  const picked = !draft || submitted ? pickedPlan(plans, query) : null
  const initialDraft = draft
    ? { current_step: submitted ? 0 : draft.current_step, data: picked ? { ...carried, ...picked } : carried }
    : picked
      ? { current_step: 0, data: picked }
      : null

  return (
    <OnboardEntry
      owner={who}
      plans={plans}
      computeEnabled={computeSpecEnabled()}
      paymentsEnabled={paymentsEnabled()}
      initialDraft={initialDraft}
      reusingPreviousDetails={submitted}
      ownerName={owner.name}
    />
  )
}

// A services workspace applying for a store: the full wizard on its existing tenant, prefilled
// with the business and bank details already on file.
async function UpgradeWizard({
  ownerId,
  owner,
  tenant,
}: {
  ownerId: string
  owner: { email: string; name: string | null }
  tenant: { id: string; slug: string; display_name: string }
}) {
  const ownerName = owner.name
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
      owner={owner}
      plans={plans}
      computeEnabled={computeSpecEnabled()}
      paymentsEnabled={paymentsEnabled()}
      initialDraft={{ current_step: reopened ? 0 : (draft?.current_step ?? 0), data }}
      ownerName={ownerName}
      upgrade={{ tenantId: tenant.id, slug: tenant.slug, displayName: tenant.display_name }}
    />
  )
}
