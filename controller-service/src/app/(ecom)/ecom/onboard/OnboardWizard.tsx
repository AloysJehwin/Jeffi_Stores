'use client'

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { CheckMark } from '@controller/app/(ecom)/ecom/Shapes'
import { ChoiceCards, Segmented } from '../_ui'
import { useToast } from '@/contexts/ToastContext'
import { PhoneInput } from '../_ui/phone'
import { trackStoreApplication } from '@controller/lib/client/ecom-analytics'
import { ComputeConfigurator, type ComputeChoice } from '../_compute/ComputeConfigurator'
import PageHeader from '../dashboard/_components/PageHeader'
import { Card, Row } from '../dashboard/_components/Card'
import OnboardShell from './OnboardShell'
import { WIZARD_STEPS, resumeStep, stepIndex, type WizardStepKey } from './steps'
import { fieldInput, fieldLabel, ghostBtn, noteCls, primaryBtn } from './ui'
import { ADDON_INFO, cleanAddonIds, type AddonId, type AddonPrice } from '@/lib/billing/addons'
import ContactFields from '../_domains/ContactFields'
import SiteStudio, { type SiteMode, type StudioSummary } from './_studio/SiteStudio'
import GiftCard, { FreeChip } from './_studio/GiftCard'
import StoreStep, { type DomainPick } from './StoreStep'
import { BusinessStep, GstStep } from './BusinessSteps'
import KybDocField from './KybDocField'
import { uploadKyc } from './CompliancePanel'
import { initialStoreDetails, storeDetailsPayload, storeDetailsProblem, type StoreDetails } from './store-details'
import {
  businessIssue,
  checkBlocked,
  checkCurrent,
  composeAddress,
  docLabel,
  gstIssue,
  initialKyb,
  kybPayload,
  patchDoc,
  prefillBusiness,
  type KybState,
  type KybUpload,
} from './kyb'
import { DOCS, complianceProblem, compliancePlan, planQuestions, requiredDocs, type ComplianceState } from '@controller/lib/catalog/compliance'
import { ENTITY_TYPES, kycBusinessType } from '@controller/lib/kyb/ids'
import { GST_EXEMPT_REASONS, KYB_DOCS } from '@controller/lib/kyb/requirements'
import { contactProblem, EMPTY_CONTACT, type DomainContact } from '../_domains/types'
import { defaultContact } from '@controller/lib/domains/contact'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Plan {
  slug: string
  name: string
  tier: number
  monthly_price_inr: string
}
type Interval = 'monthly' | 'yearly'

const STEPS = WIZARD_STEPS

/** A draft's site choice. Drafts from before it was saved: skipped → self, an AI site or brief → ai, else the theme. */
function initSiteMode(s: { mode?: string; skip?: boolean; description?: string; studio?: unknown }): SiteMode {
  if (s.mode === 'ai' || s.mode === 'theme' || s.mode === 'self') return s.mode
  if (s.skip) return 'self'
  return s.studio || (s.description ?? '').trim().length >= 10 ? 'ai' : 'theme'
}

const HEAD: Record<WizardStepKey, { title: string; description: string }> = {
  plan: { title: 'Choose your plan', description: 'All plans include the full storefront. One subscription — plan and servers together. Cancel anytime.' },
  store: { title: 'Your store', description: 'What your customers see on your site, what you sell, and the licences it needs.' },
  site: { title: 'Your site', description: 'Start with a ready-made theme, or have the AI design every page, on desktop and phone. It goes live with your store.' },
  business: { title: 'Business details', description: 'The business behind your store, as on its PAN and registration. We verify these details, and they go on your invoices.' },
  gst: { title: 'GST', description: 'Your GST registration, or why the business isn’t registered and a document that shows it exists.' },
  warehouse: { title: 'Pickup warehouse', description: 'Where Delhivery will pick up your orders. You can edit this later.' },
  bank: { title: 'Payout bank account', description: 'Where your sales will be settled. We verify instantly via a ₹1 bank check.' },
  branding: { title: 'Branding & legals', description: 'Your seal goes on invoices and legal documents; your name and mobile are for your account.' },
  review: { title: 'Review & submit', description: 'We’ll review your licences and certificates and notify you when your store is approved.' },
}

const S = Object.fromEntries(WIZARD_STEPS.map(s => [s.key, s.id])) as Record<WizardStepKey, number>
const REVIEW = stepIndex('review')

