'use client'

import { useEffect, useState } from 'react'
import AdminTableSkeleton from '@/components/admin/AdminTableSkeleton'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { api, btnPrimary, inputCls } from '@/components/admin/kit/core'
import { useActionToast } from '@/components/admin/kit/toast'
import { PRESETS, presetSpec, withDedicatedDb } from '@/lib/compute/presets'
import { monthlyTotal, quoteSpec } from '@controller/lib/compute/pricing'
import type { Catalog, ComputeSpec, PresetKey, PriceRow, PricingSettings } from '@/lib/compute/spec'

type PlanRow = {
  slug: string
  name: string
  tier: number
  monthlyPriceInr: number
  infraMargin: number
  rdsMargin: number | null
  minPreset: PresetKey | null
  defaultPreset: PresetKey | null
}
type PlanPrice = { infraInrMonth: number; totalInrMonth: number } | null

type View = {
  prices: PriceRow[]
  settings: PricingSettings
  plans: PlanRow[]
  presets: { key: string; label: string; awsInrMonth: number | null; plans: Record<string, PlanPrice> }[]
}

const ctl = `${inputCls} h-control py-0`
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

const SETTINGS: { key: keyof PricingSettings; label: string; step: string }[] = [
  { key: 'usdInr', label: 'USD → INR', step: '0.01' },
  { key: 'gstRate', label: 'GST rate', step: '0.01' },
  { key: 'platformShareUsd', label: 'Platform share per store (USD/month)', step: '0.5' },
  { key: 'rootVolumeGb', label: 'Server disk (GB)', step: '1' },
  { key: 'poolCapacity', label: 'Starter stores per shared server', step: '1' },
  { key: 'sharedDbCapacity', label: 'Starter stores per shared database', step: '1' },
  { key: 'sharedDbStorageGb', label: 'Starter database storage (GB)', step: '1' },
  { key: 'sharedDbMaxConnections', label: 'Shared database connections', step: '10' },
  { key: 'minPrepayDays', label: 'Days of servers paid upfront', step: '1' },
  { key: 'graceDays', label: 'Grace days on a negative wallet', step: '1' },
  { key: 'ipv4UsdHour', label: 'IPv4 (USD/hour)', step: '0.0001' },
  { key: 'ebsGp3UsdGbMonth', label: 'EBS gp3 (USD/GB-month)', step: '0.001' },
  { key: 'snapshotUsdGbMonth', label: 'Snapshots (USD/GB-month)', step: '0.001' },
  { key: 's3UsdGbMonth', label: 'S3 (USD/GB-month)', step: '0.001' },
]

