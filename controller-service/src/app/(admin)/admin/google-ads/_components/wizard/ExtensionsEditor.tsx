'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { LIMITS } from '@/lib/google-ads/limits'
import type { ExtensionsSpec, PriceSpec, PromotionSpec, SitelinkSpec, SnippetSpec } from '@/lib/google-ads/campaign-spec'
import { postJson, errorText } from '../ManageContext'
import { AiButton, LimitedInput, inputCls } from './fields'

// Suggested campaign assets from the store's data, each one edited and ticked by the admin before
// it is added. Used by the wizard and by "Add assets" on an existing campaign.

type On<T> = T & { on: boolean }

export interface ExtDraft {
  sitelinks: On<SitelinkSpec>[]
  callouts: On<{ text: string }>[]
  promotions: On<PromotionSpec & { source?: string }>[]
  prices: On<PriceSpec>[]
  snippets: On<SnippetSpec>[]
  notes: string[]
}

export const emptyExtDraft = (): ExtDraft => ({ sitelinks: [], callouts: [], promotions: [], prices: [], snippets: [], notes: [] })

export function toExtensions(d: ExtDraft): ExtensionsSpec {
  const strip = <T extends { on: boolean }>(list: T[]) => list.filter(x => x.on).map(({ on: _on, ...rest }) => rest)
  return {
    sitelinks: strip(d.sitelinks).map(s => ({ ...s, description1: s.description1 || '', description2: s.description2 || '' })),
    callouts: strip(d.callouts).map(c => c.text.trim()).filter(Boolean),
    promotions: strip(d.promotions).map(({ source: _s, ...p }) => p),
    prices: strip(d.prices),
    snippets: strip(d.snippets),
  }
}

/** Suggestions from the store's data as an editable draft (sitelinks, callouts and snippets ticked). */
export async function fetchExtDraft(): Promise<ExtDraft> {
  const r = await fetch('/api/admin/google-ads/manage/assets', { credentials: 'include' })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || 'Could not load suggestions')
  return {
    sitelinks: (d.sitelinks ?? []).map((s: SitelinkSpec) => ({ ...s, on: true })),
    callouts: (d.callouts ?? []).map((t: string) => ({ text: t, on: true })),
    promotions: (d.promotions ?? []).map((p: PromotionSpec) => ({ ...p, on: false })),
    prices: (d.prices ?? []).map((p: PriceSpec) => ({ ...p, on: false })),
    snippets: (d.snippets ?? []).map((x: SnippetSpec) => ({ ...x, on: true })),
    notes: d.notes ?? [],
  }
}

export function useAssetSuggestions(): { draft: ExtDraft | null; setDraft: (d: ExtDraft) => void; error: string | null } {
  const [draft, setDraft] = useState<ExtDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    fetchExtDraft()
      .then(x => live && setDraft(x))
      .catch(e => live && setError(e.message))
    return () => {
      live = false
    }
  }, [])
  return { draft, setDraft, error }
}

const money = (n: number | null | undefined) => (n == null ? '' : `₹${n.toLocaleString('en-IN')}`)

function Group({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">
        {title} <span className="text-foreground-muted font-normal">({count} selected)</span>
      </h3>
      {children}
    </div>
  )
}