const HTTPS_URL = /^https:\/\/[^\s/$.?#][^\s]*$/i

// ── Styles ────────────────────────────────────────────────────────────────────
const inp = fieldInput
const lbl = fieldLabel

// Same shape check as the bank endpoint (lib/payments/bank-verify.ts).
const UPI_ID_RE = /^[\w.\-]{2,}@[a-zA-Z]{2,}$/
const IN_MOBILE = /^\+91[6-9]\d{9}$/

// The Review step shows these partly hidden: AB•••••34F, ••••6741, 94••••99@ybl.
const maskPan = (p: string) => (p.length > 5 ? `${p.slice(0, 2)}${'•'.repeat(p.length - 5)}${p.slice(-3)}` : '•'.repeat(p.length))
const maskAccount = (a: string) => `••••${String(a).slice(-4)}`
function maskUpi(id: string) {
  const at = id.lastIndexOf('@')
  const name = at > 0 ? id.slice(0, at) : id
  return `${name.length > 4 ? `${name.slice(0, 2)}••••${name.slice(-2)}` : `${name.slice(0, 1)}•••`}${at > 0 ? id.slice(at) : ''}`
}

/** What a deprovision kept for this owner (GET /api/ecom/onboard/restore-available). */
interface RestoreArchive {
  id: string
  slug: string
  displayName: string | null
  expiresAt: string
  database: boolean
  media: boolean
  config: boolean
}
const RESTORE_ITEMS: { key: 'database' | 'media' | 'config'; label: string; what: string }[] = [
  { key: 'database', label: 'Store data', what: 'Products, customers, orders and settings, as they were.' },
  { key: 'media', label: 'Images and files', what: 'Product images, uploads and documents.' },
  { key: 'config', label: 'Store settings only', what: 'Your settings on a fresh, empty store. Not needed when you restore the store data.' },
]

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    // 'Café' → 'cafe': NFKD splits off the accent, which is then dropped.
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
}

