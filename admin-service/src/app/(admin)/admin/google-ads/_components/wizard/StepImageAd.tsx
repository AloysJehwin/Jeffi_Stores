'use client'

import { useState } from 'react'
import AdminSelect from '@/components/admin/AdminSelect'
import type { WizardBootstrap } from '@/lib/google-ads/manage-data'
import { CALL_TO_ACTIONS, type ImageAdSpec } from '@/lib/google-ads/campaign-spec'
import { COUNTS, LIMITS } from '@/lib/google-ads/limits'
import { postJson, errorText } from '../ManageContext'
import type { Draft } from './draft'
import { AiAssetImage } from './AiAssetImage'
import { AiButton, Field, LimitedInput, TextList, inputCls } from './fields'

// The Demand Gen multi-asset ad / Display responsive display ad: copy, catalogue images, logo,
// button text, and (Demand Gen) channels and audiences.

type Patch = (p: Partial<Draft>) => void

export interface CampaignOptions {
  currency: string
  demandGenMinimum: number
  demandGenMinimumFromGoogle: boolean
  audiences: { id: string; name: string }[]
  audiencesError: string | null
}

const CHANNELS: { value: ImageAdSpec['channels']; label: string }[] = [
  { value: 'ALL_CHANNELS', label: 'All channels: YouTube, Discover, Gmail and Display (recommended)' },
  { value: 'ALL_OWNED_AND_OPERATED_CHANNELS', label: 'Google-owned channels only: YouTube, Discover, Gmail, Maps' },
]

