'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { CheckMark } from '@controller/app/(ecom)/ecom/Shapes'
import { FileText } from 'lucide-react'
import { ChoiceCards, ChoiceChips, Segmented } from '../_ui'
import { useToast } from '@/contexts/ToastContext'
import { PhoneInput } from '../_ui/phone'
import { trackStoreApplication } from '@controller/lib/client/ecom-analytics'
import { ComputeConfigurator, type ComputeChoice } from '../_compute/ComputeConfigurator'
import PageHeader from '../dashboard/_components/PageHeader'
import { Card, Row } from '../dashboard/_components/Card'
import OnboardShell from './OnboardShell'
import { WIZARD_STEPS } from './steps'
import { fieldInput, fieldLabel, ghostBtn, noteCls, primaryBtn } from './ui'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Plan {
  slug: string
  name: string
  tier: number
  monthly_price_inr: string
}
type Interval = 'monthly' | 'yearly'

const STEPS = WIZARD_STEPS

const HEAD: Record<StepIdx, { title: string; description: string }> = {
  0: { title: 'Choose your plan', description: 'All plans include the full storefront. One subscription — plan and servers together. Cancel anytime.' },
  1: { title: 'Name your store', description: 'This is what your customers will see.' },
  2: { title: 'Business details', description: 'Legal information for compliance and invoicing.' },
  3: { title: 'GST details', description: 'Only if your business is GST-registered. Leave blank if it is not.' },
  4: { title: 'Pickup warehouse', description: 'Where Delhivery will pick up your orders. You can edit this later.' },
  5: { title: 'Payout bank account', description: 'Where your sales will be settled. We verify instantly via a ₹1 bank check.' },
  6: { title: 'Branding & legals', description: 'Your logo and seal appear on your storefront and legal documents.' },
  7: { title: 'Review & submit', description: 'We’ll review your GST certificate and notify you when your store is approved.' },
}

type StepIdx = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

const PRODUCT_CATEGORIES = [
  'Electronics & Gadgets',
  'Fashion & Apparel',
  'Home & Kitchen',
  'Health & Beauty',
  'Books & Stationery',
  'Sports & Fitness',
  'Toys & Games',
  'Industrial & B2B',
  'Food & Groceries',
  'Other',
]

const BUSINESS_TYPES = [
  { value: 'proprietor', label: 'Sole Proprietorship' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'pvt_ltd', label: 'Private Limited' },
  { value: 'llp', label: 'LLP' },
  { value: 'other', label: 'Other' },
]

// ── Styles ────────────────────────────────────────────────────────────────────
const inp = fieldInput
const lbl = fieldLabel

// Same shape check as the bank endpoint (lib/payments/bank-verify.ts).
const UPI_ID_RE = /^[\w.\-]{2,}@[a-zA-Z]{2,}$/

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
}