// ── Main Wizard ────────────────────────────────────────────────────────────────
export default function OnboardWizard({
  owner,
  plans,
  addons = [],
  initialDraft,
  reusingPreviousDetails,
  ownerName,
  extraServices = [],
  upgrade,
  computeEnabled = false,
}: {
  /** Shown in the rail with the sign-out button. */
  owner: { email: string; name: string | null }
  plans: Plan[]
  /** Add-ons offered on the Plan step, with their live monthly prices. */
  addons?: AddonPrice[]
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

  // A draft resumes at its step's key; one saved before the reorder by what its position meant then.
  const [step, setStep] = useState<number>(() => resumeStep(initialDraft?.current_step, init.stepId))
  // The furthest step reached this visit: the rail links back and forward up to it.
  const [furthest, setFurthest] = useState<number>(step)
  const key: WizardStepKey = WIZARD_STEPS[step].key
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)

  // Plan
  // A draft may name a plan that has since been retired (Starter): start from Basic instead.
  const [planSlug, setPlanSlug] = useState<string>(
    plans.some(p => p.slug === init.planSlug) ? init.planSlug : (plans.find(p => p.slug === 'basic') ?? plans[0])?.slug ?? 'basic'
  )
  const [interval, setInterval] = useState<Interval>(init.interval ?? 'monthly')
  const [compute, setCompute] = useState<ComputeChoice | null>(null)
  // Add-ons: nothing is charged here; they are bought from the store wallet once the store is live.
  const [addonIds, setAddonIds] = useState<AddonId[]>(() => cleanAddonIds(init.addons).filter(id => addons.some(a => a.id === id)))
  const addonsMonth = addons.filter(a => addonIds.includes(a.id)).reduce((sum, a) => sum + a.priceInr, 0)

  // Store: what the site shows, what it sells and the licences that needs (StoreStep).
  const [displayName, setDisplayName] = useState(init.displayName ?? '')
  const [slug, setSlug] = useState(init.slug ?? '')
  const [slugEdited, setSlugEdited] = useState(!!init.slug)
  const [productCats, setProductCats] = useState<string[]>(init.productCats ?? [])
  const [details, setDetails] = useState<StoreDetails>(() => initialStoreDetails(init, owner.email))
  const [compliance, setCompliance] = useState<ComplianceState>(() => ({
    answers: { ...(init.compliance?.answers ?? {}) },
    docs: { ...(init.compliance?.docs ?? {}) },
  }))

  // Business and GST (KYB): the answers, the PAN card, and the GST certificate or a registration proof, each checked
  // automatically as it is uploaded. The ref has the latest answers for a check started before a re-render.
  const [kyb, setKyb] = useState<KybState>(() => initialKyb(init))
  const kybRef = useRef(kyb)
  kybRef.current = kyb
  const [checking, setChecking] = useState<Record<string, boolean>>({})
  const [checkErr, setCheckErr] = useState<Record<string, string>>({})
  const bizType = kyb.entityType ? kycBusinessType(kyb.entityType) : ''
  const bizAddress = composeAddress(kyb)

  // Warehouse
  const [dailyPayout, setDailyPayout] = useState(init.dailyPayout ?? false)
  const [ownDelhivery, setOwnDelhivery] = useState(init.ownDelhivery ?? false)
  // The Delhivery token is a secret like the Razorpay key secret: it lives only in local state and is
  // sent once to submit(), never round-tripped through the cleartext autosave `data` blob.
  const [delhiveryToken, setDelhiveryToken] = useState('')
  // A draft saved before a field existed lacks it: the defaults fill it in.
  const [wh, setWh] = useState({ originPincode: '', pickupLocation: '', sellerName: '', sellerAddress: '', sellerPhone: '', ...init.wh })
  const [pinCheck, setPinCheck] = useState<{ state: 'idle' | 'checking' | 'ok' | 'warn' | 'bad'; msg: string }>({
    state: 'idle',
    msg: '',
  })

  // Bank
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

  // Branding & legals (the logo is uploaded in the Store step; the AI studio and the site use it)
  const [ownerFullName, setOwnerFullName] = useState<string>(init.ownerName ?? ownerName ?? '')
  const [mobile, setMobile] = useState(init.mobile ?? '')
  const [logoS3Key, setLogoS3Key] = useState(init.logoS3Key ?? '')
  const [logoUrl, setLogoUrl] = useState(init.logoUrl ?? '')
  const [sealS3Key, setSealS3Key] = useState(init.sealS3Key ?? '')
  const [sealUrl, setSealUrl] = useState(init.sealUrl ?? '')
  const [uploadingSeal, setUploadingSeal] = useState(false)
  const [brandErr, setBrandErr] = useState<string | null>(null)
  const [legalsAccepted, setLegalsAccepted] = useState(init.legalsAccepted ?? false)

  // Your site (site.mode): a ready-made theme (the default; one not applied here is the default theme once live), the
  // AI Site Studio (site_studio_sessions), or our standard pages. A studio site is installed after go-live. The brief is
  // kept on the draft too: in AI mode without a built site, the store's AI builds one from it once live. A site
  // already built stays on the draft (site.studio), so the Review row reads it before the studio is opened again.
  const initSite = (init.site ?? {}) as { mode?: string; skip?: boolean; description?: string; references?: string[]; studio?: { pages?: number; style?: string | null; theme?: boolean } }
  const [siteMode, setSiteMode] = useState<SiteMode>(() => initSiteMode(initSite))
  const [studio, setStudio] = useState<StudioSummary>({
    free: null,
    ready: !!initSite.studio,
    pages: Number(initSite.studio?.pages) || 0,
    style: initSite.studio?.style ?? null,
    themed: !!initSite.studio?.theme,
    description: initSite.description ?? '',
    references: (initSite.references ?? []).filter(r => HTTPS_URL.test(r)),
  })
  const [giftSeen, setGiftSeen] = useState<boolean>(!!init.studioGiftSeen)

  // Optional own domain (Store step), bought from the wallet once the store is approved.
  const [domainPick, setDomainPick] = useState<DomainPick | null>(init.domainPick ?? null)
  const [domainContact, setDomainContact] = useState<DomainContact>({ ...EMPTY_CONTACT, ...(init.domainContact ?? {}) })

  // Restore-on-re-onboard — detect a backup from a previously deprovisioned store.
  const [restoreBackup, setRestoreBackup] = useState<{ capturedAt: string; archive?: RestoreArchive } | null>(null)
  const [restoreOptIn, setRestoreOptIn] = useState<boolean>(init.restorePreviousData ?? false)
  // What to bring back from the archive a deprovision kept: the owner ticks each item.
  const [restorePick, setRestorePick] = useState<{ database: boolean; media: boolean; config: boolean }>({
    database: init.restore?.database ?? false,
    media: init.restore?.media ?? false,
    config: init.restore?.config ?? false,
  })

  useEffect(() => {
    let cancelled = false
    fetch('/api/ecom/onboard/restore-available')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!cancelled && d?.available) setRestoreBackup({ capturedAt: d.capturedAt, archive: d.archive })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  // Sent with the draft and the submit: only items the archive kept and the owner ticked.
  const restoreArchive = restoreBackup?.archive
  const restoreChoice = useMemo(() => {
    if (!restoreArchive) return undefined
    const c = {
      archiveId: restoreArchive.id,
      database: restoreArchive.database && restorePick.database,
      media: restoreArchive.media && restorePick.media,
      config: restoreArchive.config && restorePick.config,
    }
    return c.database || c.media || c.config ? c : undefined
  }, [restoreArchive, restorePick])

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
    async (nextStep: number, kybNow: KybState = kyb) => {
      setSaving(true)
      const data = {
        stepId: WIZARD_STEPS[nextStep].key,
        planSlug,
        interval,
        computeSpec: chosenSpec,
        priceInrMonth: totalMonth,
        addons: addonIds,
        displayName,
        slug: effectiveSlug,
        productCats,
        tagline: details.tagline,
        about: details.about,
        contact: details.contact,
        socials: details.socials,
        compliance,
        // KYB answers under their draft keys (kyb.ts); bizType and bizAddress for older readers.
        ...kybNow,
        bizType: kybNow.entityType ? kycBusinessType(kybNow.entityType) : '',
        bizAddress: composeAddress(kybNow),
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
        site: {
          mode: siteMode,
          skip: siteMode === 'self',
          description: studio.description.trim(),
          style: 'auto',
          references: studio.references.filter(r => HTTPS_URL.test(r)).slice(0, 3),
          images: true,
          ...(studio.ready ? { studio: { pages: studio.pages, style: studio.style, ...(studio.themed ? { theme: true } : {}) } } : {}),
        },
        studioGiftSeen: giftSeen,
        restorePreviousData: restoreBackup && !restoreBackup.archive ? restoreOptIn : false,
        restore: restoreChoice,
        domainPick,
        domainContact: domainPick ? domainContact : undefined,
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
      addonIds,
      displayName,
      effectiveSlug,
      productCats,
      details,
      compliance,
      kyb,
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
      siteMode,
      studio,
      giftSeen,
      restoreBackup,
      restoreOptIn,
      restoreChoice,
      domainPick,
      domainContact,
    ]
  )

  const onStudioSummary = useCallback((x: StudioSummary) => setStudio(x), [])
  const onGiftSeen = useCallback(() => setGiftSeen(true), [])

  async function goTo(next: number) {
    await autosave(next)
    setStep(next)
    setFurthest(f => Math.max(f, next))
  }

  // ── KYB documents: uploaded, then checked against the answers (saved to the draft first, which the check reads) ──
  const patchKybDoc = (docType: string, patch: Partial<KybUpload>) => setKyb(k => patchDoc(k, docType, patch))

  async function runCheck(docType: string, upload: KybUpload, kybNow: KybState = kybRef.current) {
    // Only for the file it checked: one replaced meanwhile gets its own check.
    const settle = (patch: Partial<KybUpload>) =>
      setKyb(k => {
        const u = k.kybDocs[docType]
        return u?.s3Key === upload.s3Key ? { ...k, kybDocs: { ...k.kybDocs, [docType]: { ...u, ...patch } } } : k
      })
    // A check that didn't run leaves the file unchecked (a reviewer looks), never blocked on an older result.
    const failed = (msg: string) => {
      settle({ analysis: undefined })
      setCheckErr(e => ({ ...e, [docType]: msg }))
    }
    setChecking(c => ({ ...c, [docType]: true }))
    setCheckErr(e => ({ ...e, [docType]: '' }))
    try {
      await autosave(step, kybNow)
      const res = await fetch('/api/ecom/onboard/kyb-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ s3Key: upload.s3Key, docType, number: upload.number?.trim() || undefined, expiresOn: upload.expiresOn || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) settle({ analysis: data.analysis ?? null, ack: false })
      else failed(data.error || 'The check didn’t run.')
    } catch {
      failed('Network error.')
    } finally {
      setChecking(c => ({ ...c, [docType]: false }))
    }
  }

  async function uploadKybDoc(docType: string, file: File) {
    const s3Key = await uploadKyc(file, docType)
    const reset: Partial<KybUpload> = { s3Key, fileName: file.name, analysis: undefined, ack: false, status: undefined }
    const next = patchDoc(kybRef.current, docType, reset)
    patchKybDoc(docType, reset)
    setCheckErr(e => ({ ...e, [docType]: '' }))
    if (!checkBlocked(docType, next)) await runCheck(docType, next.kybDocs[docType], next)
  }

  const renderDoc = (docType: string, label: string) => {
    const u = kyb.kybDocs[docType]
    return (
      <KybDocField
        id={`kyb-${docType}`}
        label={label}
        hint={KYB_DOCS[docType]?.hint}
        upload={u}
        current={checkCurrent(docType, kyb)}
        checking={!!checking[docType]}
        error={checkErr[docType] || null}
        blocked={checkBlocked(docType, kyb)}
        onUpload={f => uploadKybDoc(docType, f)}
        onRemove={() => {
          patchKybDoc(docType, { s3Key: '', fileName: '', analysis: undefined, ack: false, note: '', status: undefined })
          setCheckErr(e => ({ ...e, [docType]: '' }))
        }}
        onCheck={() => {
          if (u?.s3Key) runCheck(docType, u)
        }}
        onPatch={p => patchKybDoc(docType, p)}
      />
    )
  }

  const onLogo = useCallback((l: { s3Key: string; url: string }) => {
    setLogoS3Key(l.s3Key)
    setLogoUrl(l.url)
  }, [])

  // ── Seal upload (owner-scoped branding asset, public) ────────────────────────
  async function uploadSeal(file: File) {
    setUploadingSeal(true)
    setBrandErr(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('kind', 'seal')
      const res = await fetch('/api/ecom/onboard/brand-upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) {
        setBrandErr(data.error || 'Upload failed')
        return
      }
      setSealS3Key(data.s3Key)
      setSealUrl(data.url)
    } catch {
      setBrandErr('Network error')
    } finally {
      setUploadingSeal(false)
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

  // ── Licences: what submit sends — the answers to the questions asked now and each required document ──
  const licencePlan = useMemo(() => compliancePlan(productCats), [productCats])
  const licences = useMemo(() => requiredDocs(licencePlan, compliance.answers), [licencePlan, compliance.answers])
  const compliancePayload = useMemo(() => {
    const answers = Object.fromEntries(
      planQuestions(licencePlan)
        .filter(q => typeof compliance.answers[q.id] === 'boolean')
        .map(q => [q.id, compliance.answers[q.id]])
    )
    const docs = Object.fromEntries(licences.map(({ doc }) => [doc, compliance.docs[doc]] as const).filter(([, u]) => !!u?.s3Key))
    return { answers, docs }
  }, [licencePlan, licences, compliance])

  // The first thing keeping the Store step from complete, in the order it shows them.
  const storeIssue = useMemo(() => {
    if (!displayName.trim()) return 'Enter your store name.'
    if (effectiveSlug.length < 3) return 'The subdomain needs at least 3 characters.'
    if (!logoS3Key) return 'Upload your store logo.'
    if (!productCats.length) return 'Pick what you sell.'
    return complianceProblem(productCats, compliance) ?? storeDetailsProblem(details)
  }, [displayName, effectiveSlug, logoS3Key, productCats, compliance, details])

  // ── Final submit ─────────────────────────────────────────────────────────────
  async function submit() {
    const domainIssue = domainPick ? contactProblem(domainContact) : null
    if (domainIssue) {
      showToast(`Domain contact: ${domainIssue}`, 'error')
      return
    }
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
          addons: addonIds,
          displayName,
          slug: effectiveSlug,
          productCategories: productCats.join(', '),
          ...storeDetailsPayload(details),
          compliance: compliancePayload,
          ...kybPayload(kyb),
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
          restorePreviousData: restoreBackup && !restoreBackup.archive ? restoreOptIn : undefined,
          restore: restoreChoice,
          domain: domainPick ? { name: domainPick.name, contact: domainContact } : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error || 'Submission failed', 'error')
        return
      }
      if (data.domainError) showToast(`Application submitted. The domain wasn't reserved: ${data.domainError} You can buy one from your dashboard.`, 'info')
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

  // Prefill the domain's registrant contact from what the wizard collected, once.
  useEffect(() => {
    if (step !== REVIEW || !domainPick || domainContact.email) return
    setDomainContact({
      ...EMPTY_CONTACT,
      ...defaultContact({ ownerName: ownerFullName, email: owner.email, mobile, businessName: kyb.bizName, businessType: bizType, businessAddress: bizAddress, warehouse: wh }),
    } as DomainContact)
  }, [step, domainPick, domainContact.email, ownerFullName, owner.email, mobile, kyb.bizName, bizType, bizAddress, wh])

  // The phone is typed once (Store step): an empty seller phone and owner's mobile start from it on entering their step.
  // Likewise the store's name, address and the owner's name start the Business step's trade name, address and signatory.
  const storeMobile = IN_MOBILE.test(details.contact.phone) ? details.contact.phone : ''
  const sellerMobile = IN_MOBILE.test(wh.sellerPhone ?? '') ? (wh.sellerPhone as string) : ''
  useEffect(() => {
    if (key === 'warehouse' && storeMobile) setWh((w: typeof wh) => (w.sellerPhone ? w : { ...w, sellerPhone: storeMobile }))
    if (key === 'branding' && (storeMobile || sellerMobile)) setMobile((m: string) => m || storeMobile || sellerMobile)
    if (key === 'business') setKyb(k => prefillBusiness(k, { storeName: displayName, ownerName: ownerFullName, address: details.contact }))
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps -- on entering a step only: a cleared field stays clear

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

  /** Whether a step has what it needs; Continue follows the current one, Review checks them all. */
  function stepDone(k: WizardStepKey): boolean {
    switch (k) {
      // The configurator reports on the Plan step; resumed past it, the server checks the size at submit.
      case 'plan':
        return !!planSlug && (compute ? compute.valid : step !== S.plan)
      case 'store':
        return !storeIssue
      case 'site':
        return siteMode !== 'ai' || studio.ready || studio.description.trim().length >= 10
      case 'business':
        return !businessIssue(kyb)
      // A GSTIN only when registered: a business below the threshold says why and uploads a registration proof
      // instead (one tenant without GST once pasted the platform's own GSTIN to get past this step).
      case 'gst':
        return !gstIssue(kyb)
      case 'warehouse':
        return (
          /^\d{6}$/.test(wh.originPincode.replace(/\D/g, '')) &&
          /^[6-9]\d{9}$/.test(wh.sellerPhone.replace(/\D/g, '').slice(-10)) &&
          wh.sellerAddress.trim().length > 5 &&
          pinCheck.state !== 'bad'
        )
      case 'bank':
        return bankVerified
      case 'branding':
        return ownerFullName.trim().length >= 2 && /^[6-9]\d{9}$/.test(mobile.replace(/\D/g, '').slice(-10)) && legalsAccepted
      default:
        return true
    }
  }
  const canNext = () => stepDone(key)
  /** What keeps a step from done, for the steps that can say. */
  const issueOf = (k: WizardStepKey): string | null => (k === 'store' ? storeIssue : k === 'business' ? businessIssue(kyb) : k === 'gst' ? gstIssue(kyb) : null)
  const stepIssue = issueOf(key)

  const isLast = step === REVIEW
  // At Review: earlier steps still missing something (a draft from before the Store step asked for licences, say).
  const unfinished = isLast ? WIZARD_STEPS.filter(s => s.id < REVIEW && !stepDone(s.key)) : []

  return (
    <OnboardShell
      owner={owner}
      heading={upgrade ? `Add a store to ${upgrade.displayName}` : 'Launch your store'}
      subheading={`Go live in ${STEPS.length} steps`}
      steps={STEPS}
      current={step}
      reachable={furthest}
      onSelect={i => goTo(i)}
      saving={saving}
    >
      <div className="w-full">
        <PageHeader
          eyebrow={`Step ${step + 1} of ${STEPS.length}`}
          title={HEAD[key].title}
          description={HEAD[key].description}
          actions={key === 'site' && siteMode === 'ai' ? <FreeChip free={studio.free} /> : undefined}
        />
        <GiftCard seen={giftSeen} onSeen={onGiftSeen} />

          {/* ── Restore banner (returning owner with a prior backup) ── */}
          {restoreBackup?.archive && step <= S.store && (
            <div className={`${noteCls} org-peach mb-6`}>
              <div className="font-semibold text-foreground">We kept data from your previous store</div>
              <p className="text-foreground-secondary mt-1">
                From “{restoreBackup.archive.displayName || restoreBackup.archive.slug}”, closed on{' '}
                {new Date(restoreBackup.capturedAt).toLocaleDateString('en-IN')}. Tick what to bring back; it is kept until{' '}
                {new Date(restoreBackup.archive.expiresAt).toLocaleDateString('en-IN')}. You can also use the store name “
                {restoreBackup.archive.slug}” again.
              </p>
              <div className="mt-3 flex flex-col gap-2">
                {RESTORE_ITEMS.filter(i => restoreBackup.archive![i.key]).map(i => (
                  <label key={i.key} className="inline-flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={restorePick[i.key]}
                      onChange={e => setRestorePick(p => ({ ...p, [i.key]: e.target.checked }))}
                      className="mt-0.5 w-4 h-4 rounded accent-accent-600"
                    />
                    <span>
                      <span className="font-medium text-foreground">{i.label}</span>
                      <span className="block text-foreground-secondary text-xs">{i.what}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {restoreBackup && !restoreBackup.archive && step <= S.store && (
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

          {/* ── Plan ── */}
          {key === 'plan' && (
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
                options={[{ value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly', count: 'Save 2 months' }]} />
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
              {addonIds.length > 0 && (
                <p className="text-sm text-foreground-secondary">
                  <span className="font-semibold text-foreground">+ {inr(addonsMonth)}/mo add-ons</span>, from wallet — not part of
                  your subscription.
                </p>
              )}
              </div>
              </Card>
              {addons.length > 0 && (
                <Card title="Add-ons" className="mt-4">
                  <ChoiceCards<AddonId> multiple ariaLabel="Add-ons" columns="grid-cols-1 sm:grid-cols-2" value={addonIds} onChange={setAddonIds}
                    options={addons.map(a => ({
                      value: a.id,
                      label: ADDON_INFO[a.id].name,
                      content: (
                        <>
                          <div className="pr-6 text-sm font-semibold text-foreground">{ADDON_INFO[a.id].name}</div>
                          <div className="mt-1 text-xs text-foreground-secondary">{ADDON_INFO[a.id].benefit}</div>
                          <div className="mt-3 text-sm font-semibold text-foreground">
                            {inr(a.priceInr)}<span className="font-normal text-foreground-muted">/mo</span>
                          </div>
                        </>
                      ),
                    }))} />
                  <p className="mt-4 text-xs text-foreground-muted">
                    Optional. Add-ons are billed monthly from your store wallet once your store is live — nothing is charged now — and you
                    can turn them off anytime in Billing.
                    {addonIds.includes('messaging') && ' Messages you send are charged separately.'}
                  </p>
                </Card>
              )}
            </div>
          )}

          {/* ── Store ── */}
          {key === 'store' && (
            <StoreStep
              upgrade={!!upgrade}
              displayName={displayName}
              onDisplayName={setDisplayName}
              slug={effectiveSlug}
              onSlug={v => {
                setSlugEdited(true)
                setSlug(slugify(v))
              }}
              categories={productCats}
              onCategories={setProductCats}
              logo={{ s3Key: logoS3Key, url: logoUrl }}
              onLogo={onLogo}
              details={details}
              onDetails={setDetails}
              compliance={compliance}
              onCompliance={setCompliance}
              domainPick={domainPick}
              onDomainPick={setDomainPick}
            />
          )}

          {/* ── Business ── */}
          {key === 'business' && <BusinessStep value={kyb} onChange={setKyb} renderDoc={renderDoc} />}

          {/* ── GST ── */}
          {key === 'gst' && <GstStep value={kyb} onChange={setKyb} renderDoc={renderDoc} />}

          {/* ── Warehouse ── */}
          {key === 'warehouse' && (
            <Card>
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
                  <div>
                    <label htmlFor="wh-pincode" className={lbl}>Origin pincode</label>
                    <input
                      id="wh-pincode"
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
                    <label htmlFor="wh-pickup" className={lbl}>Pickup location name</label>
                    <input
                      id="wh-pickup"
                      className={inp}
                      value={wh.pickupLocation}
                      onChange={e => setWh({ ...wh, pickupLocation: e.target.value })}
                    />
                  </div>
                  <div>
                    <label htmlFor="wh-seller-name" className={lbl}>Seller / warehouse name</label>
                    <input
                      id="wh-seller-name"
                      className={inp}
                      value={wh.sellerName}
                      onChange={e => setWh({ ...wh, sellerName: e.target.value })}
                    />
                  </div>
                  <div className="xl:col-span-2">
                    <label htmlFor="wh-seller-phone" className={lbl}>Seller phone</label>
                    <PhoneInput id="wh-seller-phone" countries={['IN']} value={wh.sellerPhone} onChange={v => setWh({ ...wh, sellerPhone: v })} inputClassName={`${inp} min-w-0 flex-1`} />
                  </div>
                </div>
                <div>
                  <label htmlFor="wh-address" className={lbl}>Warehouse address</label>
                  <textarea
                    id="wh-address"
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
                      <label htmlFor="wh-delhivery-token" className={lbl}>Delhivery API token</label>
                      <input
                        id="wh-delhivery-token"
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

          {/* ── Bank ── */}
          {key === 'bank' && (
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
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                  <div className="col-span-full sm:col-span-2">
                    <label htmlFor="bank-holder" className={lbl}>Account holder name</label>
                    <input
                      id="bank-holder"
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
                    <label htmlFor="bank-account" className={lbl}>Account number</label>
                    <input
                      id="bank-account"
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
                    <label htmlFor="bank-ifsc" className={lbl}>IFSC code</label>
                    <input
                      id="bank-ifsc"
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
                    <label htmlFor="bank-upi" className={lbl}>
                      UPI ID <span className="text-foreground-muted font-normal">(optional)</span>
                    </label>
                    <input
                      id="bank-upi"
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
                      <label htmlFor="rzp-key-id" className={lbl}>Razorpay Key ID</label>
                      <input
                        id="rzp-key-id"
                        className={inp}
                        value={rzpKeyId}
                        onChange={e => setRzpKeyId(e.target.value.trim())}
                      />
                    </div>
                    <div>
                      <label htmlFor="rzp-key-secret" className={lbl}>Razorpay Key Secret</label>
                      <input
                        id="rzp-key-secret"
                        className={inp}
                        type="password"
                        autoComplete="off"
                        value={rzpKeySecret}
                        onChange={e => setRzpKeySecret(e.target.value)}
                      />
                    </div>
                    <div>
                      <label htmlFor="rzp-webhook-secret" className={lbl}>
                        Webhook Secret <span className="text-foreground-muted font-normal">(optional)</span>
                      </label>
                      <input
                        id="rzp-webhook-secret"
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

          {/* ── Branding & legals ── */}
          {key === 'branding' && (
            <Card>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-4">
              <div className="mb-6">
                <label htmlFor="owner-name" className={lbl}>Your full name</label>
                <input
                  id="owner-name"
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
                <label htmlFor="owner-mobile" className={lbl}>Mobile number</label>
                <PhoneInput id="owner-mobile" countries={['IN']} value={mobile} onChange={setMobile} inputClassName={`${inp} min-w-0 flex-1`} />
                <p className="text-xs text-foreground-muted mt-1">Used for account + payout notifications.</p>
              </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                <div>
                  <span className={lbl}>Store seal (optional)</span>
                  <label className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-default bg-surface p-4 cursor-pointer hover:border-accent-500 focus-within:border-accent-500 transition-colors min-h-[112px]">
                    {sealUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={sealUrl} alt="Store seal" className="max-h-16 object-contain" />
                    ) : (
                      <span className="text-xs text-foreground-muted text-center">{uploadingSeal ? 'Uploading…' : 'Upload store seal'}</span>
                    )}
                    <input
                      type="file"
                      accept=".png,.jpg,.jpeg,.webp"
                      className="sr-only"
                      aria-label="Upload your store seal"
                      onChange={e => {
                        const f = e.target.files?.[0]
                        if (f) uploadSeal(f)
                      }}
                    />
                  </label>
                  {sealS3Key && <p className="text-[10px] org-sage-text mt-1">✓ uploaded</p>}
                </div>
                <p className="self-center text-xs text-foreground-muted">
                  Printed in the Authorised Signatory box on your invoices and policy documents. Your logo is in the Store step.
                </p>
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

          {key === 'site' && (
            <SiteStudio
              mode={siteMode}
              onModeChange={setSiteMode}
              storeName={displayName}
              logoUrl={logoUrl || null}
              categories={productCats}
              onSummary={onStudioSummary}
            />
          )}

          {key === 'review' && (
            <div className="space-y-4">
              {unfinished.length > 0 && (
                <div role="alert" className={`${noteCls} org-peach`}>
                  <div className="font-semibold text-foreground">Finish these steps before you submit</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {unfinished.map(s => (
                      <button key={s.key} type="button" onClick={() => goTo(s.id)} className="rounded-full org-sand org-sand-hover px-3 py-1.5 text-xs font-semibold text-foreground">
                        {s.label}
                      </button>
                    ))}
                  </div>
                  {unfinished.map(s => {
                    const issue = issueOf(s.key)
                    return issue ? (
                      <p key={s.key} className="mt-2 text-xs text-foreground-secondary">
                        {s.label}: {issue}
                      </p>
                    ) : null
                  })}
                </div>
              )}
              <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] lg:items-start gap-4">
              <Card title="Your application">
              <div className="space-y-2.5">
                {[
                  [
                    'Subscription',
                    [selectedPlan?.name, interval, priceLabel].filter(Boolean).join(' · '),
                  ],
                  ...(addonIds.length
                    ? [
                        [
                          'Add-ons',
                          `${addonIds.map(id => ADDON_INFO[id].name).join(', ')} · ${inr(addonsMonth)}/mo from wallet once live`,
                        ] as [string, string],
                      ]
                    : []),
                  ['Store', `${displayName} (${effectiveSlug}.jeffistores.in)`],
                  ...(domainPick
                    ? [['Domain', `${domainPick.name} · ₹${domainPick.priceInr.toLocaleString('en-IN')}/year from your wallet once approved`] as [string, string]]
                    : []),
                  ['Products', productCats.join(', ') || '—'],
                  ['Contact', [details.contact.phone, details.contact.email.trim()].filter(Boolean).join(' · ') || '—'],
                  ['Licences & certificates', licences.map(l => DOCS[l.doc]?.name ?? l.doc).join(', ') || 'None needed'],
                  ['Business', [kyb.bizName.trim(), ENTITY_TYPES.find(e => e.id === kyb.entityType)?.label].filter(Boolean).join(' · ') || '—'],
                  ['Address', bizAddress || '—'],
                  ['Signatory', [kyb.signatoryName.trim(), kyb.signatoryDesignation.trim()].filter(Boolean).join(', ') || '—'],
                  ['PAN', kyb.pan ? maskPan(kyb.pan) : '—'],
                  [
                    'GST',
                    kyb.gstRegistered
                      ? kyb.gstNumber || '—'
                      : kyb.gstRegistered === false
                        ? `Not registered${kyb.gstExemptReason ? ` · ${GST_EXEMPT_REASONS.find(r => r.id === kyb.gstExemptReason)?.label}` : ''}`
                        : '—',
                  ],
                  [
                    'Business documents',
                    ['pan_card', kyb.gstRegistered ? 'gst_cert' : kyb.regDocType]
                      .filter(t => !!t && !!kyb.kybDocs[t]?.s3Key)
                      .map(docLabel)
                      .join(', ') || '—',
                  ],
                  ['Bank', bankVerified ? `${bank.holderName} · ${maskAccount(bank.accountNumber)}` : 'Not added'],
                  ['UPI ID', bankVerified && bank.upiId ? maskUpi(bank.upiId) : '—'],
                  ['Payouts', dailyPayout ? 'Daily (+5%)' : 'Weekly'],
                  ['Delhivery', ownDelhivery ? 'Own account' : 'Managed by Jeffi'],
                  ['Payments', ownRazorpay ? 'Own Razorpay' : 'Routed via Jeffi'],
                  ['Owner name', ownerFullName.trim() || '—'],
                  ['Mobile', mobile || '—'],
                  ['Logo', logoS3Key ? 'Uploaded' : 'Not uploaded'],
                  ['Seal', sealS3Key ? 'Uploaded' : 'Not uploaded'],
                  ['Legal terms', legalsAccepted ? 'Accepted' : 'Not accepted'],
                  [
                    'Your site',
                    siteMode === 'self'
                      ? 'You design it in Site Builder'
                      : studio.ready
                        ? studio.themed
                          ? `Made from the ${studio.style ?? 'ready-made'} theme · ${studio.pages} pages`
                          : `Designed in the AI Site Studio · ${studio.pages} pages${studio.style ? ` · ${studio.style}` : ''}`
                        : siteMode === 'theme'
                          ? 'Opens with our default ready-made theme · change it any time in Site Builder'
                          : 'Built by AI from your answers once live',
                  ],
                  ...(restoreBackup
                    ? [
                        [
                          'Restore data',
                          restoreBackup.archive
                            ? RESTORE_ITEMS.filter(i => restoreChoice?.[i.key])
                                .map(i => i.label)
                                .join(', ') || 'No — start fresh'
                            : restoreOptIn
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
              </div>
              {domainPick && (
                <Card title={`Your domain: ${domainPick.name}`}>
                  <p className="text-sm text-foreground-secondary mb-4">
                    Bought for ₹{domainPick.priceInr.toLocaleString('en-IN')} (first year) from your wallet once your store is approved, then renewed yearly at ₹
                    {domainPick.renewalPriceInr.toLocaleString('en-IN')}. Top up your wallet before approval so it goes through; if the name is taken by then, nothing is charged.
                  </p>
                  <ContactFields value={domainContact} onChange={setDomainContact} />
                  <p className="mt-2 text-xs text-foreground-muted">The registry emails this address to confirm it. Confirm within 15 days or the domain is suspended.</p>
                </Card>
              )}
              <div className={`${noteCls} org-peach`}>
                After submitting, our team will review your licences and certificates (1–2 business days).{' '}
                {/* Assumes payment: the administrator picks Mandatory or Optional at approval. */}
                You&apos;ll receive an email when approved — then you&apos;ll complete payment and your store goes live.
              </div>
            </div>
          )}

          {/* ── Navigation ── */}
          {stepIssue && (
            <p className="mt-6 text-right text-xs text-foreground-muted" aria-live="polite">
              To continue: {stepIssue}
            </p>
          )}
          <div className={`${stepIssue ? 'mt-2' : 'mt-6'} flex items-center justify-between gap-3`}>
            <button
              type="button"
              onClick={() => goTo(step - 1)}
              disabled={step === 0}
              className={ghostBtn}
            >
              ← Back
            </button>
            {isLast ? (
              <button onClick={submit} disabled={busy || unfinished.length > 0} className={`${primaryBtn} flex-1 sm:flex-none px-6`}>
                {busy ? 'Submitting…' : 'Submit for approval'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => canNext() && goTo(step + 1)}
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