export function ImageAdEditor({
  d,
  set,
  b,
  canAi,
  options,
}: {
  d: Draft
  set: Patch
  b: WizardBootstrap
  canAi: boolean
  options: CampaignOptions | null
}) {
  const a = d.imageAd
  const dg = d.type === 'DEMAND_GEN'
  const [aiBusy, setAiBusy] = useState(false)
  const [aiNote, setAiNote] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const upd = (p: Partial<Draft['imageAd']>) => set({ imageAd: { ...a, ...p } })
  const maxImages = COUNTS.imageAdImages[1]
  const headCount = dg ? COUNTS.demandGenHeadlines : COUNTS.displayHeadlines
  const descCount = dg ? COUNTS.demandGenDescriptions : COUNTS.displayDescriptions

  async function write() {
    setAiBusy(true)
    setAiNote(null)
    const { ok, data } = await postJson('/api/admin/google-ads/manage/ai-copy', { kind: 'pmax', context: { category: null, finalUrl: a.finalUrl, facts: b.facts, brand: null } })
    setAiBusy(false)
    if (!ok) return setAiNote(errorText(data, 'AI could not write this'))
    upd({
      headlines: data.headlines?.length ? data.headlines.slice(0, headCount[1]) : a.headlines,
      longHeadline: data.longHeadlines?.[0] ?? a.longHeadline,
      descriptions: data.descriptions?.length ? data.descriptions.slice(0, descCount[1]) : a.descriptions,
    })
  }

  const [aiImages, setAiImages] = useState<WizardBootstrap['images']>([])
  const images = [...aiImages, ...b.images].filter(i => !filter || i.productName.toLowerCase().includes(filter.toLowerCase())).slice(0, 48)
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Ad group name (optional)">
          <input className={inputCls} value={a.adGroupName} placeholder={`${d.name || 'Campaign'} ad group`} onChange={e => upd({ adGroupName: e.target.value })} />
        </Field>
        <Field label="Landing page">
          <input className={inputCls} value={a.finalUrl} onChange={e => upd({ finalUrl: e.target.value })} />
        </Field>
      </div>
      <TextList
        label="Headline"
        items={a.headlines}
        onChange={v => upd({ headlines: v })}
        max={LIMITS.headline}
        min={headCount[0]}
        maxItems={headCount[1]}
        action={canAi ? <AiButton busy={aiBusy} onClick={write} /> : undefined}
      />
      {!dg && (
        <Field label="Long headline">
          <LimitedInput value={a.longHeadline} max={LIMITS.longHeadline} onChange={v => upd({ longHeadline: v })} />
        </Field>
      )}
      <TextList label="Description" items={a.descriptions} onChange={v => upd({ descriptions: v })} max={LIMITS.description} min={descCount[0]} maxItems={descCount[1]} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Business name">
          <LimitedInput value={a.businessName} max={LIMITS.businessName} onChange={v => upd({ businessName: v })} />
        </Field>
        <AdminSelect
          label="Button text"
          value={a.callToAction}
          options={[{ value: '', label: 'Automated (Google chooses)' }, ...CALL_TO_ACTIONS.map(c => ({ value: c, label: c }))]}
          onChange={v => upd({ callToAction: v })}
        />
      </div>
      {b.store.logoUrl ? (
        <p className="text-xs text-foreground-muted">Logo: your store logo from Site Controls, fitted to a square.</p>
      ) : (
        <p className={`text-xs ${dg ? 'text-red-500' : 'text-foreground-muted'}`}>
          {dg ? 'Demand Gen ads need a logo. Add a store logo in Site Controls.' : 'No store logo: the ad runs without one. Add a logo in Site Controls for better placements.'}
        </p>
      )}
      <div className="space-y-2">
        <span className="text-xs font-medium text-foreground-secondary">
          Product images ({a.imageIds.length}/{maxImages}): each is fitted on white to 1.91:1 and 1:1{dg ? ' and 4:5 portrait' : ''}
        </span>
        <input className={inputCls} value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter by product name" />
        {canAi && a.imageIds.length < maxImages && (
          <AiAssetImage
            images={[...aiImages, ...b.images]}
            selected={a.imageIds}
            onAdd={img => {
              setAiImages(list => [img, ...list])
              upd({ imageIds: [...a.imageIds, img.id] })
            }}
          />
        )}
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-72 overflow-y-auto">
          {images.map(img => {
            const on = a.imageIds.includes(img.id)
            return (
              <button
                key={img.id}
                type="button"
                aria-pressed={on}
                title={img.productName}
                disabled={!on && a.imageIds.length >= maxImages}
                onClick={() => upd({ imageIds: on ? a.imageIds.filter(x => x !== img.id) : [...a.imageIds, img.id] })}
                className={`relative aspect-square rounded-lg border overflow-hidden bg-white disabled:opacity-40 ${on ? 'border-accent-500 ring-2 ring-accent-500/50' : 'border-border-default'}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt={img.productName} className="w-full h-full object-contain" loading="lazy" />
              </button>
            )
          })}
        </div>
      </div>
      {dg && (
        <>
          <AdminSelect label="Where the ads show" value={a.channels} options={CHANNELS} onChange={v => upd({ channels: v as ImageAdSpec['channels'] })} />
          <div className="space-y-1">
            <span className="text-xs font-medium text-foreground-secondary">Audiences (optional; without one, Google finds people likely to buy)</span>
            {!options && <p className="text-xs text-foreground-muted">Loading audiences...</p>}
            {options?.audiencesError && <p className="text-xs text-amber-600">Audiences could not be read: {options.audiencesError}</p>}
            {options && !options.audiences.length && !options.audiencesError && (
              <p className="text-xs text-foreground-muted">No audiences in this Google Ads account yet.</p>
            )}
            <div className="grid gap-1 sm:grid-cols-2 max-h-40 overflow-y-auto">
              {(options?.audiences ?? []).map(o => (
                <label key={o.id} className="text-sm flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={a.audiences.includes(o.id)}
                    onChange={e => upd({ audiences: e.target.checked ? [...a.audiences, o.id] : a.audiences.filter(x => x !== o.id) })}
                  />
                  {o.name || o.id}
                </label>
              ))}
            </div>
          </div>
        </>
      )}
      {aiNote && <p className="text-xs text-amber-600">{aiNote}</p>}
    </div>
  )
}
