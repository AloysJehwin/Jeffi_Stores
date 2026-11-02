'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChoiceCards, Segmented, fieldCls } from '../_ui'
import { BASIC_PRESET, DEDICATED_PRESETS, PRESETS, TRAFFIC_BANDS, presetOf, presetSpec, recommendedPresetKey, withHighAvailability } from '@/lib/compute/presets'
import { monthlyTotal, quoteSpec, type Quote } from '@controller/lib/compute/pricing'
import { LIMITS, planCompatibilityError, smallestFittingNode, validateSpec, type Validation } from '@/lib/compute/validate'
import { activeServices, cloneSpec, type Catalog, type ComputeSpec, type PodSize, type PresetKey, type ServiceName } from '@/lib/compute/spec'

export interface ComputePlan {
  slug: string
  name: string
  monthlyPriceInr: number
  defaultPreset: PresetKey | null
  minPlacement: 'pool' | 'dedicated'
  advanced: boolean
  minPreset?: PresetKey
  infraMargin?: number
}

export interface ComputeChoice {
  spec: ComputeSpec
  quote: Quote | null
  total: ReturnType<typeof monthlyTotal> | null
  valid: boolean
  preset: PresetKey | 'custom'
  planSlug: string
  visitorsPerMonth: number
}

const SERVICE_LABEL: Record<ServiceName, string> = {
  storefront: 'Storefront',
  admin: 'Admin panel',
  business: 'Business portal',
  messaging: 'Messaging',
  documents: 'Invoices & documents',
}
const SIZE_LABEL: Record<PodSize, string> = { S: 'Small', M: 'Medium', L: 'Large' }

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
const fmtVisitors = (n: number) => n >= 1_000_000 ? `${n / 1_000_000}M` : n >= 1_000 ? `${n / 1_000}k` : `${n}`
const selectCls = `w-full rounded-xl border bg-surface px-3 py-2 text-sm text-foreground ${fieldCls}`

/**
 * Picks a plan and server size for a store. Owners pick a plan card (price shown "from" the plan's floor),
 * then a traffic estimate on non-basic plans, which drives a recommended size. Customise exposes every knob.
 */
