'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { CheckMark } from '../Shapes'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Plan { slug: string; name: string; tier: number; monthly_price_inr: string }
type Interval = 'monthly' | 'yearly'

const STEPS = [
  { id: 0, label: 'Plan',       icon: 'plan',     desc: 'Choose your subscription' },
  { id: 1, label: 'Store',      icon: 'store',    desc: 'Name & subdomain' },
  { id: 2, label: 'Business',   icon: 'business', desc: 'Legal details' },
  { id: 3, label: 'GST',        icon: 'gst',      desc: 'Certificate & number' },
  { id: 4, label: 'Warehouse',  icon: 'warehouse', desc: 'Pickup address' },
  { id: 5, label: 'Bank',       icon: 'bank',     desc: 'Payout account' },
  { id: 6, label: 'Branding',   icon: 'branding', desc: 'Logo, seal & consent' },
  { id: 7, label: 'Review',     icon: 'review',   desc: 'Submit for approval' },
] as const

type StepIdx = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

const PRODUCT_CATEGORIES = [
  'Electronics & Gadgets', 'Fashion & Apparel', 'Home & Kitchen',
  'Health & Beauty', 'Books & Stationery', 'Sports & Fitness',
  'Toys & Games', 'Industrial & B2B', 'Food & Groceries', 'Other',
]

const BUSINESS_TYPES = [
  { value: 'proprietor', label: 'Sole Proprietorship' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'pvt_ltd', label: 'Private Limited' },
  { value: 'llp', label: 'LLP' },
  { value: 'other', label: 'Other' },
]

// ── Styles ────────────────────────────────────────────────────────────────────
const inp = 'w-full rounded-xl border border-border-default bg-surface px-4 py-3 text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 transition-colors'
const lbl = 'block text-sm font-medium text-foreground-secondary mb-1.5'

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63)
}

// ── Step icon SVGs ─────────────────────────────────────────────────────────────
function StepIcon({ icon, className }: { icon: string; className?: string }) {
  const cls = className ?? 'w-5 h-5'
  const icons: Record<string, JSX.Element> = {
    plan:      <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z" /></svg>,
    store:     <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 0 1 .75-.75h3a.75.75 0 0 1 .75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349M3.75 21V9.349m0 0a3.001 3.001 0 0 0 3.75-.615A2.993 2.993 0 0 0 9.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 0 0 2.25 1.016c.896 0 1.7-.393 2.25-1.015a3.001 3.001 0 0 0 3.75.614m-16.5 0a3.004 3.004 0 0 1-.621-4.72l1.189-1.19A1.5 1.5 0 0 1 5.378 3h13.243a1.5 1.5 0 0 1 1.06.44l1.19 1.189a3 3 0 0 1-.621 4.72M6.75 18h3.75a.75.75 0 0 0 .75-.75V13.5a.75.75 0 0 0-.75-.75H6.75a.75.75 0 0 0-.75.75v3.75c0 .414.336.75.75.75Z" /></svg>,
    business:  <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" /></svg>,
    gst:       <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>,
    warehouse: <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 21v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21m0 0h4.5V3.545M12.75 21h7.5V10.75M2.25 21h1.5m18 0h-18M2.25 9l4.5-1.636M18.75 3l-1.5.545m0 6.205 3 1m1.5.5-1.5-.5M6.75 7.364V3h-3v18m3-13.636 10.5-3.819" /></svg>,
    bank:      <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0 0 12 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75Z" /></svg>,
    review:    <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>,
    branding:  <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M18 6h.008v.008H18V6ZM3.75 4.5h16.5a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H3.75a1.5 1.5 0 0 1-1.5-1.5V6a1.5 1.5 0 0 1 1.5-1.5Z" /></svg>,
  }
  return icons[icon] ?? null
}

