'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, MapPin } from 'lucide-react'
import AdminSelect from '@/components/admin/AdminSelect'
import DatePicker from '@/components/ui/DatePicker'
import type { WizardBootstrap } from '@/lib/google-ads/manage-data'
import { DAYS, INDIA, LANGUAGES, STRATEGIES_FOR, type BidStrategy, type CampaignType } from '@/lib/google-ads/campaign-spec'
import { money } from '@/lib/google-ads/format'
import { postJson } from '../ManageContext'
import type { Draft } from './draft'
import { Chip, Field, inputCls } from './fields'

type Patch = (p: Partial<Draft>) => void

const TYPES: { id: CampaignType; label: string; hint: string }[] = [
  { id: 'SEARCH', label: 'Search', hint: 'Text ads on Google search for the keywords you choose.' },
  { id: 'SHOPPING', label: 'Standard Shopping', hint: 'Product listings from your Merchant Center feed.' },
  { id: 'PERFORMANCE_MAX', label: 'Performance Max', hint: 'Your products across Search, Shopping, YouTube, Display and Gmail.' },
]

const STRATEGY_LABEL: Record<BidStrategy, string> = {
  MAXIMIZE_CONVERSIONS: 'Maximise conversions',
  MAXIMIZE_CONVERSION_VALUE: 'Maximise conversion value',
  MANUAL_CPC: 'Manual CPC',
}