export default function ComputePricingClient() {
  const canWrite = useCanWrite('ecom_billing:write')
  const toast = useActionToast()
  const [view, setView] = useState<View | null>(null)
  const [settings, setSettings] = useState<Record<string, string>>({})

  const load = (v: View) => {
    setView(v)
    setSettings(Object.fromEntries(SETTINGS.map(s => [s.key, String(v.settings[s.key])])))
  }

  useEffect(() => {
    api<View>('/api/admin/ecom/compute-pricing').then(({ ok, data }) => ok && load(data))
  }, [])

  async function save(json: unknown) {
    const { ok, data } = await api<View & { error?: string }>('/api/admin/ecom/compute-pricing', { method: 'PATCH', json })
    if (!ok) return toast.result({ ok: false, text: data.error || 'Could not save' })
    load(data)
    toast.result({ ok: true, text: 'Saved' })
  }

  if (!view) return <PricingSkeleton />

  return (
    <div className="space-y-6">
      <MarginsSection view={view} editable={canWrite} save={save} />

      <section className="overflow-x-auto rounded-xl border border-border-default bg-surface-elevated">
        <table className="w-full text-sm">
          <thead className="bg-surface-secondary text-foreground-muted">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Size</th>
              <th className="px-4 py-3 text-right font-medium">AWS cost / month</th>
              {view.plans.map(pl => (
                <th key={pl.slug} className="px-4 py-3 text-right font-medium">{pl.name} / month</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {view.presets.map(p => (
              <tr key={p.key}>
                <td className="px-4 py-2.5 text-foreground">{p.label}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{p.awsInrMonth == null ? '—' : inr(p.awsInrMonth)}</td>
                {view.plans.map(pl => {
                  const price = p.plans[pl.slug]
                  return (
                    <td key={pl.slug} className="px-4 py-2.5 text-right tabular-nums">
                      {price ? (
                        <>
                          <span className="text-foreground">{inr(price.totalInrMonth)}</span>
                          <span className="block text-xs text-foreground-muted">infra {inr(price.infraInrMonth)} + GST + fee</span>
                        </>
                      ) : (
                        <span className="text-foreground-muted">—</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="overflow-x-auto rounded-xl border border-border-default bg-surface-elevated">
        <table className="w-full text-sm">
          <thead className="bg-surface-secondary text-foreground-muted">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Plan</th>
              <th className="px-4 py-3 text-left font-medium">Minimum size</th>
              <th className="px-4 py-3 text-right font-medium">Plan fee / month (incl. GST)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {view.plans.map(p => (
              <tr key={p.slug}>
                <td className="px-4 py-2.5 text-foreground">
                  {p.name}
                  <span className="block font-mono text-xs text-foreground-muted">{p.slug}</span>
                </td>
                <td className="px-4 py-2.5 text-foreground-muted">{p.minPreset ?? '—'}</td>
                <td className="px-4 py-2.5 text-right">
                  <FeeCell value={p.monthlyPriceInr} editable={canWrite} onSave={v => save({ plan: p.slug, monthlyPriceInr: v })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-xl border border-border-default bg-surface-elevated p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SETTINGS.map(s => (
            <label key={s.key} className="block">
              <span className="mb-1 block text-xs text-foreground-muted">{s.label}</span>
              <input
                className={ctl}
                type="number"
                step={s.step}
                disabled={!canWrite}
                value={settings[s.key] ?? ''}
                onChange={e => setSettings({ ...settings, [s.key]: e.target.value })}
              />
            </label>
          ))}
        </div>
        {canWrite && (
          <button
            type="button"
            className={`${btnPrimary} mt-4 h-control py-0`}
            onClick={() => save({ settings: Object.fromEntries(Object.entries(settings).map(([k, v]) => [k, Number(v)])) })}
          >
            Save settings
          </button>
        )}
      </section>

      <section className="overflow-x-auto rounded-xl border border-border-default bg-surface-elevated">
        <table className="w-full text-sm">
          <thead className="bg-surface-secondary text-foreground-muted">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Resource</th>
              <th className="px-4 py-3 text-right font-medium">USD / hour</th>
              <th className="px-4 py-3 text-right font-medium">Multi-AZ / hour</th>
              <th className="px-4 py-3 text-right font-medium">USD / GB-month</th>
              <th className="px-4 py-3 text-right font-medium">Multi-AZ / GB-month</th>
              <th className="px-4 py-3 text-center font-medium">Offered</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {view.prices.map(p => (
              <tr key={p.code} className={p.sellable ? '' : 'opacity-60'}>
                <td className="px-4 py-2.5 text-foreground">
                  {p.label}
                  <span className="block font-mono text-xs text-foreground-muted">{p.code}</span>
                </td>
                {(['usdHourly', 'usdHourlyMultiAz', 'usdGbMonth', 'usdGbMonthMultiAz'] as const).map(f => (
                  <td key={f} className="px-4 py-2.5 text-right">
                    {p[f] == null ? (
                      <span className="text-foreground-muted">—</span>
                    ) : (
                      <UsdCell
                        value={p[f] as number}
                        editable={canWrite}
                        onSave={v => save({ code: p.code, [f.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)]: v })}
                      />
                    )}
                  </td>
                ))}
                <td className="px-4 py-2.5 text-center">
                  <input type="checkbox" aria-label="Offered" checked={p.sellable} disabled={!canWrite} onChange={e => save({ code: p.code, sellable: e.target.checked })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function UsdCell({ value, editable, onSave }: { value: number; editable: boolean; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value))
  useEffect(() => setV(String(value)), [value])
  if (!editable) return <span className="tabular-nums">${value}</span>
  const commit = () => {
    const n = Number(v)
    if (Number.isFinite(n) && n >= 0 && n !== value) onSave(n)
    else setV(String(value))
  }
  return (
    <input
      className={`${ctl} w-28 text-right tabular-nums`}
      type="number"
      min="0"
      step="0.0001"
      value={v}
      onChange={e => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={e => e.key === 'Enter' && commit()}
    />
  )
}

function FeeCell({ value, editable, onSave }: { value: number; editable: boolean; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value))
  useEffect(() => setV(String(value)), [value])
  if (!editable) return <span className="tabular-nums">{inr(value)}</span>
  const commit = () => {
    const n = Number(v)
    if (v.trim() !== '' && Number.isFinite(n) && n >= 0 && n !== value) onSave(n)
    else setV(String(value))
  }
  return (
    <input
      className={`${ctl} w-28 text-right tabular-nums`}
      type="number"
      min="0"
      step="1"
      aria-label="Plan fee per month"
      value={v}
      onChange={e => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={e => e.key === 'Enter' && commit()}
    />
  )
}

// Margins are fractions (0.2) in the API and percents (20) on screen.
const toPct = (m: number | null) => (m == null ? '' : String(Math.round(m * 1000) / 10))
const fromPct = (v: string) => (v.trim() === '' ? null : Number(v) / 100)

/**
 * The global default margin and each plan's two margins (own server, with RDS), each with the monthly price
 * of an example size at the typed (not yet saved) margin.
 */
function MarginsSection({ view, editable, save }: { view: View; editable: boolean; save: (json: unknown) => void }) {
  const [globalPct, setGlobalPct] = useState(toPct(view.settings.margin))
  const [drafts, setDrafts] = useState<Record<string, { infra: string; rds: string }>>({})
  useEffect(() => {
    setGlobalPct(toPct(view.settings.margin))
    setDrafts(Object.fromEntries(view.plans.map(p => [p.slug, { infra: toPct(p.infraMargin), rds: toPct(p.rdsMargin) }])))
  }, [view])

  const catalog: Catalog = { prices: view.prices, settings: { ...view.settings, margin: fromPct(globalPct) ?? view.settings.margin } }
  const priceOf = (spec: ComputeSpec, margins: { infraMargin?: number; rdsMargin?: number | null }, fee: number) => {
    try {
      return inr(monthlyTotal(quoteSpec(spec, catalog, margins), fee, catalog.settings.gstRate).total)
    } catch {
      return '—'
    }
  }
  const valid = (v: string, blankOk: boolean) => (v.trim() === '' ? blankOk : Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 300)
  const exampleOf = (p: PlanRow) => (p.minPreset ?? p.defaultPreset ?? 'small') as PresetKey
  const smallOnServer = presetSpec('small')

  return (
    <section className="rounded-xl border border-border-default bg-surface-elevated p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">Margins</h2>
      <p className="mt-0.5 text-xs text-foreground-muted">
        Markup on the AWS cost of a store&apos;s whole infrastructure. Its plan&apos;s server margin applies with the database on its own
        server, the RDS margin with RDS (blank: the server margin). Examples are the monthly price with GST and the plan fee.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 border-b border-border-default pb-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="min-w-0">
          <div className="text-sm text-foreground">Default margin</div>
          <div className="text-xs text-foreground-muted">For plans without a margin of their own</div>
        </div>
        <MarginField
          label="All plans"
          value={globalPct}
          editable={editable}
          invalid={!valid(globalPct, false)}
          onChange={setGlobalPct}
          onCommit={() => {
            const m = fromPct(globalPct)
            if (m == null || !valid(globalPct, false) || m > 3) return setGlobalPct(toPct(view.settings.margin))
            if (m !== view.settings.margin) save({ settings: { margin: m } })
          }}
          example={`Small, on its own server: ${priceOf(smallOnServer, {}, 0)}/mo before a plan fee`}
        />
      </div>

      <div className="divide-y divide-border-default">
        {view.plans.map(p => {
          const d = drafts[p.slug] ?? { infra: toPct(p.infraMargin), rds: toPct(p.rdsMargin) }
          const set = (k: 'infra' | 'rds', v: string) => setDrafts({ ...drafts, [p.slug]: { ...d, [k]: v } })
          const margins = { infraMargin: fromPct(d.infra) ?? p.infraMargin, rdsMargin: valid(d.rds, true) ? fromPct(d.rds) : p.rdsMargin }
          const key = exampleOf(p)
          const label = PRESETS[key]?.label ?? key
          const onServer = presetSpec(key)
          const withRds = withDedicatedDb(presetSpec(key), key)
          return (
            <div key={p.slug} className="grid grid-cols-1 gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <div className="min-w-0">
                <div className="text-sm text-foreground">{p.name}</div>
                <div className="font-mono text-xs text-foreground-muted">{p.slug}</div>
              </div>
              <MarginField
                label="On its own server"
                value={d.infra}
                editable={editable}
                invalid={!valid(d.infra, false)}
                onChange={v => set('infra', v)}
                onCommit={() => {
                  const m = fromPct(d.infra)
                  if (m == null || !valid(d.infra, false)) return set('infra', toPct(p.infraMargin))
                  if (m !== p.infraMargin) save({ plan: p.slug, infraMargin: m })
                }}
                example={`${label}: ${priceOf(onServer, margins, p.monthlyPriceInr)}/mo`}
              />
              <MarginField
                label="With RDS"
                value={d.rds}
                placeholder={d.infra || '0'}
                editable={editable}
                invalid={!valid(d.rds, true)}
                onChange={v => set('rds', v)}
                onCommit={() => {
                  if (!valid(d.rds, true)) return set('rds', toPct(p.rdsMargin))
                  const m = fromPct(d.rds)
                  if (m !== p.rdsMargin) save({ plan: p.slug, rdsMargin: m })
                }}
                example={`${label} with RDS: ${priceOf(withRds, margins, p.monthlyPriceInr)}/mo`}
              />
            </div>
          )
        })}
      </div>
    </section>
  )
}

function MarginField(props: {
  label: string
  value: string
  placeholder?: string
  editable: boolean
  invalid: boolean
  example: string
  onChange: (v: string) => void
  onCommit: () => void
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs text-foreground-muted">{props.label}</span>
      <span className="flex items-center gap-2">
        {props.editable ? (
          <input
            className={`${ctl} w-24 text-right tabular-nums ${props.invalid ? 'border-red-400' : ''}`}
            type="number"
            min="0"
            max="300"
            step="1"
            inputMode="decimal"
            placeholder={props.placeholder}
            aria-invalid={props.invalid}
            value={props.value}
            onChange={e => props.onChange(e.target.value)}
            onBlur={props.onCommit}
            onKeyDown={e => e.key === 'Enter' && props.onCommit()}
          />
        ) : (
          <span className="tabular-nums text-foreground">{props.value || props.placeholder || '0'}</span>
        )}
        <span className="text-sm text-foreground-muted">%</span>
      </span>
      <span className="mt-1 block break-words text-xs text-foreground-secondary">{props.example}</span>
    </label>
  )
}

const bar = 'bg-surface-secondary rounded'

// Margins card, then the size and price tables, while the pricing loads.
function PricingSkeleton() {
  return (
    <div className="space-y-6 animate-fade-in" aria-busy="true" aria-label="Loading server pricing">
      <div className="bg-surface-elevated rounded-lg border border-border-default p-4 sm:p-6 animate-pulse">
        <div className={`h-4 w-24 mb-2 ${bar}`} />
        <div className={`h-3 w-3/4 mb-6 ${bar} opacity-60`} />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ animationDelay: `${i * 50}ms` }}>
              <div className={`h-3 w-28 mb-2 ${bar}`} />
              <div className={`h-control w-full ${bar}`} />
            </div>
          ))}
        </div>
      </div>
      <AdminTableSkeleton rows={6} cols={6} />
      <AdminTableSkeleton rows={4} cols={3} />
    </div>
  )
}