export function ComputeConfigurator({
  planSlug,
  value,
  onChange,
  current,
  planFeeInr,
  onPlanChange,
}: {
  planSlug: string
  value: ComputeSpec | null
  onChange: (choice: ComputeChoice) => void
  /** The running spec, when resizing an existing store (storage can only grow). */
  current?: ComputeSpec | null
  /** Shown in the total; defaults to the plan's monthly fee (0 for new sign-ups). */
  planFeeInr?: number
  /** Caller controls planSlug (onboard switches the plan here instead of a separate step). */
  onPlanChange?: (slug: string) => void
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [plans, setPlans] = useState<ComputePlan[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [custom, setCustom] = useState(false)
  const [capacityError, setCapacityError] = useState<string | null>(null)
  const [visitorIdx, setVisitorIdx] = useState(2) // 5k default

  useEffect(() => {
    fetch('/api/ecom/compute/catalog')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(d => {
        setCatalog(d.catalog)
        setPlans(d.plans)
      })
      .catch(() => setLoadError('Could not load server prices. Refresh to try again.'))
  }, [])

  const plan = plans.find(p => p.slug === planSlug) ?? null
  const isBasic = plan?.minPreset === 'basic'
  const fallback = plan?.defaultPreset ?? (plan?.minPreset === 'basic' ? 'basic' : plan?.minPlacement === 'pool' ? 'shared' : (plan?.minPreset ?? 'small'))

  const visitorsPerMonth = TRAFFIC_BANDS[visitorIdx] ?? 5_000

  const evaluate = (spec: ComputeSpec, slug: string): ComputeChoice | null => {
    if (!catalog) return null
    const p = plans.find(x => x.slug === slug) ?? plan
    if (!p) return null
    const validation: Validation = validateSpec(spec, catalog, p, { current })
    let quote: Quote | null = null
    try {
      quote = quoteSpec(spec, catalog, { infraMargin: p.infraMargin })
    } catch {
      validation.ok = false
    }
    const fee = planFeeInr ?? p.monthlyPriceInr
    return {
      spec, quote,
      total: quote ? monthlyTotal(quote, fee, catalog.settings.gstRate) : null,
      valid: validation.ok, preset: presetOf(spec), planSlug: slug, visitorsPerMonth,
    }
  }

  // A spec the plan doesn't allow (a new plan picked) starts again from that plan's default size.
  useEffect(() => {
    if (!catalog || !plan) return
    const spec = value && !planCompatibilityError(value, plan) ? value : presetSpec(fallback as PresetKey)
    const c = evaluate(spec, planSlug)
    if (c) onChange(c)
    if (presetOf(spec) === 'custom') setCustom(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, planSlug])

  const spec = value
  const choice = useMemo(() => (spec ? evaluate(spec, planSlug) : null), [spec, catalog, plan, planFeeInr, visitorIdx]) // eslint-disable-line react-hooks/exhaustive-deps
  const validation = useMemo(() => (spec && catalog && plan ? validateSpec(spec, catalog, plan, { current }) : null), [spec, catalog, plan, current])

  // Server capacity (the vCPU quota) is only known to the server.
  useEffect(() => {
    if (!spec || !validation?.ok) return setCapacityError(null)
    const t = setTimeout(() => {
      fetch('/api/ecom/compute/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planSlug, spec }) })
        .then(r => (r.ok ? r.json() : null))
        .then(d => setCapacityError(d?.capacityError ?? null))
        .catch(() => setCapacityError(null))
    }, 600)
    return () => clearTimeout(t)
  }, [spec, validation?.ok, planSlug])

  if (loadError) return <p className="text-sm text-red-600">{loadError}</p>
  if (!catalog || !plan || !spec) return <p className="text-sm text-foreground-muted">Loading server prices…</p>

  const set = (next: ComputeSpec) => {
    const c = evaluate(next, planSlug)
    if (c) onChange(c)
  }
  const edit = (fn: (s: ComputeSpec) => void) => {
    const next = cloneSpec(spec)
    fn(next)
    set(next)
  }
  const preset = presetOf(spec)
  const ha = spec.node.count > 1 && spec.db.multiAz
  const priceFor = (key: PresetKey, p: ComputePlan) => quoteSpec(presetSpec(key), catalog, { infraMargin: p.infraMargin }).inrMonth
  const planFloorPrice = (p: ComputePlan) => {
    const k = (p.minPreset ?? p.defaultPreset ?? (p.minPlacement === 'pool' ? 'shared' : 'small')) as PresetKey
    const base = quoteSpec(presetSpec(k), catalog, { infraMargin: p.infraMargin })
    return monthlyTotal(base, p.monthlyPriceInr, catalog.settings.gstRate).total
  }
  const ec2 = catalog.prices.filter(p => p.kind === 'ec2' && p.sellable)
  const rds = catalog.prices.filter(p => p.kind === 'rds' && p.sellable)
  const fit = validation?.fit
  const bigger = validation && !validation.ok && fit && spec.node.placement === 'dedicated' ? smallestFittingNode(spec, catalog, planSlug) : null
  const recKey = plan.minPreset !== 'basic' ? recommendedPresetKey(planSlug, visitorsPerMonth, plan) : null

  return (
    <div className="space-y-5">
      {/* ── Plan cards ── */}
      {plans.length > 0 && (
        <ChoiceCards<string>
          ariaLabel="Plan"
          columns="grid-cols-2 xl:grid-cols-4"
          cardClassName="bg-surface-elevated p-4"
          value={planSlug}
          onChange={s => onPlanChange?.(s)}
          options={plans.map(p => ({
            value: p.slug,
            label: p.name,
            content: (
              <>
                <div className="pr-6 font-semibold text-foreground">{p.name}</div>
                <div className="mt-1 text-lg font-bold text-foreground">from {inr(planFloorPrice(p))}<span className="text-xs font-normal text-foreground-muted">/mo</span></div>
                <div className="mt-1 text-xs text-foreground-secondary">Incl. GST · servers &amp; plan in one subscription</div>
              </>
            ),
          }))}
        />
      )}

      {/* ── Basic: fixed summary ── */}
      {isBasic ? (
        <div className="rounded-2xl border border-border-default bg-surface-elevated p-4">
          <div className="font-semibold text-foreground">{PRESETS.basic.label}</div>
          <p className="mt-1 text-sm text-foreground-secondary">{PRESETS.basic.blurb}</p>
          <p className="mt-2 text-sm text-foreground">{inr(priceFor('basic', plan))}/mo + GST for servers</p>
        </div>
      ) : plan.minPlacement === 'pool' ? (
        <div className="rounded-2xl border border-border-default bg-surface-elevated p-4">
          <div className="font-semibold text-foreground">{PRESETS.shared.label}</div>
          <p className="mt-1 text-sm text-foreground-secondary">{PRESETS.shared.blurb}</p>
          <p className="mt-2 text-sm text-foreground">{inr(priceFor('shared', plan))}/mo for servers</p>
        </div>
      ) : (
        <>
          {/* ── Visitors slider ── */}
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <label htmlFor="visitors-range" className="text-sm font-medium text-foreground">Visitors per month</label>
              <span className="text-sm font-semibold text-foreground">{fmtVisitors(visitorsPerMonth)}</span>
            </div>
            <input
              id="visitors-range"
              type="range"
              min={0}
              max={TRAFFIC_BANDS.length - 1}
              step={1}
              value={visitorIdx}
              onChange={e => setVisitorIdx(Number(e.target.value))}
              className="w-full accent-foreground"
            />
            <div className="mt-1 flex justify-between text-[10px] text-foreground-muted">
              {TRAFFIC_BANDS.map((v, i) => <span key={i} className={i === visitorIdx ? 'text-foreground font-semibold' : ''}>{fmtVisitors(v)}</span>)}
            </div>
            <p className="mt-2 text-xs text-foreground-muted">Recommended server size follows your traffic — change it any time.</p>
          </div>

          {/* ── Size cards ── */}
          <ChoiceCards<PresetKey>
            ariaLabel="Server size"
            columns="grid-cols-2 xl:grid-cols-4"
            cardClassName="bg-surface-elevated p-4"
            value={custom ? null : preset === 'custom' ? null : preset}
            onChange={k => {
              setCustom(false)
              set(ha ? withHighAvailability(presetSpec(k)) : presetSpec(k))
            }}
            options={DEDICATED_PRESETS.map(k => ({
              value: k,
              label: PRESETS[k].label,
              content: (
                <>
                  <div className="flex items-center justify-between pr-6">
                    <div className="font-semibold text-foreground">{PRESETS[k].label}</div>
                    {recKey === k && <span className="ml-1 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold org-sage org-sage-text">Recommended</span>}
                  </div>
                  <div className="mt-1 text-lg font-bold text-foreground">{inr(priceFor(k, plan))}<span className="text-xs font-normal text-foreground-muted">/mo</span></div>
                  <div className="mt-1 text-xs text-foreground-secondary">{PRESETS[k].blurb}</div>
                </>
              ),
            }))}
          />
          <label className="flex items-start gap-3 text-sm text-foreground">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={ha}
              onChange={e => {
                const base = preset !== 'custom' ? presetSpec(preset) : spec
                if (e.target.checked) set(withHighAvailability(base))
                else edit(s => {
                  s.node.count = 1
                  s.db.multiAz = false
                })
              }}
            />
            <span>
              High availability
              <span className="block text-xs text-foreground-muted">A second server and a standby database in another zone, so one failing never stops the store.</span>
            </span>
          </label>
          {/* ── Database: node (included) vs dedicated RDS ── */}
          <div>
            <div className="mb-1 text-sm font-medium text-foreground">Database</div>
            <Segmented<'node' | 'dedicated'>
              ariaLabel="Database"
              size="sm"
              value={spec.db.mode === 'dedicated' ? 'dedicated' : 'node'}
              onChange={mode => edit(s => {
                if (mode === 'dedicated') {
                  s.db = { mode: 'dedicated', class: s.db.class ?? 'db.t4g.micro', storageGb: s.db.storageGb, multiAz: s.db.multiAz }
                } else {
                  s.db = { mode: 'node', class: null, storageGb: s.db.storageGb, multiAz: false }
                }
              })}
              options={[
                { value: 'node', label: 'On your server (included)' },
                { value: 'dedicated', label: 'Dedicated database (RDS)' },
              ]}
            />
            <p className="mt-1 text-xs text-foreground-muted">
              {spec.db.mode === 'dedicated'
                ? 'A managed PostgreSQL server, separate from your app server.'
                : 'PostgreSQL runs on your own server — nightly backups to S3.'}
            </p>
          </div>
          {plan.advanced && (
            <Segmented<'preset' | 'custom'>
              ariaLabel="Settings"
              size="sm"
              value={custom ? 'custom' : 'preset'}
              onChange={v => setCustom(v === 'custom')}
              options={[{ value: 'preset', label: 'Sizes' }, { value: 'custom', label: 'Customise' }]}
            />
          )}
        </>
      )}

      {custom && spec.node.placement === 'dedicated' && !isBasic && (
        <div className="space-y-4 rounded-2xl border border-border-default bg-surface-elevated p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-foreground-secondary">Server</span>
              <select className={selectCls} value={spec.node.type ?? ''} onChange={e => edit(s => void (s.node.type = e.target.value))}>
                {ec2.map(p => <option key={p.code} value={p.code.slice(4)}>{p.label}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-foreground-secondary">Servers</span>
              <select className={selectCls} value={spec.node.count} onChange={e => edit(s => void (s.node.count = Number(e.target.value)))}>
                {Array.from({ length: LIMITS.maxNodes }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-foreground-secondary">Database</span>
              {spec.db.mode === 'dedicated' ? (
                <select className={selectCls} value={spec.db.class ?? ''} onChange={e => edit(s => void (s.db.class = e.target.value))}>
                  {rds.map(p => <option key={p.code} value={p.code.slice(4)}>{p.label}</option>)}
                </select>
              ) : (
                <div className="rounded-xl border border-border-default bg-surface px-3 py-2 text-sm text-foreground-secondary">On your server (included)</div>
              )}
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-foreground-secondary">{spec.db.mode === 'dedicated' ? 'Database storage (GB)' : 'Database disk (GB)'}</span>
              <input
                type="number"
                className={selectCls}
                min={current && current.db.storageGb && current.db.mode === spec.db.mode ? current.db.storageGb : LIMITS.minStorageGb}
                max={LIMITS.maxStorageGb}
                step={10}
                value={spec.db.storageGb}
                onChange={e => edit(s => void (s.db.storageGb = Math.round(Number(e.target.value) || 0)))}
              />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block text-foreground-secondary">Object storage, S3 (GB)</span>
              <input
                type="number"
                className={selectCls}
                min={Math.max(10, current?.storage?.s3Gb ?? 10)}
                step={10}
                value={spec.storage?.s3Gb ?? 10}
                onChange={e => edit(s => {
                  const v = Math.round(Number(e.target.value) || 0)
                  s.storage = { s3Gb: Math.max(10, v) }
                })}
              />
            </label>
          </div>
          {spec.db.mode === 'dedicated' && (
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={spec.db.multiAz} onChange={e => edit(s => void (s.db.multiAz = e.target.checked))} />
              Standby database in a second zone
            </label>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-foreground-muted">
                  <th className="py-1 pr-3 font-medium">Service</th>
                  <th className="py-1 pr-3 font-medium">Copies</th>
                  <th className="py-1 pr-3 font-medium">Scale up to</th>
                  <th className="py-1 font-medium">Size</th>
                </tr>
              </thead>
              <tbody>
                {activeServices(planSlug).map(k => {
                  const sv = spec.services[k]
                  return (
                    <tr key={k} className="border-t border-border-default/60">
                      <td className="py-2 pr-3 text-foreground">{SERVICE_LABEL[k]}</td>
                      <td className="py-2 pr-3">
                        <select className={selectCls} value={sv.replicas} onChange={e => edit(s => {
                          s.services[k].replicas = Number(e.target.value)
                          s.services[k].maxReplicas = Math.max(s.services[k].maxReplicas, s.services[k].replicas)
                        })}>
                          {Array.from({ length: LIMITS.maxReplicas }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </td>
                      <td className="py-2 pr-3">
                        <select className={selectCls} value={sv.maxReplicas} onChange={e => edit(s => void (s.services[k].maxReplicas = Number(e.target.value)))}>
                          {Array.from({ length: LIMITS.maxReplicas - sv.replicas + 1 }, (_, i) => sv.replicas + i).map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </td>
                      <td className="py-2">
                        <select className={selectCls} value={sv.size} onChange={e => edit(s => void (s.services[k].size = e.target.value as PodSize))}>
                          {(['S', 'M', 'L'] as PodSize[]).map(z => <option key={z} value={z}>{SIZE_LABEL[z]}</option>)}
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {fit && (
            <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
              <Meter label="Memory" used={fit.memory.requestedMib} total={fit.memory.allocatableMib} unit="MB" />
              <Meter label="CPU" used={fit.cpu.requestedMilli / 1000} total={fit.cpu.allocatableMilli / 1000} unit="vCPU" />
              <div className="rounded-xl bg-surface p-2 text-foreground-secondary">
                Database: {fit.db.maxConnections} connections, {fit.db.poolPerPod} per copy
              </div>
            </div>
          )}
        </div>
      )}

      {validation && !validation.ok && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {validation.errors.map(e => <p key={e}>{e}</p>)}
          {bigger && bigger !== spec.node.type && (
            <button type="button" className="mt-2 underline" onClick={() => edit(s => void (s.node.type = bigger))}>Use {bigger}</button>
          )}
        </div>
      )}
      {capacityError && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{capacityError}</p>}

      {choice?.quote && choice.total && (
        <div className="rounded-2xl border border-border-default bg-surface p-4 text-sm">
          {choice.quote.lines.map(l => (
            <div key={l.key} className="flex justify-between gap-3 py-0.5">
              <span className="text-foreground-secondary">{l.label} <span className="text-xs text-foreground-muted">· {l.detail}</span></span>
              <span className="text-foreground">{inr(l.inrMonth)}</span>
            </div>
          ))}
          <div className="mt-2 flex justify-between border-t border-border-default/60 pt-2 text-foreground-secondary">
            <span>GST (18%)</span>
            <span>{inr(choice.total.gstOnInfra)}</span>
          </div>
          {choice.total.planFee > 0 && (
            <div className="flex justify-between text-foreground-secondary"><span>{plan.name} plan fee (GST included)</span><span>{inr(choice.total.planFee)}</span></div>
          )}
          <div className="mt-2 flex justify-between border-t border-border-default/60 pt-2 text-base font-bold">
            <span>Total per month</span>
            <span>{inr(choice.total.total)}</span>
          </div>
          <p className="mt-2 text-xs text-foreground-muted">
            One subscription covers your plan and servers. {BASIC_PRESET.includes('basic') && isBasic ? 'Basic is a fixed size.' : 'Change size any time from Plan & servers.'}
          </p>
        </div>
      )}
    </div>
  )
}

function Meter({ label, used, total, unit }: { label: string; used: number; total: number; unit: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0
  return (
    <div className="rounded-xl bg-surface p-2">
      <div className="flex justify-between text-foreground-secondary">
        <span>{label}</span>
        <span>{Math.round(used * 100) / 100} / {Math.round(total * 100) / 100} {unit}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-border-default">
        <div className={`h-1.5 rounded-full ${used > total ? 'bg-red-500' : 'bg-foreground'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