// ── Main Wizard ────────────────────────────────────────────────────────────────
export default function OnboardWizard({
  owner,
  plans,
  initialDraft,
  reusingPreviousDetails,
  ownerName,
  extraServices = [],
  upgrade,
  computeEnabled = false,
  paymentsEnabled = false,
}: {
  /** Shown in the rail with the sign-out button. */
  owner: { email: string; name: string | null }
  plans: Plan[]
  /** ECOM_PAYMENTS_ENABLED: approval leads to checkout. Off: approval starts the build directly. */
  paymentsEnabled?: boolean
  /** Owners pick their server size here (COMPUTE_SPEC_ENABLED). */
  computeEnabled?: boolean
  /** A services workspace adding a store: the tenant (and its subdomain) already exists. */
  upgrade?: { tenantId: string; slug: string; displayName: string }
  /** Messaging / documents picked alongside the store on the service picker. */
  extraServices?: ('messaging' | 'documents')[]
  /** Name on the owner's sign-in account, used only to prefill the editable name field. */
  ownerName?: string | null
  initialDraft?: { current_step: number; data: Record<string, any> } | null
  /** Opening a second store: the owner's own details were carried over, the previous store's were not. */
  reusingPreviousDetails?: boolean
}) {
  const router = useRouter()
  const { showToast } = useToast()
  const init = initialDraft?.data ?? {}

  const [step, setStep] = useState<StepIdx>((initialDraft?.current_step as StepIdx) ?? 0)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)

  // Step 0 — Plan
  // A draft may name a plan that has since been retired (Starter): start from Basic instead.
  const [planSlug, setPlanSlug] = useState<string>(
    plans.some(p => p.slug === init.planSlug) ? init.planSlug : (plans.find(p => p.slug === 'basic') ?? plans[0])?.slug ?? 'basic'
  )
  const [interval, setInterval] = useState<Interval>(init.interval ?? 'monthly')
  const [compute, setCompute] = useState<ComputeChoice | null>(null)

  // Step 1 — Store
  const [displayName, setDisplayName] = useState(init.displayName ?? '')
  const [slug, setSlug] = useState(init.slug ?? '')
  const [slugEdited, setSlugEdited] = useState(!!init.slug)
  const [productCats, setProductCats] = useState<string[]>(init.productCats ?? [])

  // Step 2 — Business
  const [bizName, setBizName] = useState(init.bizName ?? '')
  const [bizType, setBizType] = useState(init.bizType ?? '')
  const [pan, setPan] = useState(init.pan ?? '')
  const [bizAddress, setBizAddress] = useState(init.bizAddress ?? '')

  // Step 3 — GST
  const [gstNumber, setGstNumber] = useState(init.gstNumber ?? '')
  const [gstS3Key, setGstS3Key] = useState(init.gstS3Key ?? '')
  const [gstFilename, setGstFilename] = useState(init.gstFilename ?? '')
  const [uploadingGst, setUploadingGst] = useState(false)
  const [gstErr, setGstErr] = useState<string | null>(null)

  // Step 4 — Warehouse
  const [dailyPayout, setDailyPayout] = useState(init.dailyPayout ?? false)
  const [ownDelhivery, setOwnDelhivery] = useState(init.ownDelhivery ?? false)
  // The Delhivery token is a secret like the Razorpay key secret: it lives only in local state and is
  // sent once to submit(), never round-tripped through the cleartext autosave `data` blob.
  const [delhiveryToken, setDelhiveryToken] = useState('')
  const [wh, setWh] = useState(
    init.wh ?? { originPincode: '', pickupLocation: '', sellerName: '', sellerAddress: '', sellerPhone: '' }
  )
  const [pinCheck, setPinCheck] = useState<{ state: 'idle' | 'checking' | 'ok' | 'warn' | 'bad'; msg: string }>({
    state: 'idle',
    msg: '',
  })

  // Step 5 — Bank
  const [bank, setBank] = useState({ accountNumber: '', ifsc: '', holderName: '', upiId: '', ...(init.bank ?? {}) })
  const upiIdOk = !bank.upiId || UPI_ID_RE.test(bank.upiId)
  const [ownRazorpay, setOwnRazorpay] = useState(init.ownRazorpay ?? false)
  // key_id is public and safe to round-trip the draft; the two secrets live only in local state and
  // are sent once to submit() — they must never enter the cleartext autosave `data` blob.
  const [rzpKeyId, setRzpKeyId] = useState(init.razorpayKeyId ?? '')
  const [rzpKeySecret, setRzpKeySecret] = useState('')
  const [rzpWebhookSecret, setRzpWebhookSecret] = useState('')
  const [bankVerified, setBankVerified] = useState(init.bankVerified ?? false)
  // True only when a penny-drop actually confirmed the holder name; false when the account was
  // merely accepted. Keeps the UI from claiming a verification that did not happen.
  const [bankNameConfirmed, setBankNameConfirmed] = useState(false)
  const [bankMsg, setBankMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [bankOnFile, setBankOnFile] = useState(!!upgrade && !!init.bankVerified)

  // Step 6 — Branding & Legals
  const [ownerFullName, setOwnerFullName] = useState<string>(init.ownerName ?? ownerName ?? '')
  const [mobile, setMobile] = useState(init.mobile ?? '')
  const [logoS3Key, setLogoS3Key] = useState(init.logoS3Key ?? '')
  const [logoUrl, setLogoUrl] = useState(init.logoUrl ?? '')
  const [sealS3Key, setSealS3Key] = useState(init.sealS3Key ?? '')
  const [sealUrl, setSealUrl] = useState(init.sealUrl ?? '')
  const [uploadingBrand, setUploadingBrand] = useState<'logo' | 'seal' | null>(null)
  const [brandErr, setBrandErr] = useState<string | null>(null)
  const [legalsAccepted, setLegalsAccepted] = useState(init.legalsAccepted ?? false)

  // Restore-on-re-onboard — detect a backup from a previously deprovisioned store.
  const [restoreBackup, setRestoreBackup] = useState<{ capturedAt: string } | null>(null)
  const [restoreOptIn, setRestoreOptIn] = useState<boolean>(init.restorePreviousData ?? false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/ecom/onboard/restore-available')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!cancelled && d?.available) setRestoreBackup({ capturedAt: d.capturedAt })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const effectiveSlug = upgrade ? upgrade.slug : slugEdited ? slug : slugify(displayName)
  const selectedPlan = plans.find(p => p.slug === planSlug)
  const monthly = Number(selectedPlan?.monthly_price_inr ?? 0)
  // The configurator only runs on the Plan step; a draft resumed past it keeps what was chosen there.
  const chosenSpec = compute?.spec ?? init.computeSpec ?? null
  const totalMonth: number | null = compute?.total?.total ?? (typeof init.priceInrMonth === 'number' ? init.priceInrMonth : null)
  const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
  // Yearly is charged once a year at 10× the month (2 months free).
  const priceLabel =
    totalMonth == null
      ? null
      : interval === 'yearly'
        ? `${inr(totalMonth * 10)}/yr incl. GST (${inr((totalMonth * 10) / 12)}/mo)`
        : `${inr(totalMonth)}/mo incl. GST`

  // ── Auto-save draft ──────────────────────────────────────────────────────────
  const autosave = useCallback(
    async (nextStep: StepIdx) => {
      setSaving(true)
      const data = {
        planSlug,
        interval,
        computeSpec: chosenSpec,
        priceInrMonth: totalMonth,
        displayName,
        slug: effectiveSlug,
        productCats,
        bizName,
        bizType,
        pan,
        bizAddress,
        gstNumber,
        gstS3Key,
        gstFilename,
        dailyPayout,
        ownDelhivery,
        wh,
        bank,
        ownRazorpay,
        razorpayKeyId: rzpKeyId,
        bankVerified,
        mobile,
        ownerName: ownerFullName,
        logoS3Key,
        logoUrl,
        sealS3Key,
        sealUrl,
        legalsAccepted,
        restorePreviousData: restoreBackup ? restoreOptIn : false,
      }
      await fetch('/api/ecom/onboard/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: nextStep, data }),
      }).catch(() => {})
      setSaving(false)
    },
    [
      planSlug,
      interval,
      chosenSpec,
      totalMonth,
      displayName,
      effectiveSlug,
      productCats,
      bizName,
      bizType,
      pan,
      bizAddress,
      gstNumber,
      gstS3Key,
      gstFilename,
      dailyPayout,
      ownDelhivery,
      wh,
      bank,
      ownRazorpay,
      rzpKeyId,
      bankVerified,
      mobile,
      ownerFullName,
      logoS3Key,
      logoUrl,
      sealS3Key,
      sealUrl,
      legalsAccepted,
      restoreBackup,
      restoreOptIn,
    ]
  )

  async function goTo(next: StepIdx) {
    await autosave(next)
    setStep(next)
  }

  // ── GST cert upload ──────────────────────────────────────────────────────────
  async function uploadGstCert(file: File) {
    setUploadingGst(true)
    setGstErr(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/ecom/onboard/kyc-upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) {
        setGstErr(data.error || 'Upload failed')
        return
      }
      setGstS3Key(data.s3Key)
      setGstFilename(file.name)
    } catch {
      setGstErr('Network error')
    } finally {
      setUploadingGst(false)
    }
  }

  // ── Logo / seal upload (owner-scoped branding assets, public) ────────────────
  async function uploadBrand(kind: 'logo' | 'seal', file: File) {
    setUploadingBrand(kind)
    setBrandErr(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('kind', kind)
      const res = await fetch('/api/ecom/onboard/brand-upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) {
        setBrandErr(data.error || 'Upload failed')
        return
      }
      if (kind === 'logo') {
        setLogoS3Key(data.s3Key)
        setLogoUrl(data.url)
      } else {
        setSealS3Key(data.s3Key)
        setSealUrl(data.url)
      }
    } catch {
      setBrandErr('Network error')
    } finally {
      setUploadingBrand(null)
    }
  }

  // ── Bank details ────────────────────────────────────────────────────────────
  // Confirmed instantly by penny-drop where available; otherwise accepted on format and checked
  // by Razorpay when payouts are configured.
  async function verifyBank() {
    setBusy(true)
    setBankMsg(null)
    try {
      const res = await fetch('/api/ecom/bank/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountNumber: bank.accountNumber, ifsc: bank.ifsc, holderName: bank.holderName, upiId: bank.upiId || undefined }),
      })
      const data = await res.json()
      if (res.ok && (data.status === 'verified' || data.status === 'unverified')) {
        setBankVerified(true)
        setBankNameConfirmed(data.status === 'verified')
        setBankMsg(
          data.status === 'verified'
            ? { ok: true, text: `Verified — ${data.verifiedName}` }
            : {
                ok: true,
                text: 'Account saved. Your bank details are confirmed with Razorpay when payouts are set up.',
              }
        )
      } else {
        setBankMsg({ ok: false, text: data.reason || data.error || 'Verification failed' })
      }
    } catch {
      setBankMsg({ ok: false, text: 'Network error' })
    } finally {
      setBusy(false)
    }
  }

  // ── Final submit ─────────────────────────────────────────────────────────────
  async function submit() {
    setBusy(true)
    try {
      const res = await fetch('/api/ecom/onboard/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planSlug,
          billingInterval: interval,
          ...(computeEnabled && chosenSpec ? { compute: chosenSpec } : {}),
          extraServices,
          displayName,
          slug: effectiveSlug,
          productCategories: productCats.join(', '),
          businessName: bizName,
          businessType: bizType,
          pan,
          businessAddress: bizAddress,
          gstNumber,
          gstCertS3Key: gstS3Key || undefined,
          dailyPayout,
          ownDelhivery,
          ownRazorpay,
          warehouse: wh,
          delhiveryToken: ownDelhivery ? delhiveryToken || undefined : undefined,
          razorpayKeyId: ownRazorpay ? rzpKeyId || undefined : undefined,
          razorpayKeySecret: ownRazorpay ? rzpKeySecret || undefined : undefined,
          razorpayWebhookSecret: ownRazorpay ? rzpWebhookSecret || undefined : undefined,
          ownerName: ownerFullName.trim(),
          mobile: mobile || undefined,
          logoS3Key: logoS3Key || undefined,
          sealS3Key: sealS3Key || undefined,
          legalsAccepted,
          restorePreviousData: restoreBackup ? restoreOptIn : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error || 'Submission failed', 'error')
        return
      }
      trackStoreApplication({ slug: planSlug, name: selectedPlan?.name, monthlyPrice: monthly, interval })
      // Application submitted → tenant is pending_approval (NOT paid/live). Stay in the onboard
      // flow, which shows the 'under review' → payment states. Only a live store goes to /dashboard.
      router.push(upgrade ? '/dashboard/add-store' : '/onboard')
      router.refresh()
    } catch {
      showToast('Network error', 'error')
    } finally {
      setBusy(false)
    }
  }

  // ── Can proceed? ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const pin = wh.originPincode.replace(/\D/g, '')
    if (pin.length !== 6) {
      setPinCheck({ state: 'idle', msg: '' })
      return
    }
    let cancelled = false
    setPinCheck({ state: 'checking', msg: 'Checking with Delhivery…' })
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/ecom/onboard/pincode?pin=${pin}`)
        const d = await res.json()
        if (cancelled) return
        if (d.error) setPinCheck({ state: 'warn', msg: d.error })
        else if (!d.serviceable) setPinCheck({ state: 'bad', msg: 'Delhivery does not serve this pincode.' })
        else if (!d.pickup)
          setPinCheck({
            state: 'bad',
            msg: 'Delhivery delivers here but cannot collect pickups — orders could not be shipped from this address.',
          })
        else
          setPinCheck({
            state: 'ok',
            msg: `Pickup available${d.district ? ` · ${d.district}` : ''}${d.cod ? ' · COD supported' : ' · prepaid only'}`,
          })
      } catch {
        // Never block onboarding on our own check being unreachable.
        if (!cancelled) setPinCheck({ state: 'warn', msg: 'Could not check this pincode right now.' })
      }
    }, 500)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [wh.originPincode])

  function canNext(): boolean {
    if (step === 0) return !!planSlug && !!compute?.valid
    if (step === 1) return displayName.trim().length > 0 && effectiveSlug.length >= 3 && productCats.length > 0
    if (step === 2)
      return bizName.trim().length > 0 && !!bizType && pan.trim().length === 10 && bizAddress.trim().length > 5
    // Optional: registration is not required below the turnover threshold, and Razorpay does
    // not need a GSTIN to create a linked account. Forcing it made the one tenant who had none
    // paste the platform's own GSTIN to get past this step.
    if (step === 3) return gstNumber.trim().length === 0 || gstNumber.trim().length === 15
    if (step === 4) {
      return (
        /^\d{6}$/.test(wh.originPincode.replace(/\D/g, '')) &&
        /^[6-9]\d{9}$/.test(wh.sellerPhone.replace(/\D/g, '').slice(-10)) &&
        wh.sellerAddress.trim().length > 5 &&
        pinCheck.state !== 'bad'
      )
    }
    if (step === 5) return bankVerified
    if (step === 6)
      return (
        ownerFullName.trim().length >= 2 &&
        /^[6-9]\d{9}$/.test(mobile.replace(/\D/g, '').slice(-10)) &&
        !!logoS3Key &&
        legalsAccepted
      )
    return true
  }

  const isLast = step === 7

  return (
    <OnboardShell
      owner={owner}
      heading={upgrade ? `Add a store to ${upgrade.displayName}` : 'Launch your store'}
      subheading={`Go live in ${STEPS.length} steps`}
      steps={STEPS}
      current={step}
      onSelect={i => goTo(i as StepIdx)}
      saving={saving}
    >
      <div className={step === 0 ? 'max-w-5xl' : 'max-w-2xl'}>
        <PageHeader eyebrow={`Step ${step + 1} of ${STEPS.length}`} title={HEAD[step].title} description={HEAD[step].description} />

          {/* ── Restore banner (returning owner with a prior backup) ── */}
          {restoreBackup && step <= 1 && (
            <div className={`${noteCls} org-peach mb-6`}>
              <div className="font-semibold text-foreground">We found a backup of your previous store</div>
              <p className="text-foreground-secondary mt-1">
                From {new Date(restoreBackup.capturedAt).toLocaleString('en-IN')}. We can restore your products,
                orders, and settings after your new store is set up.
              </p>
              <label className="mt-3 inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={restoreOptIn}
                  onChange={e => setRestoreOptIn(e.target.checked)}
                  className="w-4 h-4 rounded accent-accent-600"
                />
                <span className="font-medium text-foreground">Restore my previous store data</span>
              </label>
            </div>
          )}

          {/* ── Step 0: Plan ── */}
          {step === 0 && (
            <div>
              {reusingPreviousDetails && (
                <div className="mb-6 rounded-2xl border border-border-default bg-surface-elevated px-5 py-3">
                  <p className="text-sm text-foreground">
                    We have carried over your business details, warehouse and bank account.
                  </p>
                  <p className="text-xs text-foreground-muted mt-1">
                    You can change any of them as you go. Your new store gets its own name and address.
                  </p>
                </div>
              )}
              {/* Unboxed below sm: the configurator's own cards need the width. */}
              <Card title="Plan & servers" className="max-sm:border-0 max-sm:bg-transparent max-sm:p-0">
              <div className="space-y-6">
              <Segmented<Interval> ariaLabel="Billing interval" value={interval} onChange={setInterval}
                options={[{ value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly', count: '2 months free' }]} />
              <ComputeConfigurator
                planSlug={planSlug}
                onPlanChange={setPlanSlug}
                value={compute?.spec ?? init.computeSpec ?? null}
                onChange={setCompute}
              />
              {interval === 'yearly' && totalMonth != null && (
                <p className="text-sm text-foreground-secondary">
                  Billed yearly: <span className="font-semibold text-foreground">{inr(totalMonth * 10)}/yr</span> incl. GST —
                  10 months&apos; price for 12.
                </p>
              )}
              </div>
              </Card>
            </div>
          )}

          {/* ── Step 1: Store ── */}
          {step === 1 && (
            <Card>
              <div className="space-y-5">
                <div>
                  <label className={lbl}>Store name</label>
                  <input
                    className={inp}
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                  />
                </div>
                <div>
                  <label className={lbl}>Subdomain</label>
                  <div className="flex items-center gap-2">
                    <input
                      className={`${inp} min-w-0 ${upgrade ? 'opacity-70 cursor-not-allowed' : ''}`}
                      value={effectiveSlug}
                      readOnly={!!upgrade}
                      onChange={e => {
                        setSlugEdited(true)
                        setSlug(slugify(e.target.value))
                      }}
                    />
                    <span className="shrink-0 text-sm text-foreground-muted whitespace-nowrap font-mono">.jeffistores.in</span>
                  </div>
                  {upgrade && (
                    <p className="text-xs text-foreground-muted mt-1">Your workspace&apos;s subdomain — already reserved for your store.</p>
                  )}
                </div>
                <div>
                  <label className={lbl}>
                    What will you sell? <span className="text-foreground-muted font-normal">(pick all that apply)</span>
                  </label>
                  <ChoiceChips multiple size="md" ariaLabel="Product categories" className="mt-2" value={productCats} onChange={setProductCats}
                    options={PRODUCT_CATEGORIES.map(c => ({ value: c, label: c }))} />
                  {productCats.length === 0 && (
                    <p className="text-xs text-foreground-muted mt-2">Select at least one category.</p>
                  )}
                  {(productCats.includes('Food & Groceries') || productCats.includes('Health & Beauty')) && (
                    <p className="text-xs org-brown mt-2">
                      Selling food requires a valid FSSAI certificate, and medicine/pharma requires a drug licence —
                      you&apos;ll need to submit these with your documents. See the{' '}
                      <a
                        href="/legal/merchant-agreement#6-restricted-categories-licences-certificates-required"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        Merchant Agreement
                      </a>
                      .
                    </p>
                  )}
                </div>
              </div>
            </Card>
          )}

          {/* ── Step 2: Business ── */}
          {step === 2 && (
            <Card>
              <div className="space-y-5">
                <div>
                  <label className={lbl}>Legal business name</label>
                  <input
                    className={inp}
                    value={bizName}
                    onChange={e => setBizName(e.target.value)}
                  />
                </div>
                <div>
                  <label className={lbl}>Business type</label>
                  <ChoiceCards ariaLabel="Business type" columns="grid-cols-2 sm:grid-cols-3" cardClassName="px-3 py-2.5 text-sm" value={bizType || null} onChange={setBizType}
                    options={BUSINESS_TYPES.map(t => ({ value: t.value, label: <span className="font-medium">{t.label}</span> }))} />
                </div>
                <div>
                  <label className={lbl}>PAN number</label>
                  <input
                    className={inp}
                    value={pan}
                    onChange={e => setPan(e.target.value.toUpperCase())}
                    maxLength={10}
                  />
                </div>
                <div>
                  <label className={lbl}>Business address</label>
                  <textarea
                    className={`${inp} h-24 resize-none`}
                    value={bizAddress}
                    onChange={e => setBizAddress(e.target.value)}
                  />
                </div>
              </div>
            </Card>
          )}

          {/* ── Step 3: GST ── */}
          {step === 3 && (
            <Card>
              <div className="space-y-5">
                <div>
                  <label className={lbl}>
                    GSTIN <span className="text-foreground-muted font-normal">(optional)</span>
                  </label>
                  <input
                    className={inp}
                    value={gstNumber}
                    onChange={e => setGstNumber(e.target.value.toUpperCase())}
                    maxLength={15}
                  />
                  <p className="text-xs text-foreground-muted mt-1">
                    15-character GST Identification Number. Leave blank if you are not registered — never enter another
                    business&apos;s number.
                  </p>
                </div>
                <div>
                  <label className={lbl}>
                    GST registration certificate{' '}
                    <span className="text-foreground-muted font-normal">(optional — PDF, JPG or PNG, max 5 MB)</span>
                  </label>
                  {gstS3Key ? (
                    <div className="flex items-center gap-3 p-4 rounded-xl border border-[var(--org-sage-deep)]/40 org-sage">
                      <CheckMark className="w-5 h-5 org-sage-text flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium org-sage-text">Uploaded</div>
                        <div className="text-xs org-sage-text truncate">{gstFilename}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setGstS3Key('')
                          setGstFilename('')
                        }}
                        className="shrink-0 min-h-11 px-2 sm:min-h-0 sm:px-0 text-xs text-foreground-muted hover:text-foreground"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <label className="flex flex-col items-center justify-center w-full h-32 rounded-xl border-2 border-dashed border-border-default hover:border-accent-400 bg-surface cursor-pointer transition-colors">
                      <FileText className="w-8 h-8 text-foreground-muted mb-2" />
                      <span className="text-sm text-foreground-muted">
                        {uploadingGst ? 'Uploading…' : 'Click to upload certificate'}
                      </span>
                      <input
                        type="file"
                        className="hidden"
                        accept=".pdf,.jpg,.jpeg,.png,.webp"
                        disabled={uploadingGst}
                        onChange={e => {
                          const f = e.target.files?.[0]
                          if (f) uploadGstCert(f)
                        }}
                      />
                    </label>
                  )}
                  {gstErr && <p className="text-xs text-[#8a2e1f] mt-1">{gstErr}</p>}
                </div>
                <div className={`${noteCls} org-peach`}>
                  Your GST certificate will be reviewed by the Jeffi Commerce team before your store goes live. This
                  usually takes 1–2 business days.
                </div>
              </div>
            </Card>
          )}

          {/* ── Step 4: Warehouse ── */}
          {step === 4 && (
            <Card>
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={lbl}>Origin pincode</label>
                    <input
                      className={inp}
                      maxLength={6}
                      value={wh.originPincode}
                      onChange={e => setWh({ ...wh, originPincode: e.target.value.replace(/\D/g, '') })}
                    />
                    {pinCheck.state !== 'idle' && (
                      <p
                        className={`text-xs mt-1 ${
                          pinCheck.state === 'ok'
                            ? 'org-sage-text'
                            : pinCheck.state === 'bad'
                              ? 'text-[#8a2e1f]'
                              : 'text-foreground-muted'
                        }`}
                      >
                        {pinCheck.msg}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className={lbl}>Pickup location name</label>
                    <input
                      className={inp}
                      value={wh.pickupLocation}
                      onChange={e => setWh({ ...wh, pickupLocation: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className={lbl}>Seller / warehouse name</label>
                    <input
                      className={inp}
                      value={wh.sellerName}
                      onChange={e => setWh({ ...wh, sellerName: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className={lbl}>Seller phone</label>
                    <PhoneInput countries={['IN']} value={wh.sellerPhone} onChange={v => setWh({ ...wh, sellerPhone: v })} inputClassName={`${inp} min-w-0 flex-1`} />
                  </div>
                </div>
                <div>
                  <label className={lbl}>Warehouse address</label>
                  <textarea
                    className={`${inp} h-24 resize-none`}
                    value={wh.sellerAddress}
                    onChange={e => setWh({ ...wh, sellerAddress: e.target.value })}
                  />
                </div>
                <label className="flex items-center gap-3 cursor-pointer p-4 rounded-xl border border-border-default bg-surface hover:bg-surface-secondary transition-colors">
                  <input
                    type="checkbox"
                    checked={dailyPayout}
                    onChange={e => setDailyPayout(e.target.checked)}
                    className="w-4 h-4 rounded accent-accent-600"
                  />
                  <div>
                    <div className="text-sm font-medium text-foreground">Daily payouts</div>
                    <div className="text-xs text-foreground-muted">+5% fee — otherwise weekly, free</div>
                  </div>
                </label>
                <label className="flex items-center gap-3 cursor-pointer p-4 rounded-xl border border-border-default bg-surface hover:bg-surface-secondary transition-colors">
                  <input
                    type="checkbox"
                    checked={ownDelhivery}
                    onChange={e => setOwnDelhivery(e.target.checked)}
                    className="w-4 h-4 rounded accent-accent-600"
                  />
                  <div>
                    <div className="text-sm font-medium text-foreground">I have my own Delhivery account</div>
                    <div className="text-xs text-foreground-muted">
                      You&apos;ll connect your own Delhivery token and be billed by Delhivery directly — we won&apos;t
                      deduct courier cost from a wallet.
                    </div>
                  </div>
                </label>
                {ownDelhivery && (
                  <div className="space-y-2 rounded-xl border border-border-default bg-surface p-4">
                    <p className="text-xs text-foreground-muted">
                      Enter your Delhivery API token so shipments are created on your account. It is encrypted and never
                      shown again.
                    </p>
                    <div>
                      <label className={lbl}>Delhivery API token</label>
                      <input
                        className={inp}
                        type="password"
                        autoComplete="off"
                        value={delhiveryToken}
                        onChange={e => setDelhiveryToken(e.target.value.trim())}
                      />
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* ── Step 5: Bank ── */}
          {step === 5 && (
            <Card>
              <div className="space-y-4">
                {bankOnFile ? (
                  <div className="rounded-xl border border-[var(--org-sage-deep)]/40 org-sage p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold org-sage-text">
                      <CheckMark className="w-4 h-4" /> Verified account on file
                    </div>
                    <div className="mt-2 text-sm text-foreground space-y-0.5">
                      <div>{bank.holderName}</div>
                      <div className="font-mono text-xs">
                        •••• {String(bank.accountNumber).slice(-4)} · {bank.ifsc}
                      </div>
                      {bank.upiId && <div className="font-mono text-xs">UPI {bank.upiId}</div>}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setBankOnFile(false)
                        setBankVerified(false)
                        setBankNameConfirmed(false)
                        setBankMsg(null)
                        setBank({ accountNumber: '', ifsc: '', holderName: '', upiId: '' })
                      }}
                      className="mt-3 min-h-11 sm:min-h-0 text-xs font-semibold text-foreground-secondary hover:text-foreground underline"
                    >
                      Use a different account
                    </button>
                  </div>
                ) : (
                <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="col-span-full sm:col-span-2">
                    <label className={lbl}>Account holder name</label>
                    <input
                      className={inp}
                      value={bank.holderName}
                      disabled={bankVerified}
                      onChange={e => {
                        setBank({ ...bank, holderName: e.target.value })
                        setBankVerified(false)
                        setBankNameConfirmed(false)
                      }}
                    />
                  </div>
                  <div>
                    <label className={lbl}>Account number</label>
                    <input
                      className={inp}
                      value={bank.accountNumber}
                      disabled={bankVerified}
                      onChange={e => {
                        setBank({ ...bank, accountNumber: e.target.value })
                        setBankVerified(false)
                        setBankNameConfirmed(false)
                      }}
                    />
                  </div>
                  <div>
                    <label className={lbl}>IFSC code</label>
                    <input
                      className={inp}
                      value={bank.ifsc}
                      disabled={bankVerified}
                      onChange={e => {
                        setBank({ ...bank, ifsc: e.target.value.toUpperCase() })
                        setBankVerified(false)
                        setBankNameConfirmed(false)
                      }}
                    />
                  </div>
                  <div className="col-span-full sm:col-span-2">
                    <label className={lbl}>
                      UPI ID <span className="text-foreground-muted font-normal">(optional)</span>
                    </label>
                    <input
                      className={inp}
                      value={bank.upiId}
                      disabled={bankVerified}
                      placeholder="yourstore@okaxis"
                      autoCapitalize="none"
                      onChange={e => {
                        setBank({ ...bank, upiId: e.target.value.trim() })
                        setBankVerified(false)
                        setBankNameConfirmed(false)
                      }}
                    />
                    <p className={`mt-1 text-xs ${upiIdOk ? 'text-foreground-muted' : 'text-[#8a2e1f]'}`}>
                      {upiIdOk
                        ? 'Lets customers pay your store by UPI directly. A PhonePe Business account can be connected later from Integrations.'
                        : 'A UPI ID looks like name@bank.'}
                    </p>
                  </div>
                </div>

                {!bankVerified ? (
                  <button
                    type="button"
                    onClick={verifyBank}
                    disabled={busy || !bank.holderName || bank.accountNumber.length < 9 || bank.ifsc.length !== 11 || !upiIdOk}
                    className={`${primaryBtn} w-full sm:w-auto`}
                  >
                    {busy ? 'Saving…' : 'Save account'}
                  </button>
                ) : (
                  <div className="flex items-center gap-2 org-sage-text text-sm font-semibold">
                    <CheckMark className="w-4 h-4" /> {bankNameConfirmed ? 'Account verified' : 'Account saved'}
                    <button
                      type="button"
                      onClick={() => {
                        setBankVerified(false)
                        setBankNameConfirmed(false)
                        setBankMsg(null)
                      }}
                      className="ml-2 min-h-11 px-2 sm:min-h-0 sm:px-0 text-xs text-foreground-muted hover:text-foreground font-normal"
                    >
                      Change
                    </button>
                  </div>
                )}
                {bankMsg && (
                  <p
                    className={`text-sm ${bankMsg.ok ? 'org-sage-text' : 'text-[#8a2e1f]'}`}
                  >
                    {bankMsg.text}
                  </p>
                )}
                </>
                )}

                <label className="flex items-center gap-3 cursor-pointer p-4 rounded-xl border border-border-default bg-surface hover:bg-surface-secondary transition-colors">
                  <input
                    type="checkbox"
                    checked={ownRazorpay}
                    onChange={e => setOwnRazorpay(e.target.checked)}
                    className="w-4 h-4 rounded accent-accent-600"
                  />
                  <div>
                    <div className="text-sm font-medium text-foreground">I have my own Razorpay account</div>
                    <div className="text-xs text-foreground-muted">
                      Payments settle directly to your Razorpay account — we won&apos;t route a platform split. Your
                      bank account above is still used for records.
                    </div>
                  </div>
                </label>

                {ownRazorpay && (
                  <div className="space-y-4 rounded-xl border border-border-default bg-surface p-4">
                    <p className="text-xs text-foreground-muted">
                      Enter your Razorpay API keys so buyers pay into your account. Your secret is encrypted and never
                      shown again.
                    </p>
                    <div>
                      <label className={lbl}>Razorpay Key ID</label>
                      <input
                        className={inp}
                        value={rzpKeyId}
                        onChange={e => setRzpKeyId(e.target.value.trim())}
                      />
                    </div>
                    <div>
                      <label className={lbl}>Razorpay Key Secret</label>
                      <input
                        className={inp}
                        type="password"
                        autoComplete="off"
                        value={rzpKeySecret}
                        onChange={e => setRzpKeySecret(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className={lbl}>
                        Webhook Secret <span className="text-foreground-muted font-normal">(optional)</span>
                      </label>
                      <input
                        className={inp}
                        type="password"
                        autoComplete="off"
                        value={rzpWebhookSecret}
                        onChange={e => setRzpWebhookSecret(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* ── Step 6: Review ── */}
          {step === 6 && (
            <Card>

              <div className="mb-6">
                <label className={lbl}>Your full name</label>
                <input
                  className={inp}
                  autoComplete="name"
                  maxLength={200}
                  value={ownerFullName}
                  onChange={e => setOwnerFullName(e.target.value)}
                />
                <p className="text-xs text-foreground-muted mt-1">
                  Used on your admin access certificate and in emails from us. Your sign-in email stays the same.
                </p>
              </div>

              <div className="mb-6">
                <label className={lbl}>Mobile number</label>
                <PhoneInput countries={['IN']} value={mobile} onChange={setMobile} inputClassName={`${inp} min-w-0 flex-1`} />
                <p className="text-xs text-foreground-muted mt-1">Used for account + payout notifications.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                {(
                  [
                    ['logo', 'Store logo', logoS3Key, logoUrl],
                    ['seal', 'Store seal', sealS3Key, sealUrl],
                  ] as const
                ).map(([kind, label, key, url]) => (
                  <div key={kind}>
                    <label className={lbl}>
                      {label}
                      {kind === 'logo' ? ' *' : ' (optional)'}
                    </label>
                    <label className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-default bg-surface p-4 cursor-pointer hover:border-accent-500 transition-colors min-h-[112px]">
                      {url ? (
                        <img src={url} alt={label} className="max-h-16 object-contain" />
                      ) : (
                        <span className="text-xs text-foreground-muted text-center">
                          {uploadingBrand === kind ? 'Uploading…' : `Upload ${label.toLowerCase()}`}
                        </span>
                      )}
                      <input
                        type="file"
                        accept=".png,.jpg,.jpeg,.webp"
                        className="hidden"
                        onChange={e => {
                          const f = e.target.files?.[0]
                          if (f) uploadBrand(kind, f)
                        }}
                      />
                    </label>
                    {key && <p className="text-[10px] org-sage-text mt-1">✓ uploaded</p>}
                  </div>
                ))}
              </div>
              {brandErr && <p className="text-sm text-[#8a2e1f] mb-4">{brandErr}</p>}

              <label className="flex items-start gap-3 rounded-xl border border-border-default bg-surface p-4 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={legalsAccepted}
                  onChange={e => setLegalsAccepted(e.target.checked)}
                />
                <span className="text-sm text-foreground-secondary">
                  I agree to the{' '}
                  <a
                    href="/legal/merchant-agreement"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-600 hover:underline"
                  >
                    Merchant Agreement
                  </a>
                  ,{' '}
                  <a
                    href="/legal/terms-and-conditions"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-600 hover:underline"
                  >
                    Terms
                  </a>{' '}
                  and{' '}
                  <a
                    href="/legal/privacy-policy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-600 hover:underline"
                  >
                    Privacy Policy
                  </a>{' '}
                  — including the requirement to submit an FSSAI certificate for food and a drug licence for medicine —
                  and authorize generation of my store&apos;s legal pages from these details.
                </span>
              </label>
            </Card>
          )}

          {step === 7 && (
            <div className="space-y-4">
              <Card title="Your application">
              <div className="space-y-2.5">
                {[
                  [
                    'Subscription',
                    [selectedPlan?.name, interval, priceLabel].filter(Boolean).join(' · '),
                  ],
                  ['Store', `${displayName} (${effectiveSlug}.jeffistores.in)`],
                  ['Products', productCats.join(', ') || '—'],
                  ['Business', `${bizName} · ${bizType}`],
                  ['PAN', pan],
                  ['GSTIN', gstNumber],
                  ['GST cert', gstFilename || 'Not uploaded'],
                  ['Bank', bankVerified ? `${bank.holderName} · ${bank.accountNumber}` : 'Not added'],
                  ['UPI ID', bankVerified && bank.upiId ? bank.upiId : '—'],
                  ['Payouts', dailyPayout ? 'Daily (+5%)' : 'Weekly'],
                  ['Delhivery', ownDelhivery ? 'Own account' : 'Managed by Jeffi'],
                  ['Payments', ownRazorpay ? 'Own Razorpay' : 'Routed via Jeffi'],
                  ['Owner name', ownerFullName.trim() || '—'],
                  ['Mobile', mobile || '—'],
                  ['Logo', logoS3Key ? 'Uploaded' : 'Not uploaded'],
                  ['Seal', sealS3Key ? 'Uploaded' : 'Not uploaded'],
                  ['Legal terms', legalsAccepted ? 'Accepted' : 'Not accepted'],
                  ...(restoreBackup
                    ? [
                        [
                          'Restore data',
                          restoreOptIn
                            ? `Yes — from ${new Date(restoreBackup.capturedAt).toLocaleDateString('en-IN')}`
                            : 'No — start fresh',
                        ] as [string, string],
                      ]
                    : []),
                ].map(([k, v]) => (
                  <Row key={k} label={k} value={v} />
                ))}
              </div>
              </Card>

              {/* Subdomains preview */}
              <Card title={`Your subdomains${selectedPlan ? ` on ${selectedPlan.name}` : ''}`}>
                <div className="space-y-1.5 text-xs font-mono">
                  {[
                    { label: 'Storefront', url: `${effectiveSlug}.jeffistores.in`, ok: true },
                    { label: 'Admin', url: `admin-${effectiveSlug}.jeffistores.in`, ok: true },
                    { label: 'Invoices', url: `invoice-${effectiveSlug}.jeffistores.in`, ok: true },
                    {
                      label: 'Purchase orders',
                      url: `purchaseorder-${effectiveSlug}.jeffistores.in`,
                      ok: ['growth', 'pro', 'enterprise'].includes(planSlug),
                    },
                    {
                      label: 'Quotations',
                      url: `quotation-${effectiveSlug}.jeffistores.in`,
                      ok: ['growth', 'pro', 'enterprise'].includes(planSlug),
                    },
                    {
                      label: 'Forms',
                      url: `forms-${effectiveSlug}.jeffistores.in`,
                      ok: ['growth', 'pro', 'enterprise'].includes(planSlug),
                    },
                    {
                      label: 'B2B portal',
                      url: `${effectiveSlug}.business.jeffistores.in`,
                      ok: ['pro', 'enterprise'].includes(planSlug),
                    },
                  ].map(s => (
                    <div
                      key={s.label}
                      className={`flex items-center gap-2 ${s.ok ? 'text-foreground' : 'text-foreground-muted/50 line-through'}`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.ok ? 'ecom-accent-bg' : 'bg-foreground-muted/20'}`}
                      />
                      <span className="w-20 flex-shrink-0 not-italic text-[10px] text-foreground-muted">{s.label}</span>
                      <span className="min-w-0 break-all">{s.url}</span>
                    </div>
                  ))}
                </div>
              </Card>
              <div className={`${noteCls} org-peach`}>
                After submitting, our team will review your GST certificate (1–2 business days).{' '}
                {paymentsEnabled
                  ? "You'll receive an email when approved — then you'll complete payment and your store goes live."
                  : "Once we approve your details, we'll set up your store right away. Billing starts later."}
              </div>
            </div>
          )}

          {/* ── Navigation ── */}
          <div className="mt-6 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => goTo((step - 1) as StepIdx)}
              disabled={step === 0}
              className={ghostBtn}
            >
              ← Back
            </button>
            {isLast ? (
              <button onClick={submit} disabled={busy} className={`${primaryBtn} flex-1 sm:flex-none px-6`}>
                {busy ? 'Submitting…' : 'Submit for approval'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => canNext() && goTo((step + 1) as StepIdx)}
                disabled={!canNext()}
                className={`${primaryBtn} flex-1 sm:flex-none px-6`}
              >
                Continue →
              </button>
            )}
          </div>
      </div>
    </OnboardShell>
  )
}
