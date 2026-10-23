'use client'

import { useEffect, useMemo, useState } from 'react'
import { useActionToast } from '@/components/admin/kit/toast'
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, Megaphone } from 'lucide-react'
import IconButton from '@/components/ui/IconButton'
import { useCanUseAi, useCanWrite } from '@/contexts/AdminScopesContext'
import type { WizardBootstrap } from '@/lib/google-ads/manage-data'
import { FEED_TYPES, IMAGE_AD_TYPES, specProblems } from '@/lib/google-ads/campaign-spec'
import { postJson, errorText } from './ManageContext'
import { newDraft, toSpec, type Draft } from './wizard/draft'
import { Modal, btnGhost, btnPrimary } from './wizard/fields'
import { StepCampaign, StepTargeting } from './wizard/StepBasics'
import { AssetGroupEditor, MerchantLink, ProductGroups, SearchAds, type LinkState } from './wizard/StepAds'
import { ImageAdEditor, type CampaignOptions } from './wizard/StepImageAd'
import ExtensionsEditor, { SuggestionsLoading, emptyExtDraft, fetchExtDraft, type ExtDraft } from './wizard/ExtensionsEditor'

// New campaign wizard: Search, Standard Shopping, Performance Max, Demand Gen or Display. "Check with Google" sends the
// whole campaign with validateOnly; "Create" validates again and creates it (paused by default).

const STEPS = ['Campaign', 'Targeting', 'Ads', 'Assets', 'Review'] as const

interface Problem {
  message: string
  where?: string
}

export function NewCampaignButton({ onCreated }: { onCreated: () => void }) {
  const canManage = useCanWrite('google_ads_campaigns')
  const [open, setOpen] = useState(false)
  if (!canManage) return null
  return (
    <>
      <IconButton icon={Megaphone} label="New campaign" variant="accent" onClick={() => setOpen(true)} />
      {open && <CampaignWizard onClose={() => setOpen(false)} onCreated={onCreated} />}
    </>
  )
}