export function StepCampaign({ d, set, b }: { d: Draft; set: Patch; b: WizardBootstrap }) {
  const strategies = STRATEGIES_FOR[d.type]
  const today = new Date().toISOString().slice(0, 10)
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        {TYPES.map(t => (
          <button
            key={t.id}
            type="button"
            aria-pressed={d.type === t.id}
            onClick={() => set({ type: t.id, strategy: STRATEGIES_FOR[t.id].includes(d.strategy) ? d.strategy : STRATEGIES_FOR[t.id][0] })}
            className={`rounded-lg border p-3 text-left ${d.type === t.id ? 'border-accent-500 bg-accent-500/5' : 'border-border-default hover:bg-surface-secondary'}`}
          >
            <p className="text-sm font-medium text-foreground">{t.label}</p>
            <p className="text-xs text-foreground-muted mt-1">{t.hint}</p>
          </button>
        ))}
      </div>
      <Field label="Campaign name">
        <input className={inputCls} value={d.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. Power tools - Search" />
      </Field>
      <Field
        label="Daily budget (₹)"
        hint={
          b.budget.revenue30d > 0
            ? `Last 30 days: ${money(b.budget.revenue30d, b.store.currency)} revenue from ${b.budget.orders30d} orders (${money(b.budget.dailyRevenue, b.store.currency)}/day). Suggested: ${money(b.budget.suggestedDaily, b.store.currency)}/day, about 10% of daily revenue.`
            : `No paid orders in the last 30 days. Suggested starting budget: ${money(b.budget.suggestedDaily, b.store.currency)}/day.`
        }
      >
        <input className={inputCls} inputMode="decimal" value={d.dailyBudget} onChange={e => set({ dailyBudget: e.target.value })} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <AdminSelect
          label="Bid strategy"
          value={d.strategy}
          options={strategies.map(s => ({ value: s, label: STRATEGY_LABEL[s] }))}
          onChange={v => set({ strategy: v as BidStrategy })}
        />
        {d.strategy === 'MAXIMIZE_CONVERSIONS' && (
          <Field label="Target CPA (₹, optional)" hint="Average cost per conversion to aim for. Leave empty to let Google maximise conversions.">
            <input className={inputCls} inputMode="decimal" value={d.targetCpa} onChange={e => set({ targetCpa: e.target.value })} />
          </Field>
        )}
        {d.strategy === 'MAXIMIZE_CONVERSION_VALUE' && (
          <Field label="Target ROAS (%, optional)" hint="Conversion value per rupee spent, e.g. 400% = ₹4 of sales per ₹1.">
            <input className={inputCls} inputMode="decimal" value={d.targetRoas} onChange={e => set({ targetRoas: e.target.value })} />
          </Field>
        )}
        {d.strategy === 'MANUAL_CPC' && (
          <Field label="Default max CPC (₹)" hint="Used for every ad group / product group without its own bid.">
            <input className={inputCls} inputMode="decimal" value={d.defaultCpc} onChange={e => set({ defaultCpc: e.target.value })} />
          </Field>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Start date (optional)">
          <DatePicker value={d.startDate} min={today} clearable onChange={v => set({ startDate: v })} placeholder="Today" />
        </Field>
        <Field label="End date (optional)">
          <DatePicker value={d.endDate} min={d.startDate || today} clearable onChange={v => set({ endDate: v })} placeholder="No end date" />
        </Field>
        <AdminSelect
          label="Status when created"
          value={d.status}
          options={[
            { value: 'PAUSED', label: 'Paused (review in Google Ads first)' },
            { value: 'ENABLED', label: 'Enabled (starts serving)' },
          ]}
          onChange={v => set({ status: v as Draft['status'] })}
        />
      </div>
    </div>
  )
}

interface GeoOption {
  id: string
  name: string
  type: string | null
  canonicalName: string | null
}

export function StepTargeting({ d, set, b }: { d: Draft; set: Patch; b: WizardBootstrap }) {
  const [q, setQ] = useState('')
  const [options, setOptions] = useState<GeoOption[]>([])
  const [searching, setSearching] = useState(false)
  const [shipTo, setShipTo] = useState<{ ids: GeoOption[]; unresolved: string[] } | null>(null)
  const [shipBusy, setShipBusy] = useState(false)
  const [geoError, setGeoError] = useState<string | null>(null)
  const loaded = useRef(false)

  async function loadShipTo(apply: boolean) {
    if (!b.shipTo.states.length) return
    setShipBusy(true)
    const { ok, data } = await postJson('/api/admin/google-ads/manage/geo', { names: b.shipTo.states })
    setShipBusy(false)
    if (!ok) return setGeoError(data.error || 'Could not look up the shipping states')
    const res = { ids: data.resolved ?? [], unresolved: data.unresolved ?? [] }
    setShipTo(res)
    if (apply && res.ids.length) set({ locations: res.ids.map((o: GeoOption) => ({ id: o.id, name: o.name })) })
  }

  // Preset to the states we ship to, unless shipping covers all of India.
  useEffect(() => {
    if (loaded.current) return
    loaded.current = true
    if (!b.shipTo.allIndia && !d.locations.length) loadShipTo(true).then(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (q.trim().length < 2) return setOptions([])
    const t = setTimeout(async () => {
      setSearching(true)
      const r = await fetch(`/api/admin/google-ads/manage/geo?q=${encodeURIComponent(q.trim())}`, { credentials: 'include' })
      const data = await r.json().catch(() => ({}))
      setSearching(false)
      if (!r.ok) return setGeoError(data.error || 'Location search failed')
      setOptions(data.options ?? [])
    }, 300)
    return () => clearTimeout(t)
  }, [q])

  const add = (o: { id: string; name: string }) => {
    if (d.locations.some(l => l.id === o.id)) return
    set({ locations: [...d.locations.filter(l => l.id !== INDIA.id || o.id === INDIA.id), o] })
    setQ('')
    setOptions([])
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-foreground-secondary">Locations (people in these places)</span>
          <div className="flex gap-2">
            <button type="button" className="text-xs text-accent-600" onClick={() => set({ locations: [INDIA] })}>
              All of India
            </button>
            {b.shipTo.states.length > 0 && (
              <button type="button" className="text-xs text-accent-600 inline-flex items-center gap-1" disabled={shipBusy} onClick={() => (shipTo ? set({ locations: shipTo.ids.map(o => ({ id: o.id, name: o.name })) }) : loadShipTo(true))}>
                {shipBusy && <Loader2 className="w-3 h-3 animate-spin" />} States we ship to ({b.shipTo.states.length})
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {d.locations.map(l => (
            <Chip key={l.id} label={l.name} onRemove={() => set({ locations: d.locations.filter(x => x.id !== l.id) })} />
          ))}
          {!d.locations.length && !shipBusy && <span className="text-xs text-red-500">Choose at least one location.</span>}
          {shipBusy && <span className="text-xs text-foreground-muted">Looking up the states you ship to...</span>}
        </div>
        {shipTo?.unresolved.length ? <p className="text-xs text-amber-600">Not found in Google: {shipTo.unresolved.join(', ')}</p> : null}
        <div className="relative">
          <MapPin className="absolute left-3 top-2.5 w-4 h-4 text-foreground-muted" />
          <input className={`${inputCls} pl-9`} value={q} onChange={e => setQ(e.target.value)} placeholder="Add a state or city, e.g. Kerala, Pune" aria-label="Search locations" />
          {(searching || options.length > 0) && (
            <ul className="absolute z-10 mt-1 w-full rounded-lg border border-border-default bg-surface-elevated shadow-lg max-h-56 overflow-y-auto">
              {searching && <li className="px-3 py-2 text-xs text-foreground-muted">Searching...</li>}
              {options.map(o => (
                <li key={o.id}>
                  <button type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-surface-secondary" onClick={() => add({ id: o.id, name: o.name })}>
                    {o.canonicalName || o.name} <span className="text-xs text-foreground-muted">{o.type}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {geoError && <p className="text-xs text-red-500">{geoError}</p>}
      </div>

      {d.type !== 'SHOPPING' && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-foreground-secondary">Languages</span>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {LANGUAGES.map(l => (
              <label key={l.id} className="text-sm flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={d.languages.includes(l.id)}
                  onChange={e => set({ languages: e.target.checked ? [...d.languages, l.id] : d.languages.filter(x => x !== l.id) })}
                />
                {l.name}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <label className="text-sm flex items-center gap-2">
          <input type="checkbox" checked={d.scheduleOn} onChange={e => set({ scheduleOn: e.target.checked })} />
          Only show ads at certain times
        </label>
        {d.scheduleOn && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-wrap gap-2">
              {DAYS.map(day => (
                <label key={day} className="text-xs flex items-center gap-1">
                  <input type="checkbox" checked={d.days.includes(day)} onChange={e => set({ days: e.target.checked ? [...d.days, day] : d.days.filter(x => x !== day) })} />
                  {day.slice(0, 3).toLowerCase()}
                </label>
              ))}
            </div>
            <AdminSelect
              sm
              label="From"
              value={String(d.startHour)}
              options={Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, '0')}:00` }))}
              onChange={v => set({ startHour: Number(v) })}
            />
            <AdminSelect
              sm
              label="Until"
              value={String(d.endHour)}
              options={Array.from({ length: 24 }, (_, h) => ({ value: String(h + 1), label: `${String(h + 1).padStart(2, '0')}:00` }))}
              onChange={v => set({ endHour: Number(v) })}
            />
          </div>
        )}
      </div>

      {d.type !== 'PERFORMANCE_MAX' && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-foreground-secondary">Networks</span>
          <label className="text-sm flex items-center gap-2">
            <input type="checkbox" checked={d.searchPartners} onChange={e => set({ searchPartners: e.target.checked })} />
            Google search partners
          </label>
          {d.type === 'SEARCH' && (
            <label className="text-sm flex items-center gap-2">
              <input type="checkbox" checked={d.display} onChange={e => set({ display: e.target.checked })} />
              Display Network (show text ads on websites too)
            </label>
          )}
        </div>
      )}

      {d.type !== 'PERFORMANCE_MAX' && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-foreground-secondary">Device bid adjustments (%, optional; -100 stops ads on that device)</span>
          <div className="grid gap-2 grid-cols-3">
            {(['mobile', 'desktop', 'tablet'] as const).map(k => (
              <Field key={k} label={k[0].toUpperCase() + k.slice(1)}>
                <input className={inputCls} inputMode="numeric" value={d.devices[k]} placeholder="0" onChange={e => set({ devices: { ...d.devices, [k]: e.target.value } })} />
              </Field>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
