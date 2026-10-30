'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, Link2, Loader2, Plus, Trash2 } from 'lucide-react'
import AdminSelect from '@/components/admin/AdminSelect'
import type { WizardBootstrap } from '@/lib/google-ads/manage-data'
import { COUNTS, LIMITS, adTextLength } from '@/lib/google-ads/limits'
import { MATCH_TYPES, filled, type ListingDimension, type MatchType } from '@/lib/google-ads/campaign-spec'
import { postJson, errorText } from '../ManageContext'
import { newAdGroup, parseKeywordLines, type Draft, type DraftAdGroup } from './draft'
import { AiAssetImage } from './AiAssetImage'
import { AiButton, Chip, Field, LimitedInput, TextList, btnGhost, inputCls } from './fields'

type Patch = (p: Partial<Draft>) => void

interface Idea {
  text: string
  avgMonthlySearches: number | null
  competition: string | null
  lowBid: number | null
  highBid: number | null
}

const MATCH_LABEL: Record<MatchType, string> = { EXACT: 'Exact', PHRASE: 'Phrase', BROAD: 'Broad' }

function KeywordPicker({
  g,
  update,
  b,
  d,
}: {
  g: DraftAdGroup
  update: (p: Partial<DraftAdGroup>) => void
  b: WizardBootstrap
  d: Draft
}) {
  const [match, setMatch] = useState<MatchType>('PHRASE')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [ideas, setIdeas] = useState<{ seeds: string[]; ideas: Idea[]; ideasError: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const addKeywords = (list: { text: string; matchType: MatchType }[]) => {
    const seen = new Set(g.keywords.map(k => `${k.text}|${k.matchType}`))
    update({ keywords: [...g.keywords, ...list.filter(k => k.text && !seen.has(`${k.text}|${k.matchType}`))] })
  }

  async function suggest() {
    setBusy(true)
    setError(null)
    const { ok, data } = await postJson('/api/admin/google-ads/manage/keyword-ideas', {
      categoryId: g.categoryId || null,
      url: g.finalUrl || null,
      language: d.languages[0],
      locations: d.locations.slice(0, 10).map(l => l.id),
    })
    setBusy(false)
    if (!ok) return setError(errorText(data, 'Could not suggest keywords'))
    setIdeas(data)
  }

  return (
    <div className="space-y-2">
      <span className="text-xs font-medium text-foreground-secondary">Keywords ({g.keywords.length})</span>
      <div className="flex flex-wrap gap-1.5">
        {g.keywords.map((k, i) => (
          <Chip key={`${k.text}${k.matchType}`} label={`${k.text} · ${MATCH_LABEL[k.matchType]}`} onRemove={() => update({ keywords: g.keywords.filter((_, j) => j !== i) })} />
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[12rem]">
          <textarea className={`${inputCls} h-20`} value={text} onChange={e => setText(e.target.value)} placeholder={'One keyword per line\n[exact] or "phrase" to override the match type'} aria-label="Keywords to add" />
        </div>
        <AdminSelect sm value={match} options={MATCH_TYPES.map(m => ({ value: m, label: MATCH_LABEL[m] }))} onChange={v => setMatch(v as MatchType)} />
        <button
          type="button"
          className={btnGhost}
          onClick={() => {
            addKeywords(parseKeywordLines(text, match))
            setText('')
          }}
        >
          Add
        </button>
        <button type="button" className={btnGhost} disabled={busy} onClick={suggest}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} Suggest keywords
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {ideas && (
        <div className="rounded-lg border border-border-default p-3 space-y-2 max-h-64 overflow-y-auto">
          <p className="text-xs text-foreground-muted">From your catalogue{ideas.ideas.length ? ' and Keyword Planner' : ''}. Click to add as {MATCH_LABEL[match].toLowerCase()} match.</p>
          <div className="flex flex-wrap gap-1.5">
            {ideas.seeds.map(s => (
              <button key={`s${s}`} type="button" className="control-xs rounded-full border border-border-default hover:bg-surface-secondary" onClick={() => addKeywords([{ text: s, matchType: match }])}>
                + {s}
              </button>
            ))}
          </div>
          {ideas.ideas.length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-foreground-muted text-left">
                  <th className="py-1">Keyword idea</th>
                  <th className="py-1 text-right">Searches/mo</th>
                  <th className="py-1">Competition</th>
                  <th className="py-1 text-right">Top-of-page bid</th>
                </tr>
              </thead>
              <tbody>
                {ideas.ideas.slice(0, 40).map(i => (
                  <tr key={i.text} className="border-t border-border-default/60">
                    <td className="py-1">
                      <button type="button" className="text-accent-600 hover:underline" onClick={() => addKeywords([{ text: i.text, matchType: match }])}>
                        + {i.text}
                      </button>
                    </td>
                    <td className="py-1 text-right tabular-nums">{i.avgMonthlySearches?.toLocaleString('en-IN') ?? '-'}</td>
                    <td className="py-1">{i.competition?.toLowerCase() ?? '-'}</td>
                    <td className="py-1 text-right tabular-nums">
                      {i.lowBid != null && i.highBid != null ? `₹${i.lowBid.toFixed(0)} - ₹${i.highBid.toFixed(0)}` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {ideas.ideasError && <p className="text-xs text-amber-600">Keyword Planner ideas are not available: {ideas.ideasError}</p>}
        </div>
      )}
    </div>
  )
}

function AdGroupCard({
  g,
  i,
  d,
  set,
  b,
  canAi,
}: {
  g: DraftAdGroup
  i: number
  d: Draft
  set: Patch
  b: WizardBootstrap
  canAi: boolean
}) {
  const [aiBusy, setAiBusy] = useState(false)
  const [aiNote, setAiNote] = useState<string | null>(null)
  const update = (p: Partial<DraftAdGroup>) => set({ adGroups: d.adGroups.map(x => (x.key === g.key ? { ...x, ...p } : x)) })
  const category = b.categories.find(c => c.id === g.categoryId)

  async function writeAd() {
    setAiBusy(true)
    setAiNote(null)
    const { ok, data } = await postJson('/api/admin/google-ads/manage/ai-copy', {
      kind: 'rsa',
      context: { category: category?.name ?? g.name, keywords: g.keywords.map(k => k.text).slice(0, 15), finalUrl: g.finalUrl, facts: b.facts },
    })
    setAiBusy(false)
    if (!ok) return setAiNote(errorText(data, 'AI could not write this ad'))
    update({
      headlines: data.headlines?.length ? data.headlines : g.headlines,
      descriptions: data.descriptions?.length ? data.descriptions : g.descriptions,
    })
    if (data.dropped) setAiNote(`${data.dropped} AI line(s) were too long or repeated and were left out.`)
  }

  return (
    <div className="rounded-xl border border-border-default p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Ad group name">
            <input className={inputCls} value={g.name} onChange={e => update({ name: e.target.value })} placeholder="e.g. Cordless drills" />
          </Field>
          <AdminSelect
            label="Category (sets the landing page and keyword ideas)"
            value={g.categoryId}
            placeholder="Whole store"
            options={[{ value: '', label: 'Whole store' }, ...b.categories.map(c => ({ value: c.id, label: `${c.name} (${c.products})` }))]}
            onChange={v => {
              const c = b.categories.find(x => x.id === v)
              update({ categoryId: v, finalUrl: c ? `${b.store.baseUrl}/categories/${c.slug}` : b.store.baseUrl, name: g.name || c?.name || '' })
            }}
          />
        </div>
        {d.adGroups.length > 1 && (
          <button type="button" aria-label={`Remove ad group ${i + 1}`} className="p-1.5 text-foreground-muted hover:text-red-500" onClick={() => set({ adGroups: d.adGroups.filter(x => x.key !== g.key) })}>
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Landing page">
          <input className={inputCls} value={g.finalUrl} onChange={e => update({ finalUrl: e.target.value })} />
        </Field>
        {d.strategy === 'MANUAL_CPC' && (
          <Field label="Max CPC (₹)" hint="Empty uses the default max CPC.">
            <input className={inputCls} inputMode="decimal" value={g.cpcBid} onChange={e => update({ cpcBid: e.target.value })} />
          </Field>
        )}
      </div>
      <KeywordPicker g={g} update={update} b={b} d={d} />
      <Field label="Negative keywords for this ad group (one per line)">
        <textarea className={`${inputCls} h-16`} value={g.negatives} onChange={e => update({ negatives: e.target.value })} />
      </Field>
      <TextList
        label="Headline"
        items={g.headlines}
        onChange={v => update({ headlines: v })}
        max={LIMITS.headline}
        min={COUNTS.rsaHeadlines[0]}
        maxItems={COUNTS.rsaHeadlines[1]}
        action={canAi ? <AiButton busy={aiBusy} onClick={writeAd} /> : undefined}
      />
      <TextList label="Description" items={g.descriptions} onChange={v => update({ descriptions: v })} max={LIMITS.description} min={COUNTS.rsaDescriptions[0]} maxItems={COUNTS.rsaDescriptions[1]} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Display path 1 (optional)">
          <LimitedInput value={g.path1} max={LIMITS.path} onChange={v => update({ path1: v })} />
        </Field>
        <Field label="Display path 2 (optional)">
          <LimitedInput value={g.path2} max={LIMITS.path} onChange={v => update({ path2: v })} />
        </Field>
      </div>
      {aiNote && <p className="text-xs text-amber-600">{aiNote}</p>}
    </div>
  )
}

export function SearchAds({ d, set, b, canAi }: { d: Draft; set: Patch; b: WizardBootstrap; canAi: boolean }) {
  return (
    <div className="space-y-4">
      {d.adGroups.map((g, i) => (
        <AdGroupCard key={g.key} g={g} i={i} d={d} set={set} b={b} canAi={canAi} />
      ))}
      <button type="button" className={btnGhost} onClick={() => set({ adGroups: [...d.adGroups, newAdGroup(b.store.baseUrl)] })}>
        <Plus className="w-4 h-4" /> Add ad group
      </button>
      <Field label="Negative keywords for the whole campaign (one per line)" hint="Searches you never want to pay for, e.g. free, second hand, repair.">
        <textarea className={`${inputCls} h-20`} value={d.campaignNegatives} onChange={e => set({ campaignNegatives: e.target.value })} />
      </Field>
    </div>
  )
}

// ── Shopping / Performance Max products ─────────────────────────────────────

export interface LinkState {
  merchantId: string | null
  linked: boolean
  pending: { merchantId: string; status: string }[]
}

export function MerchantLink({ onState }: { onState: (s: LinkState | null) => void }) {
  const [state, setState] = useState<LinkState | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  async function load() {
    const r = await fetch('/api/admin/google-ads/manage/merchant-link', { credentials: 'include' })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) {
      setMessage({ ok: false, text: data.error || 'Could not read the Merchant Center link' })
      onState(null)
      return
    }
    setState(data)
    onState(data)
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function link() {
    setBusy(true)
    setMessage(null)
    const { ok, data } = await postJson('/api/admin/google-ads/manage/merchant-link', {})
    setBusy(false)
    setMessage({ ok, text: ok ? data.message : errorText(data, 'Could not link Merchant Center') })
    if (ok && data.link) {
      setState(data.link)
      onState(data.link)
    }
  }

  return (
    <div className="rounded-lg border border-border-default p-3 text-sm space-y-2">
      {!state && !message && (
        <p className="text-foreground-muted flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Checking the Merchant Center link...
        </p>
      )}
      {state && !state.merchantId && <p className="text-amber-700 dark:text-amber-400">Connect Google Merchant Center for this store first (Integrations), so your products can be advertised.</p>}
      {state?.merchantId && state.linked && (
        <p className="flex items-center gap-2 text-green-700 dark:text-green-400">
          <CheckCircle2 className="w-4 h-4" /> Merchant Center {state.merchantId} is linked.
        </p>
      )}
      {state?.merchantId && !state.linked && (
        <div className="flex flex-wrap items-center gap-3">
          <span>
            Merchant Center {state.merchantId} is not linked to this Google Ads account
            {state.pending.some(p => p.merchantId === state.merchantId) ? ' (a link request is waiting)' : ''}.
          </span>
          <button type="button" className={btnGhost} disabled={busy} onClick={link}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />} Link
          </button>
        </div>
      )}
      {message && <p className={`text-xs ${message.ok ? 'text-green-700 dark:text-green-400' : 'text-red-500'}`}>{message.text}</p>}
    </div>
  )
}

const DIMENSIONS: { value: ListingDimension; label: string }[] = [
  { value: 'ALL', label: 'All products in the feed' },
  { value: 'CATEGORY', label: 'Categories' },
  { value: 'BRAND', label: 'Brands' },
  { value: 'MARGIN', label: 'Margin band (custom label 0)' },
  { value: 'VELOCITY', label: 'Best sellers / slow movers (custom label 1)' },
  { value: 'STOCK', label: 'Stock state (custom label 2)' },
]

export function ProductGroups({ d, set, b }: { d: Draft; set: Patch; b: WizardBootstrap }) {
  const options: { value: string; label: string }[] =
    d.listingDimension === 'CATEGORY'
      ? b.categories.filter(c => c.products > 0).map(c => ({ value: c.id, label: `${c.name} (${c.products})` }))
      : d.listingDimension === 'BRAND'
        ? b.brands.map(x => ({ value: x.name, label: `${x.name} (${x.products})` }))
        : d.listingDimension === 'MARGIN'
          ? Object.entries(b.labels.margin).map(([k, v]) => ({ value: k, label: `${k} (${v})` }))
          : d.listingDimension === 'VELOCITY'
            ? Object.entries(b.labels.velocity).map(([k, v]) => ({ value: k, label: `${k} (${v})` }))
            : d.listingDimension === 'STOCK'
              ? Object.entries(b.labels.stock).map(([k, v]) => ({ value: k, label: `${k} (${v})` }))
              : []
  return (
    <div className="space-y-2">
      <AdminSelect
        label="Products to advertise"
        value={d.listingDimension}
        options={DIMENSIONS}
        onChange={v => set({ listingDimension: v as ListingDimension, listingValues: [] })}
      />
      {d.listingDimension !== 'ALL' && (
        <>
          <p className="text-xs text-foreground-muted">
            Only the ticked groups are advertised; everything else is excluded.
            {d.listingDimension === 'MARGIN' || d.listingDimension === 'VELOCITY' || d.listingDimension === 'STOCK'
              ? ' Labels come from your Merchant feed, so run a Merchant sync first if you have not since this update.'
              : ''}
          </p>
          <div className="grid gap-1 sm:grid-cols-2 max-h-56 overflow-y-auto rounded-lg border border-border-default p-2">
            {options.map(o => (
              <label key={o.value} className="text-sm flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={d.listingValues.includes(o.value)}
                  onChange={e => set({ listingValues: e.target.checked ? [...d.listingValues, o.value] : d.listingValues.filter(x => x !== o.value) })}
                />
                {o.label}
              </label>
            ))}
            {!options.length && <span className="text-xs text-foreground-muted">Nothing to choose from.</span>}
          </div>
        </>
      )}
    </div>
  )
}

export function AssetGroupEditor({ d, set, b, canAi }: { d: Draft; set: Patch; b: WizardBootstrap; canAi: boolean }) {
  const a = d.assetGroup
  const [aiBusy, setAiBusy] = useState(false)
  const [aiNote, setAiNote] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const upd = (p: Partial<Draft['assetGroup']>) => set({ assetGroup: { ...a, ...p } })

  async function write() {
    setAiBusy(true)
    setAiNote(null)
    const cats = b.categories.filter(c => d.listingDimension === 'CATEGORY' && d.listingValues.includes(c.id)).map(c => c.name)
    const { ok, data } = await postJson('/api/admin/google-ads/manage/ai-copy', {
      kind: 'pmax',
      context: { category: cats.join(', ') || null, finalUrl: a.finalUrl, facts: b.facts, brand: d.listingDimension === 'BRAND' ? d.listingValues.slice(0, 3).join(', ') : null },
    })
    setAiBusy(false)
    if (!ok) return setAiNote(errorText(data, 'AI could not write this'))
    upd({
      headlines: data.headlines?.length ? data.headlines : a.headlines,
      longHeadlines: data.longHeadlines?.length ? data.longHeadlines : a.longHeadlines,
      descriptions: data.descriptions?.length ? data.descriptions : a.descriptions,
    })
    if (data.dropped) setAiNote(`${data.dropped} AI line(s) were too long or repeated and were left out.`)
  }

  const [aiImages, setAiImages] = useState<WizardBootstrap['images']>([])
  const images = [...aiImages, ...b.images].filter(i => !filter || i.productName.toLowerCase().includes(filter.toLowerCase())).slice(0, 48)
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Asset group name">
          <input className={inputCls} value={a.name} onChange={e => upd({ name: e.target.value })} />
        </Field>
        <Field label="Final URL">
          <input className={inputCls} value={a.finalUrl} onChange={e => upd({ finalUrl: e.target.value })} />
        </Field>
      </div>
      <div className="space-y-1">
        <label className="text-sm flex items-center gap-2">
          <input type="radio" name="pmax-mode" checked={a.feedOnly} onChange={() => upd({ feedOnly: true })} />
          Product feed only: Google builds the ads from your Merchant Center products
        </label>
        <label className="text-sm flex items-center gap-2">
          <input type="radio" name="pmax-mode" checked={!a.feedOnly} onChange={() => upd({ feedOnly: false })} />
          Add my own headlines, descriptions and images (reaches YouTube, Display and Gmail too)
        </label>
      </div>
      {!a.feedOnly && (
        <>
          <TextList
            label="Headline"
            items={a.headlines}
            onChange={v => upd({ headlines: v })}
            max={LIMITS.headline}
            min={COUNTS.pmaxHeadlines[0]}
            maxItems={COUNTS.pmaxHeadlines[1]}
            action={canAi ? <AiButton busy={aiBusy} onClick={write} /> : undefined}
          />
          <TextList label="Long headline" items={a.longHeadlines} onChange={v => upd({ longHeadlines: v })} max={LIMITS.longHeadline} min={COUNTS.pmaxLongHeadlines[0]} maxItems={COUNTS.pmaxLongHeadlines[1]} />
          <TextList label="Description" items={a.descriptions} onChange={v => upd({ descriptions: v })} max={LIMITS.description} min={COUNTS.pmaxDescriptions[0]} maxItems={COUNTS.pmaxDescriptions[1]} />
          {filled(a.descriptions).length > 0 && !filled(a.descriptions).some(x => adTextLength(x) <= LIMITS.shortDescription) && (
            <p className="text-xs text-red-500">At least one description must be {LIMITS.shortDescription} characters or shorter.</p>
          )}
          <Field label="Business name">
            <LimitedInput value={a.businessName} max={LIMITS.businessName} onChange={v => upd({ businessName: v })} />
          </Field>
          {b.store.logoUrl ? (
            <p className="text-xs text-foreground-muted">Logo: your store logo from Site Controls, fitted to a square.</p>
          ) : (
            <p className="text-xs text-red-500">Your own assets need a logo. Add a store logo in Site Controls, or use the product feed only.</p>
          )}
          <div className="space-y-2">
            <span className="text-xs font-medium text-foreground-secondary">
              Product images ({a.imageIds.length}/5): each is fitted to a 1.91:1 and a 1:1 image on white
            </span>
            <input className={inputCls} value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter by product name" />
        {canAi && a.imageIds.length < 5 && (
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
                    disabled={!on && a.imageIds.length >= 5}
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
          {aiNote && <p className="text-xs text-amber-600">{aiNote}</p>}
        </>
      )}
    </div>
  )
}