export default function CampaignWizard({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const canAi = useCanUseAi('google_ads_campaigns')
  const [b, setB] = useState<WizardBootstrap | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [d, setD] = useState<Draft | null>(null)
  const [step, setStep] = useState(0)
  const [ext, setExt] = useState<ExtDraft | null>(null)
  const [extError, setExtError] = useState<string | null>(null)
  const [link, setLink] = useState<LinkState | null>(null)
  const [options, setOptions] = useState<CampaignOptions | null>(null)
  const [busy, setBusy] = useState<'preview' | 'create' | null>(null)
  const [result, setResultState] = useState<{ ok: boolean; text: string; problems?: Problem[]; done?: boolean } | null>(null)
  const toast = useActionToast()
  const setResult = (r: { ok: boolean; text: string; problems?: Problem[]; done?: boolean } | null) => {
    setResultState(r)
    if (r) toast.result(r)
  }

  useEffect(() => {
    fetch('/api/admin/google-ads/manage', { credentials: 'include' })
      .then(async r => {
        const data = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(data.error || 'Could not load store data')
        setB(data)
        setD(newDraft(data))
      })
      .catch(e => setLoadError(e.message))
  }, [])

  // Asset suggestions load once, when the Assets step is first opened.
  useEffect(() => {
    if (step !== 3 || ext) return
    fetchExtDraft()
      .then(setExt)
      .catch(e => {
        setExtError(e.message)
        setExt(emptyExtDraft())
      })
  }, [step, ext])

  // Demand Gen's daily minimum and the account's audiences, read from Google once.
  const wantsOptions = d?.type === 'DEMAND_GEN'
  useEffect(() => {
    if (!wantsOptions || options) return
    fetch('/api/admin/google-ads/manage/campaign-options', { credentials: 'include' })
      .then(async r => {
        const data = await r.json().catch(() => ({}))
        setOptions(
          r.ok
            ? data
            : { currency: 'INR', demandGenMinimum: 0, demandGenMinimumFromGoogle: false, audiences: [], audiencesError: data.error || 'Could not read the account' }
        )
      })
      .catch(() => undefined)
  }, [wantsOptions, options])

  const set = (p: Partial<Draft>) => {
    setResult(null)
    setD(cur => (cur ? { ...cur, ...p } : cur))
  }
  const spec = useMemo(() => (d ? toSpec(d, ext) : null), [d, ext])
  const problems = useMemo(() => {
    if (!spec) return []
    const list = specProblems(spec, undefined, { demandGenMinimum: options?.demandGenMinimum || null })
    if (spec.type === 'DEMAND_GEN' && !b?.store.logoUrl) list.push('Demand Gen ads need a logo: add a store logo in Site Controls')
    if (spec.assetGroup && !spec.assetGroup.feedOnly && !b?.store.logoUrl) list.push('Add a store logo in Site Controls, or use the product feed only')
    return list
  }, [spec, b, options])
  const needsLink = !!d && FEED_TYPES.includes(d.type)
  const linkBlocked = !!needsLink && !link?.linked

  async function send(preview: boolean) {
    if (!spec) return
    setBusy(preview ? 'preview' : 'create')
    setResult(null)
    const { ok, data } = await postJson('/api/admin/google-ads/manage/campaigns', { spec, preview })
    setBusy(null)
    if (!ok) return setResult({ ok: false, text: errorText(data, 'Google Ads rejected the campaign'), problems: data.problems })
    if (preview) {
      const total = Object.values(data.operations ?? {}).reduce((s: number, v: any) => s + Number(v), 0)
      setResult({
        ok: true,
        text: `Google accepted the campaign (${total} changes checked, nothing created yet).${data.followUps?.length ? ` Applied right after creating: ${data.followUps.join(', ')}.` : ''}`,
      })
    } else {
      setResult({ ok: true, done: true, text: `Created campaign ${data.campaignId}${spec.status === 'PAUSED' ? ' (paused)' : ''}. It shows in the Campaigns tab.` })
      onCreated()
    }
  }

  const stepLabel = (i: number) =>
    i === 2 && d
      ? d.type === 'SEARCH'
        ? 'Ads & keywords'
        : d.type === 'SHOPPING'
          ? 'Products'
          : IMAGE_AD_TYPES.includes(d.type)
            ? 'Ad'
            : 'Products & assets'
      : STEPS[i]

  const footer = (
    <>
      {step > 0 && (
        <button type="button" className={btnGhost} onClick={() => setStep(s => s - 1)}>
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
      )}
      {step < STEPS.length - 1 && (
        <button type="button" className={btnPrimary} disabled={!d} onClick={() => setStep(s => s + 1)}>
          Next <ChevronRight className="w-4 h-4" />
        </button>
      )}
      {step === STEPS.length - 1 && !result?.done && (
        <>
          <button type="button" className={btnGhost} disabled={!!busy || problems.length > 0 || linkBlocked} onClick={() => send(true)}>
            {busy === 'preview' && <Loader2 className="w-4 h-4 animate-spin" />} Check with Google
          </button>
          <button type="button" className={btnPrimary} disabled={!!busy || problems.length > 0 || linkBlocked} onClick={() => send(false)}>
            {busy === 'create' && <Loader2 className="w-4 h-4 animate-spin" />} Create campaign
          </button>
        </>
      )}
      {result?.done && (
        <button type="button" className={btnPrimary} onClick={onClose}>
          Done
        </button>
      )}
    </>
  )

  return (
    <Modal title="New Google Ads campaign" onClose={onClose} footer={footer} wide>
      {loadError && <p className="text-sm text-red-500">{loadError}</p>}
      {!loadError && (!b || !d) && (
        <p className="text-sm text-foreground-muted flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading your store data...
        </p>
      )}
      {b && d && (
        <>
          <ol className="flex flex-wrap gap-1 text-xs">
            {STEPS.map((_, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => setStep(i)}
                  className={`rounded-full px-3 py-1 ${i === step ? 'bg-accent-500 text-white' : 'bg-surface-secondary text-foreground-muted hover:text-foreground'}`}
                >
                  {i + 1}. {stepLabel(i)}
                </button>
              </li>
            ))}
          </ol>

          {step === 0 && <StepCampaign d={d} set={set} b={b} demandGenMinimum={options?.demandGenMinimum} />}
          {step === 1 && <StepTargeting d={d} set={set} b={b} />}
          {step === 2 && d.type === 'SEARCH' && <SearchAds d={d} set={set} b={b} canAi={canAi} />}
          {step === 2 && IMAGE_AD_TYPES.includes(d.type) && <ImageAdEditor d={d} set={set} b={b} canAi={canAi} options={options} />}
          {step === 2 && FEED_TYPES.includes(d.type) && (
            <div className="space-y-4">
              <MerchantLink onState={setLink} />
              <ProductGroups d={d} set={set} b={b} />
              {d.type === 'PERFORMANCE_MAX' && <AssetGroupEditor d={d} set={set} b={b} canAi={canAi} />}
            </div>
          )}
          {step === 3 && IMAGE_AD_TYPES.includes(d.type) && (
            <p className="text-sm text-foreground-muted">
              Sitelinks, callouts, promotions and price lists are used by Search, Shopping and Performance Max; this campaign type does not take them.
            </p>
          )}
          {step === 3 &&
            !IMAGE_AD_TYPES.includes(d.type) &&
            (ext ? (
              <>
                {extError && <p className="text-xs text-red-500">{extError}</p>}
                <p className="text-xs text-foreground-muted">Suggested from your store. Untick anything you do not want; edit the text freely.</p>
                <ExtensionsEditor draft={ext} onChange={setExt} canAi={canAi} facts={b.facts} />
              </>
            ) : (
              <SuggestionsLoading error={extError} />
            ))}
          {step === 4 && spec && (
            <div className="space-y-3 text-sm">
              <ul className="space-y-1">
                <li>
                  <b>{spec.name || 'Unnamed campaign'}</b> · {spec.type.replace('_', ' ').toLowerCase()} · ₹{spec.dailyBudget}/day ·{' '}
                  {spec.bidding.strategy.replace(/_/g, ' ').toLowerCase()}
                  {spec.bidding.targetCpa ? ` (target CPA ₹${spec.bidding.targetCpa})` : ''}
                  {spec.bidding.targetRoas ? ` (target ROAS ${Math.round(spec.bidding.targetRoas * 100)}%)` : ''}
                </li>
                <li>Locations: {spec.locations.map(l => l.name).join(', ') || 'none'}</li>
                {spec.type === 'SEARCH' && (
                  <li>
                    {spec.adGroups?.length} ad group(s), {spec.adGroups?.reduce((s, g) => s + g.keywords.length, 0)} keywords
                  </li>
                )}
                {spec.listing && <li>Products: {spec.listing.dimension === 'ALL' ? 'all' : `${spec.listing.values.length} ${spec.listing.dimension.toLowerCase()} group(s)`}</li>}
                {spec.imageAd && (
                  <li>
                    Ad: {spec.imageAd.headlines.length} headlines, {spec.imageAd.descriptions.length} descriptions, {spec.imageAd.imageIds.length} product images
                    {spec.imageAd.audiences.length ? `, ${spec.imageAd.audiences.length} audience(s)` : ''}
                  </li>
                )}
                {spec.extensions && (
                  <li>
                    Assets: {spec.extensions.sitelinks.length} sitelinks, {spec.extensions.callouts.length} callouts, {spec.extensions.promotions.length} promotions,{' '}
                    {spec.extensions.prices.length} price lists, {spec.extensions.snippets.length} snippets
                  </li>
                )}
                <li>Created {spec.status === 'PAUSED' ? 'paused: enable it from the Campaigns tab when ready' : 'enabled: it starts serving once Google approves the ads'}.</li>
              </ul>
              {linkBlocked && (
                <p className="text-amber-700 dark:text-amber-400 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> Link Merchant Center on the Products step first.
                </p>
              )}
              {problems.length > 0 && (
                <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-3">
                  <p className="font-medium text-red-600 dark:text-red-400 mb-1">Fix these first:</p>
                  <ul className="list-disc pl-5 space-y-0.5">
                    {problems.map(p => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {result && !result.ok && (result.problems?.length ?? 0) > 1 && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm" role="status">
              <p className="font-medium text-red-600 dark:text-red-400 mb-1">Google also reported:</p>
              <ul className="list-disc pl-5 space-y-0.5 text-xs break-words">
                {result.problems!.slice(1, 10).map((p, i) => (
                  <li key={i}>{p.where ? `${p.where}: ${p.message}` : p.message}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Modal>
  )
}