// ── Main Wizard ────────────────────────────────────────────────────────────────
export default function OnboardWizard({ plans, initialDraft, reusingPreviousDetails }: {
  plans: Plan[]
  initialDraft?: { current_step: number; data: Record<string, any> } | null
  /** Opening a second store: the owner's own details were carried over, the previous store's were not. */
  reusingPreviousDetails?: boolean
}) {
  const router = useRouter()
  const init = initialDraft?.data ?? {}

  const [step, setStep] = useState<StepIdx>((initialDraft?.current_step as StepIdx) ?? 0)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Step 0 — Plan
  const [planSlug, setPlanSlug] = useState<string>(init.planSlug ?? plans[0]?.slug ?? 'basic')
  const [interval, setInterval] = useState<Interval>(init.interval ?? 'monthly')

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
  const [wh, setWh] = useState(init.wh ?? { originPincode: '', pickupLocation: '', sellerName: '', sellerAddress: '', sellerPhone: '' })
  const [pinCheck, setPinCheck] = useState<{ state: 'idle' | 'checking' | 'ok' | 'warn' | 'bad'; msg: string }>({ state: 'idle', msg: '' })

  // Step 5 — Bank
  const [bank, setBank] = useState(init.bank ?? { accountNumber: '', ifsc: '', holderName: '' })
  const [bankVerified, setBankVerified] = useState(init.bankVerified ?? false)
  // True only when a penny-drop actually confirmed the holder name; false when the account was
  // merely accepted. Keeps the UI from claiming a verification that did not happen.
  const [bankNameConfirmed, setBankNameConfirmed] = useState(false)
  const [bankMsg, setBankMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Step 6 — Branding & Legals
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
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d?.available) setRestoreBackup({ capturedAt: d.capturedAt }) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const effectiveSlug = slugEdited ? slug : slugify(displayName)
  const selectedPlan = plans.find((p) => p.slug === planSlug)
  const monthly = Number(selectedPlan?.monthly_price_inr ?? 0)
  const price = interval === 'yearly' ? monthly * 12 : monthly

  // ── Auto-save draft ──────────────────────────────────────────────────────────
  const autosave = useCallback(async (nextStep: StepIdx) => {
    setSaving(true)
    const data = { planSlug, interval, displayName, slug: effectiveSlug, productCats, bizName, bizType, pan, bizAddress, gstNumber, gstS3Key, gstFilename, dailyPayout, wh, bank, bankVerified, mobile, logoS3Key, logoUrl, sealS3Key, sealUrl, legalsAccepted, restorePreviousData: restoreBackup ? restoreOptIn : false }
    await fetch('/api/ecom/onboard/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: nextStep, data }),
    }).catch(() => {})
    setSaving(false)
  }, [planSlug, interval, displayName, effectiveSlug, productCats, bizName, bizType, pan, bizAddress, gstNumber, gstS3Key, gstFilename, dailyPayout, wh, bank, bankVerified, mobile, logoS3Key, logoUrl, sealS3Key, sealUrl, legalsAccepted, restoreBackup, restoreOptIn])

  async function goTo(next: StepIdx) {
    await autosave(next)
    setStep(next)
    setErr(null)
  }

  // ── GST cert upload ──────────────────────────────────────────────────────────
  async function uploadGstCert(file: File) {
    setUploadingGst(true); setGstErr(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/ecom/onboard/kyc-upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) { setGstErr(data.error || 'Upload failed'); return }
      setGstS3Key(data.s3Key)
      setGstFilename(file.name)
    } catch { setGstErr('Network error') } finally { setUploadingGst(false) }
  }

  // ── Logo / seal upload (owner-scoped branding assets, public) ────────────────
  async function uploadBrand(kind: 'logo' | 'seal', file: File) {
    setUploadingBrand(kind); setBrandErr(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('kind', kind)
      const res = await fetch('/api/ecom/onboard/brand-upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) { setBrandErr(data.error || 'Upload failed'); return }
      if (kind === 'logo') { setLogoS3Key(data.s3Key); setLogoUrl(data.url) }
      else { setSealS3Key(data.s3Key); setSealUrl(data.url) }
    } catch { setBrandErr('Network error') } finally { setUploadingBrand(null) }
  }

  // ── Bank details ────────────────────────────────────────────────────────────
  // Confirmed instantly by penny-drop where available; otherwise accepted on format and checked
  // by Razorpay when payouts are configured.
  async function verifyBank() {
    setBusy(true); setBankMsg(null)
    try {
      const res = await fetch('/api/ecom/bank/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountNumber: bank.accountNumber, ifsc: bank.ifsc, holderName: bank.holderName }),
      })
      const data = await res.json()
      if (res.ok && (data.status === 'verified' || data.status === 'unverified')) {
        setBankVerified(true)
        setBankNameConfirmed(data.status === 'verified')
        setBankMsg(data.status === 'verified'
          ? { ok: true, text: `Verified — ${data.verifiedName}` }
          : { ok: true, text: 'Account saved. Your bank details are confirmed with Razorpay when payouts are set up.' })
      } else {
        setBankMsg({ ok: false, text: data.reason || data.error || 'Verification failed' })
      }
    } catch { setBankMsg({ ok: false, text: 'Network error' }) } finally { setBusy(false) }
  }

  // ── Final submit ─────────────────────────────────────────────────────────────
  async function submit() {
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/ecom/onboard/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planSlug, billingInterval: interval,
          displayName, slug: effectiveSlug, productCategories: productCats.join(', '),
          businessName: bizName, businessType: bizType, pan, businessAddress: bizAddress,
          gstNumber, gstCertS3Key: gstS3Key || undefined,
          dailyPayout, warehouse: wh,
          mobile: mobile || undefined,
          logoS3Key: logoS3Key || undefined, sealS3Key: sealS3Key || undefined,
          legalsAccepted,
          restorePreviousData: restoreBackup ? restoreOptIn : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setErr(data.error || 'Submission failed'); return }
      // Application submitted → tenant is pending_approval (NOT paid/live). Stay in the onboard
      // flow, which shows the 'under review' → payment states. Only a live store goes to /dashboard.
      router.push('/onboard')
      router.refresh()
    } catch { setErr('Network error') } finally { setBusy(false) }
  }

  // ── Can proceed? ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const pin = wh.originPincode.replace(/\D/g, '')
    if (pin.length !== 6) { setPinCheck({ state: 'idle', msg: '' }); return }
    let cancelled = false
    setPinCheck({ state: 'checking', msg: 'Checking with Delhivery…' })
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/ecom/onboard/pincode?pin=${pin}`)
        const d = await res.json()
        if (cancelled) return
        if (d.error) setPinCheck({ state: 'warn', msg: d.error })
        else if (!d.serviceable) setPinCheck({ state: 'bad', msg: 'Delhivery does not serve this pincode.' })
        else if (!d.pickup) setPinCheck({ state: 'bad', msg: 'Delhivery delivers here but cannot collect pickups — orders could not be shipped from this address.' })
        else setPinCheck({ state: 'ok', msg: `Pickup available${d.district ? ` · ${d.district}` : ''}${d.cod ? ' · COD supported' : ' · prepaid only'}` })
      } catch {
        // Never block onboarding on our own check being unreachable.
        if (!cancelled) setPinCheck({ state: 'warn', msg: 'Could not check this pincode right now.' })
      }
    }, 500)
    return () => { cancelled = true; clearTimeout(t) }
  }, [wh.originPincode])

  function canNext(): boolean {
    if (step === 0) return !!planSlug
    if (step === 1) return displayName.trim().length > 0 && effectiveSlug.length >= 3 && productCats.length > 0
    if (step === 2) return bizName.trim().length > 0 && !!bizType && pan.trim().length === 10 && bizAddress.trim().length > 5
    // Optional: registration is not required below the turnover threshold, and Razorpay does
    // not need a GSTIN to create a linked account. Forcing it made the one tenant who had none
    // paste the platform's own GSTIN to get past this step.
    if (step === 3) return gstNumber.trim().length === 0 || gstNumber.trim().length === 15
    if (step === 4) {
      return /^\d{6}$/.test(wh.originPincode.replace(/\D/g, ''))
        && /^[6-9]\d{9}$/.test(wh.sellerPhone.replace(/\D/g, '').slice(-10))
        && wh.sellerAddress.trim().length > 5
        && pinCheck.state !== 'bad'
    }
    if (step === 5) return bankVerified
    if (step === 6) return /^[6-9]\d{9}$/.test(mobile.replace(/\D/g, '').slice(-10)) && !!logoS3Key && legalsAccepted
    return true
  }

  const isLast = step === 7

  return (
    <div className="flex min-h-[calc(100vh-56px)] bg-surface-secondary">
      {/* ── Sidebar ── */}
      <aside className="hidden lg:flex flex-col w-72 xl:w-80 bg-surface-elevated border-r border-border-default p-8 flex-shrink-0">
        <div className="mb-10">
          <h2 className="text-xl font-bold text-foreground">Launch your store</h2>
          <p className="text-sm text-foreground-muted mt-1">Complete each step to go live.</p>
        </div>
        <nav className="flex-1 space-y-1">
          {STEPS.map((s) => {
            const done = s.id < step
            const active = s.id === step
            return (
              <button key={s.id} type="button"
                onClick={() => s.id < step ? goTo(s.id as StepIdx) : undefined}
                disabled={s.id > step}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-colors ${active ? 'bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-300' : done ? 'text-foreground-secondary hover:bg-surface-secondary cursor-pointer' : 'text-foreground-muted cursor-default'}`}>
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${active ? 'bg-accent-600 text-white' : done ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400' : 'bg-surface-secondary text-foreground-muted'}`}>
                  {done ? <CheckMark className="w-4 h-4" /> : <StepIcon icon={s.icon} className="w-4 h-4" />}
                </span>
                <div>
                  <div className={`text-sm font-medium ${active ? 'text-accent-700 dark:text-accent-300' : ''}`}>{s.label}</div>
                  <div className="text-xs text-foreground-muted">{s.desc}</div>
                </div>
              </button>
            )
          })}
        </nav>
        {saving && <p className="text-xs text-foreground-muted mt-6">Saving draft…</p>}
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 flex flex-col">
        {/* Mobile step indicator */}
        <div className="lg:hidden flex items-center gap-2 px-6 py-4 border-b border-border-default bg-surface-elevated overflow-x-auto">
          {STEPS.map((s) => (
            <div key={s.id} className={`flex items-center gap-1 flex-shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${s.id === step ? 'bg-accent-600 text-white' : s.id < step ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-surface-secondary text-foreground-muted'}`}>
              {s.id < step ? <CheckMark className="w-3 h-3" /> : null}
              {s.label}
            </div>
          ))}
        </div>

        <div className="flex-1 flex flex-col items-center justify-center px-6 lg:px-16 py-10">
          {/* ── Restore banner (returning owner with a prior backup) ── */}
          {restoreBackup && step <= 1 && (
            <div className="w-full max-w-3xl mb-6 rounded-2xl border border-accent-300 dark:border-accent-700 bg-accent-50 dark:bg-accent-900/20 p-5">
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <div className="font-semibold text-foreground">We found a backup of your previous store</div>
                  <p className="text-sm text-foreground-muted mt-1">
                    From {new Date(restoreBackup.capturedAt).toLocaleString('en-IN')}. We can restore your products,
                    orders, and settings after your new store is set up.
                  </p>
                  <label className="mt-3 inline-flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={restoreOptIn} onChange={(e) => setRestoreOptIn(e.target.checked)}
                      className="w-4 h-4 rounded accent-accent-600" />
                    <span className="text-sm font-medium text-foreground">Restore my previous store data</span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 0: Plan ── */}
          {step === 0 && (
            <div className="w-full max-w-3xl">
              <h1 className="text-3xl font-bold text-foreground mb-1">Choose your plan</h1>
              <p className="text-foreground-muted mb-8">All plans include the full storefront. Cancel anytime.</p>
              {reusingPreviousDetails && (
                <div className="mb-8 rounded-xl border border-border-default bg-surface-elevated px-4 py-3">
                  <p className="text-sm text-foreground">
                    We have carried over your business details, warehouse and bank account.
                  </p>
                  <p className="text-xs text-foreground-muted mt-1">
                    You can change any of them as you go. Your new store gets its own name and address.
                  </p>
                </div>
              )}
              <div className="inline-flex items-center rounded-xl border border-border-default bg-surface p-1 mb-8 gap-1">
                {(['monthly', 'yearly'] as Interval[]).map((iv) => (
                  <button key={iv} type="button" onClick={() => setInterval(iv)}
                    className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors capitalize ${interval === iv ? 'bg-surface-elevated text-foreground shadow-sm' : 'text-foreground-muted hover:text-foreground'}`}>
                    {iv} {iv === 'yearly' && <span className="ml-1 text-[10px] text-green-600 dark:text-green-400 font-bold">20% off</span>}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                {plans.map((p) => {
                  const m = Number(p.monthly_price_inr)
                  const pr = interval === 'yearly' ? m * 12 : m
                  return (
                    <button key={p.slug} type="button" onClick={() => setPlanSlug(p.slug)}
                      className={`rounded-2xl border-2 p-5 text-left transition-all ${planSlug === p.slug ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20 shadow-md' : 'border-border-default bg-surface-elevated hover:border-accent-300'}`}>
                      <div className="font-bold text-foreground text-base">{p.name}</div>
                      <div className="text-2xl font-extrabold text-foreground mt-2">₹{pr.toLocaleString('en-IN')}</div>
                      <div className="text-xs text-foreground-muted">/{interval === 'yearly' ? 'yr' : 'mo'}</div>
                      {interval === 'yearly' && <div className="text-xs text-green-600 dark:text-green-400 mt-1">20% off at checkout</div>}
                      {planSlug === p.slug && <div className="mt-3 flex items-center gap-1 text-xs text-accent-600 dark:text-accent-400 font-semibold"><CheckMark className="w-3.5 h-3.5" />Selected</div>}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Step 1: Store ── */}
          {step === 1 && (
            <div className="w-full max-w-xl">
              <h1 className="text-3xl font-bold text-foreground mb-1">Name your store</h1>
              <p className="text-foreground-muted mb-8">This is what your customers will see.</p>
              <div className="space-y-5">
                <div>
                  <label className={lbl}>Store name</label>
                  <input className={inp} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Acme Hardware" />
                </div>
                <div>
                  <label className={lbl}>Subdomain</label>
                  <div className="flex items-center gap-2">
                    <input className={inp} value={effectiveSlug} onChange={(e) => { setSlugEdited(true); setSlug(slugify(e.target.value)) }} placeholder="acme" />
                    <span className="text-sm text-foreground-muted whitespace-nowrap font-mono">.jeffistores.in</span>
                  </div>
                </div>
                <div>
                  <label className={lbl}>What will you sell? <span className="text-foreground-muted font-normal">(pick all that apply)</span></label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {PRODUCT_CATEGORIES.map((c) => (
                      <button key={c} type="button" onClick={() => setProductCats((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c])}
                        className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${productCats.includes(c) ? 'bg-accent-600 text-white border-accent-600' : 'border-border-default text-foreground-secondary hover:border-accent-400'}`}>
                        {c}
                      </button>
                    ))}
                  </div>
                  {productCats.length === 0 && <p className="text-xs text-foreground-muted mt-2">Select at least one category.</p>}
                </div>
              </div>
            </div>
          )}

          {/* ── Step 2: Business ── */}
          {step === 2 && (
            <div className="w-full max-w-xl">
              <h1 className="text-3xl font-bold text-foreground mb-1">Business details</h1>
              <p className="text-foreground-muted mb-8">Legal information for compliance and invoicing.</p>
              <div className="space-y-5">
                <div>
                  <label className={lbl}>Legal business name</label>
                  <input className={inp} value={bizName} onChange={(e) => setBizName(e.target.value)} placeholder="Acme Hardware Pvt Ltd" />
                </div>
                <div>
                  <label className={lbl}>Business type</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {BUSINESS_TYPES.map((t) => (
                      <button key={t.value} type="button" onClick={() => setBizType(t.value)}
                        className={`px-3 py-2.5 rounded-xl border text-sm text-left transition-colors ${bizType === t.value ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-300 font-medium' : 'border-border-default text-foreground-secondary hover:border-accent-300'}`}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className={lbl}>PAN number</label>
                  <input className={inp} value={pan} onChange={(e) => setPan(e.target.value.toUpperCase())} placeholder="ABCDE1234F" maxLength={10} />
                </div>
                <div>
                  <label className={lbl}>Business address</label>
                  <textarea className={`${inp} h-24 resize-none`} value={bizAddress} onChange={(e) => setBizAddress(e.target.value)} placeholder="123, MG Road, Bengaluru, Karnataka 560001" />
                </div>
              </div>
            </div>
          )}

          {/* ── Step 3: GST ── */}
          {step === 3 && (
            <div className="w-full max-w-xl">
              <h1 className="text-3xl font-bold text-foreground mb-1">GST details</h1>
              <p className="text-foreground-muted mb-8">Only if your business is GST-registered. Leave blank if it is not.</p>
              <div className="space-y-5">
                <div>
                  <label className={lbl}>GSTIN <span className="text-foreground-muted font-normal">(optional)</span></label>
                  <input className={inp} value={gstNumber} onChange={(e) => setGstNumber(e.target.value.toUpperCase())} placeholder="29AAAAA0000A1Z5" maxLength={15} />
                  <p className="text-xs text-foreground-muted mt-1">15-character GST Identification Number. Leave blank if you are not registered — never enter another business&apos;s number.</p>
                </div>
                <div>
                  <label className={lbl}>GST registration certificate <span className="text-foreground-muted font-normal">(optional — PDF, JPG or PNG, max 5 MB)</span></label>
                  {gstS3Key ? (
                    <div className="flex items-center gap-3 p-4 rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20">
                      <CheckMark className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-green-700 dark:text-green-300">Uploaded</div>
                        <div className="text-xs text-green-600 dark:text-green-500 truncate">{gstFilename}</div>
                      </div>
                      <button type="button" onClick={() => { setGstS3Key(''); setGstFilename('') }} className="text-xs text-foreground-muted hover:text-foreground">Remove</button>
                    </div>
                  ) : (
                    <label className="flex flex-col items-center justify-center w-full h-32 rounded-xl border-2 border-dashed border-border-default hover:border-accent-400 bg-surface cursor-pointer transition-colors">
                      <StepIcon icon="gst" className="w-8 h-8 text-foreground-muted mb-2" />
                      <span className="text-sm text-foreground-muted">{uploadingGst ? 'Uploading…' : 'Click to upload certificate'}</span>
                      <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp" disabled={uploadingGst}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadGstCert(f) }} />
                    </label>
                  )}
                  {gstErr && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{gstErr}</p>}
                </div>
                <div className="rounded-xl bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 p-4 text-sm text-yellow-800 dark:text-yellow-300">
                  Your GST certificate will be reviewed by the Jeffi Commerce team before your store goes live. This usually takes 1–2 business days.
                </div>
              </div>
            </div>
          )}

          {/* ── Step 4: Warehouse ── */}
          {step === 4 && (
            <div className="w-full max-w-xl">
              <h1 className="text-3xl font-bold text-foreground mb-1">Pickup warehouse</h1>
              <p className="text-foreground-muted mb-8">Where Delhivery will pick up your orders. You can edit this later.</p>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={lbl}>Origin pincode</label>
                    <input className={inp} placeholder="560001" maxLength={6} value={wh.originPincode} onChange={(e) => setWh({ ...wh, originPincode: e.target.value.replace(/\D/g, '') })} />
                    {pinCheck.state !== 'idle' && (
                      <p className={`text-xs mt-1 ${
                        pinCheck.state === 'ok' ? 'text-green-700 dark:text-green-400'
                        : pinCheck.state === 'bad' ? 'text-red-600 dark:text-red-400'
                        : 'text-foreground-muted'}`}>
                        {pinCheck.msg}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className={lbl}>Pickup location name</label>
                    <input className={inp} placeholder="Main warehouse" value={wh.pickupLocation} onChange={(e) => setWh({ ...wh, pickupLocation: e.target.value })} />
                  </div>
                  <div>
                    <label className={lbl}>Seller / warehouse name</label>
                    <input className={inp} placeholder="Acme Hardware" value={wh.sellerName} onChange={(e) => setWh({ ...wh, sellerName: e.target.value })} />
                  </div>
                  <div>
                    <label className={lbl}>Seller phone</label>
                    <input className={inp} placeholder="+91 98765 43210" value={wh.sellerPhone} onChange={(e) => setWh({ ...wh, sellerPhone: e.target.value })} />
                  </div>
                </div>
                <div>
                  <label className={lbl}>Warehouse address</label>
                  <textarea className={`${inp} h-24 resize-none`} placeholder="123, Industrial Area, Bengaluru" value={wh.sellerAddress} onChange={(e) => setWh({ ...wh, sellerAddress: e.target.value })} />
                </div>
                <label className="flex items-center gap-3 cursor-pointer p-4 rounded-xl border border-border-default bg-surface-elevated hover:bg-surface-secondary transition-colors">
                  <input type="checkbox" checked={dailyPayout} onChange={(e) => setDailyPayout(e.target.checked)} className="w-4 h-4 rounded accent-accent-600" />
                  <div>
                    <div className="text-sm font-medium text-foreground">Daily payouts</div>
                    <div className="text-xs text-foreground-muted">+5% fee — otherwise weekly, free</div>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* ── Step 5: Bank ── */}
          {step === 5 && (
            <div className="w-full max-w-xl">
              <h1 className="text-3xl font-bold text-foreground mb-1">Payout bank account</h1>
              <p className="text-foreground-muted mb-8">Where your sales will be settled. We verify instantly via a ₹1 bank check.</p>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className={lbl}>Account holder name</label>
                    <input className={inp} placeholder="Aloys Jehwin" value={bank.holderName} disabled={bankVerified}
                      onChange={(e) => { setBank({ ...bank, holderName: e.target.value }); setBankVerified(false); setBankNameConfirmed(false) }} />
                  </div>
                  <div>
                    <label className={lbl}>Account number</label>
                    <input className={inp} placeholder="43014146741" value={bank.accountNumber} disabled={bankVerified}
                      onChange={(e) => { setBank({ ...bank, accountNumber: e.target.value }); setBankVerified(false); setBankNameConfirmed(false) }} />
                  </div>
                  <div>
                    <label className={lbl}>IFSC code</label>
                    <input className={inp} placeholder="SBIN0071256" value={bank.ifsc} disabled={bankVerified}
                      onChange={(e) => { setBank({ ...bank, ifsc: e.target.value.toUpperCase() }); setBankVerified(false); setBankNameConfirmed(false) }} />
                  </div>
                </div>

                {!bankVerified ? (
                  <button type="button" onClick={verifyBank}
                    disabled={busy || !bank.holderName || bank.accountNumber.length < 9 || bank.ifsc.length !== 11}
                    className="px-5 py-2.5 rounded-xl bg-accent-600 hover:bg-accent-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors">
                    {busy ? 'Saving…' : 'Save account'}
                  </button>
                ) : (
                  <div className="flex items-center gap-2 text-green-600 dark:text-green-400 text-sm font-semibold">
                    <CheckMark className="w-4 h-4" /> {bankNameConfirmed ? 'Account verified' : 'Account saved'}
                    <button type="button" onClick={() => { setBankVerified(false); setBankNameConfirmed(false); setBankMsg(null) }}
                      className="ml-2 text-xs text-foreground-muted hover:text-foreground font-normal">
                      Change
                    </button>
                  </div>
                )}
                {bankMsg && <p className={`text-sm ${bankMsg.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{bankMsg.text}</p>}
              </div>
            </div>
          )}

          {/* ── Step 6: Review ── */}
          {step === 6 && (
            <div className="w-full max-w-xl">
              <h1 className="text-3xl font-bold text-foreground mb-1">Branding & legals</h1>
              <p className="text-foreground-muted mb-8">Your logo and seal appear on your storefront and legal documents.</p>

              <div className="mb-6">
                <label className={lbl}>Mobile number</label>
                <input className={inp} inputMode="numeric" placeholder="10-digit mobile"
                  value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))} />
                <p className="text-xs text-foreground-muted mt-1">Used for account + payout notifications.</p>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-6">
                {([['logo', 'Store logo', logoS3Key, logoUrl], ['seal', 'Store seal', sealS3Key, sealUrl]] as const).map(([kind, label, key, url]) => (
                  <div key={kind}>
                    <label className={lbl}>{label}{kind === 'logo' ? ' *' : ' (optional)'}</label>
                    <label className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-default bg-surface p-4 cursor-pointer hover:border-accent-500 transition-colors min-h-[112px]">
                      {url
                        ? <img src={url} alt={label} className="max-h-16 object-contain" />
                        : <span className="text-xs text-foreground-muted text-center">{uploadingBrand === kind ? 'Uploading…' : `Upload ${label.toLowerCase()}`}</span>}
                      <input type="file" accept=".png,.jpg,.jpeg,.webp" className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadBrand(kind, f) }} />
                    </label>
                    {key && <p className="text-[10px] text-green-600 dark:text-green-400 mt-1">✓ uploaded</p>}
                  </div>
                ))}
              </div>
              {brandErr && <p className="text-sm text-red-600 dark:text-red-400 mb-4">{brandErr}</p>}

              <label className="flex items-start gap-3 rounded-xl border border-border-default bg-surface p-4 cursor-pointer">
                <input type="checkbox" className="mt-0.5" checked={legalsAccepted} onChange={(e) => setLegalsAccepted(e.target.checked)} />
                <span className="text-sm text-foreground-secondary">
                  I agree to the <a href="/legal/terms-and-conditions" target="_blank" rel="noopener noreferrer" className="text-accent-600 dark:text-accent-400 hover:underline">Terms</a> and <a href="/legal/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-accent-600 dark:text-accent-400 hover:underline">Privacy Policy</a>, and authorize generation of my store&apos;s legal pages from these details.
                </span>
              </label>
            </div>
          )}

          {step === 7 && (
            <div className="w-full max-w-xl">
              <h1 className="text-3xl font-bold text-foreground mb-1">Review & submit</h1>
              <p className="text-foreground-muted mb-8">We&apos;ll review your GST certificate and notify you when your store is approved.</p>
              <div className="rounded-2xl border border-border-default bg-surface-elevated divide-y divide-border-default/60 overflow-hidden mb-6">
                {[
                  ['Plan', `${selectedPlan?.name} · ${interval} · ₹${price.toLocaleString('en-IN')}/${interval === 'yearly' ? 'yr' : 'mo'}`],
                  ['Store', `${displayName} (${effectiveSlug}.jeffistores.in)`],
                  ['Products', productCats.join(', ') || '—'],
                  ['Business', `${bizName} · ${bizType}`],
                  ['PAN', pan],
                  ['GSTIN', gstNumber],
                  ['GST cert', gstFilename || 'Not uploaded'],
                  ['Bank', bankVerified ? `${bank.holderName} · ${bank.accountNumber}` : 'Not added'],
                  ['Payouts', dailyPayout ? 'Daily (+5%)' : 'Weekly'],
                  ['Mobile', mobile || '—'],
                  ['Logo', logoS3Key ? 'Uploaded' : 'Not uploaded'],
                  ['Seal', sealS3Key ? 'Uploaded' : 'Not uploaded'],
                  ['Legal terms', legalsAccepted ? 'Accepted' : 'Not accepted'],
                  ...(restoreBackup ? [['Restore data', restoreOptIn ? `Yes — from ${new Date(restoreBackup.capturedAt).toLocaleDateString('en-IN')}` : 'No — start fresh'] as [string, string]] : []),
                ].map(([k, v]) => (
                  <div key={k} className="flex items-start justify-between px-5 py-3 text-sm gap-4">
                    <span className="text-foreground-muted flex-shrink-0 w-24">{k}</span>
                    <span className="text-foreground font-medium text-right">{v}</span>
                  </div>
                ))}
              </div>

              {/* Subdomains preview */}
              <div className="rounded-xl border border-border-default bg-surface p-4 mb-6">
                <div className="text-xs text-foreground-muted uppercase tracking-widest mb-3">Your subdomains on {selectedPlan?.name}</div>
                <div className="space-y-1.5 text-xs font-mono">
                  {[
                    { label: 'Storefront', url: `${effectiveSlug}.jeffistores.in`, ok: true },
                    { label: 'Admin', url: `admin-${effectiveSlug}.jeffistores.in`, ok: true },
                    { label: 'Invoices', url: `invoice-${effectiveSlug}.jeffistores.in`, ok: true },
                    { label: 'Purchase orders', url: `purchaseorder-${effectiveSlug}.jeffistores.in`, ok: ['growth','pro','enterprise'].includes(planSlug) },
                    { label: 'Quotations', url: `quotation-${effectiveSlug}.jeffistores.in`, ok: ['growth','pro','enterprise'].includes(planSlug) },
                    { label: 'Forms', url: `forms-${effectiveSlug}.jeffistores.in`, ok: ['pro','enterprise'].includes(planSlug) },
                    { label: 'B2B portal', url: `${effectiveSlug}.business.jeffistores.in`, ok: ['pro','enterprise'].includes(planSlug) },
                  ].map((s) => (
                    <div key={s.label} className={`flex items-center gap-2 ${s.ok ? 'text-foreground' : 'text-foreground-muted/50 line-through'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.ok ? 'bg-green-500' : 'bg-foreground-muted/20'}`} />
                      <span className="w-20 flex-shrink-0 not-italic text-[10px] text-foreground-muted">{s.label}</span>
                      {s.url}
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-4 text-sm text-blue-800 dark:text-blue-300 mb-6">
                After submitting, our team will review your GST certificate (1–2 business days). You&apos;ll receive an email when approved — then you&apos;ll complete payment and your store goes live.
              </div>
              {err && <p className="text-sm text-red-600 dark:text-red-400 mb-4">{err}</p>}
              <button onClick={submit} disabled={busy}
                className="w-full py-3.5 rounded-xl bg-accent-600 hover:bg-accent-700 disabled:opacity-50 text-white font-semibold text-base transition-colors">
                {busy ? 'Submitting…' : 'Submit for approval'}
              </button>
            </div>
          )}

          {/* ── Navigation ── */}
          {!isLast && (
            <div className="flex items-center justify-between mt-10 pt-6 border-t border-border-default w-full max-w-xl">
              <button type="button" onClick={() => goTo((step - 1) as StepIdx)} disabled={step === 0}
                className="px-5 py-2.5 rounded-xl text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 text-sm font-medium transition-colors">
                ← Back
              </button>
              <button type="button" onClick={() => canNext() && goTo((step + 1) as StepIdx)} disabled={!canNext()}
                className="px-6 py-2.5 rounded-xl bg-accent-600 hover:bg-accent-700 disabled:opacity-40 text-white text-sm font-semibold transition-colors">
                Continue →
              </button>
            </div>
          )}
          {isLast && step > 0 && (
            <div className="mt-6 w-full max-w-xl">
              <button type="button" onClick={() => goTo(6 as StepIdx)}
                className="px-5 py-2.5 rounded-xl text-foreground-secondary hover:bg-surface-secondary text-sm font-medium transition-colors">
                ← Back
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