export default function ExtensionsEditor({
  draft,
  onChange,
  canAi,
  facts = [],
}: {
  draft: ExtDraft
  onChange: (d: ExtDraft) => void
  canAi: boolean
  facts?: string[]
}) {
  const [aiBusy, setAiBusy] = useState<'sitelinks' | 'callouts' | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const set = <K extends keyof ExtDraft>(k: K, v: ExtDraft[K]) => onChange({ ...draft, [k]: v })

  async function ai(kind: 'sitelinks' | 'callouts') {
    setAiBusy(kind)
    setAiError(null)
    const context =
      kind === 'sitelinks'
        ? { links: draft.sitelinks.map(s => ({ name: s.linkText, url: s.finalUrl })), facts }
        : { facts }
    const { ok, data } = await postJson('/api/admin/google-ads/manage/ai-copy', { kind, context })
    setAiBusy(null)
    if (!ok) return setAiError(errorText(data, 'AI could not write this'))
    if (kind === 'sitelinks') {
      set(
        'sitelinks',
        draft.sitelinks.map((s, i) => {
          const g = data.sitelinks?.[i]
          return g ? { ...s, description1: g.description1 || s.description1, description2: g.description2 || s.description2 } : s
        })
      )
    } else {
      const existing = new Set(draft.callouts.map(c => c.text.toLowerCase()))
      const added = (data.callouts ?? []).filter((t: string) => !existing.has(t.toLowerCase())).map((t: string) => ({ text: t, on: true }))
      set('callouts', [...draft.callouts, ...added].slice(0, 20))
    }
  }

  return (
    <div className="space-y-5">
      {draft.notes.length > 0 && (
        <ul className="text-xs text-foreground-muted list-disc pl-4 space-y-0.5">
          {draft.notes.map(n => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <Group title="Sitelinks to top categories" count={draft.sitelinks.filter(s => s.on).length}>
        {canAi && draft.sitelinks.length > 0 && <AiButton busy={aiBusy === 'sitelinks'} onClick={() => ai('sitelinks')} label="Write descriptions with AI" />}
        {draft.sitelinks.map((s, i) => {
          const upd = (patch: Partial<SitelinkSpec>) => set('sitelinks', draft.sitelinks.map((x, j) => (j === i ? { ...x, ...patch } : x)))
          return (
            <div key={i} className="rounded-lg border border-border-default p-3 space-y-2">
              <label className="flex items-center gap-2 text-xs text-foreground-muted [overflow-wrap:anywhere]">
                <input type="checkbox" checked={s.on} onChange={e => set('sitelinks', draft.sitelinks.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
                {s.finalUrl}
              </label>
              <LimitedInput value={s.linkText} max={LIMITS.sitelinkText} ariaLabel={`Sitelink ${i + 1} text`} onChange={v => upd({ linkText: v })} />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <LimitedInput value={s.description1 ?? ''} max={LIMITS.sitelinkDescription} placeholder="Description line 1 (optional)" onChange={v => upd({ description1: v })} />
                <LimitedInput value={s.description2 ?? ''} max={LIMITS.sitelinkDescription} placeholder="Description line 2" onChange={v => upd({ description2: v })} />
              </div>
            </div>
          )
        })}
        {!draft.sitelinks.length && <p className="text-xs text-foreground-muted">No categories to link to.</p>}
      </Group>

      <Group title="Callouts from store policies" count={draft.callouts.filter(c => c.on).length}>
        {canAi && <AiButton busy={aiBusy === 'callouts'} onClick={() => ai('callouts')} label="Suggest more with AI" />}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {draft.callouts.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="checkbox" aria-label={`Use callout ${i + 1}`} checked={c.on} onChange={e => set('callouts', draft.callouts.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
              <div className="flex-1 min-w-0">
                <LimitedInput value={c.text} max={LIMITS.callout} ariaLabel={`Callout ${i + 1}`} onChange={v => set('callouts', draft.callouts.map((x, j) => (j === i ? { ...x, text: v } : x)))} />
              </div>
            </div>
          ))}
        </div>
      </Group>

      <Group title="Promotions from coupons and bank offers" count={draft.promotions.filter(p => p.on).length}>
        {draft.promotions.map((p, i) => {
          const upd = (patch: Partial<PromotionSpec>) => set('promotions', draft.promotions.map((x, j) => (j === i ? { ...x, ...patch } : x)))
          return (
            <div key={i} className="rounded-lg border border-border-default p-3 space-y-2">
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={p.on} onChange={e => set('promotions', draft.promotions.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
                <span>
                  {p.percentOff ? `${p.percentOff}% off` : `${money(p.amountOff)} off`}
                  {p.code ? ` with code ${p.code}` : ''}
                  {p.endDate ? ` until ${p.endDate}` : ''}
                </span>
                <span className="text-foreground-muted">{p.source}</span>
              </label>
              <LimitedInput value={p.target} max={LIMITS.promotionTarget} ariaLabel={`Promotion ${i + 1} item`} placeholder="What is on offer" onChange={v => upd({ target: v })} />
            </div>
          )
        })}
        {!draft.promotions.length && <p className="text-xs text-foreground-muted">Nothing to promote right now.</p>}
      </Group>

      <Group title="Price list from best sellers" count={draft.prices.filter(p => p.on).length}>
        {draft.prices.map((p, i) => (
          <div key={i} className="rounded-lg border border-border-default p-3 space-y-2">
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={p.on} onChange={e => set('prices', draft.prices.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
              {p.offerings.length} items
            </label>
            {p.offerings.map((o, k) => {
              const updO = (patch: Partial<PriceSpec['offerings'][number]>) =>
                set('prices', draft.prices.map((x, j) => (j === i ? { ...x, offerings: x.offerings.map((y, m) => (m === k ? { ...y, ...patch } : y)) } : x)))
              return (
                <div key={k} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_7rem]">
                  <LimitedInput value={o.header} max={LIMITS.priceHeader} ariaLabel={`Price item ${k + 1} header`} onChange={v => updO({ header: v })} />
                  <LimitedInput value={o.description} max={LIMITS.priceDescription} ariaLabel={`Price item ${k + 1} description`} onChange={v => updO({ description: v })} />
                  <input className={inputCls} aria-label={`Price item ${k + 1} price`} value={String(o.price)} onChange={e => updO({ price: Number(e.target.value) || 0 })} />
                </div>
              )
            })}
          </div>
        ))}
        {!draft.prices.length && <p className="text-xs text-foreground-muted">Not enough recent best sellers for a price list.</p>}
      </Group>

      <Group title="Structured snippets" count={draft.snippets.filter(s => s.on).length}>
        {draft.snippets.map((s, i) => (
          <label key={i} className="flex items-start gap-2 text-xs">
            <input type="checkbox" checked={s.on} onChange={e => set('snippets', draft.snippets.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
            <span>
              <b>{s.header}:</b> {s.values.join(', ')}
            </span>
          </label>
        ))}
        {!draft.snippets.length && <p className="text-xs text-foreground-muted">Needs at least 3 brands or categories.</p>}
      </Group>

      {aiError && <p className="text-xs text-red-500">{aiError}</p>}
    </div>
  )
}

export function SuggestionsLoading({ error }: { error: string | null }) {
  return error ? (
    <p className="text-sm text-red-500">{error}</p>
  ) : (
    <p className="text-sm text-foreground-muted flex items-center gap-2">
      <Loader2 className="w-4 h-4 animate-spin" /> Building suggestions from your store data...
    </p>
  )
}
