'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import AdminSelect from '@/components/admin/AdminSelect'
import { ChoiceCards, Segmented, fieldCls } from '../_ui'
import { BASIC_DB_CLASSES, DEDICATED_PRESETS, PRESETS, PRESET_DB_CLASS, TRAFFIC_BANDS, presetOf, presetSpec, recommendedPresetKey, specKey, withDedicatedDb, withHighAvailability } from '@/lib/compute/presets'
import { monthlyTotal, quoteSpec, type Quote } from '@controller/lib/compute/pricing'
import { LIMITS, PRESET_RANK, fitOf, fittingServers, nodeTier, planCompatibilityError, serverFitErrors, validateSpec, type Fit, type Validation } from '@/lib/compute/validate'
import { activeServices, cloneSpec, type Catalog, type ComputeSpec, type PodSize, type PresetKey, type ServiceName } from '@/lib/compute/spec'

export interface ComputePlan {
  slug: string
  name: string
  monthlyPriceInr: number
  /** False for a retired plan (Starter): offered only to a store already on it. */
  active?: boolean
  defaultPreset: PresetKey | null
  minPlacement: 'pool' | 'dedicated'
  advanced: boolean
  minPreset?: PresetKey
  infraMargin?: number
  /** The margin with the database on RDS; unset uses infraMargin. */
  rdsMargin?: number
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

type DbMode = 'node' | 'dedicated'

const SERVICE_LABEL: Record<ServiceName, string> = {
  storefront: 'Storefront',
  admin: 'Admin panel',
  business: 'Business portal',
  messaging: 'Messaging',
  documents: 'Invoices & documents',
}
const SIZE_LABEL: Record<PodSize, string> = { S: 'Small', M: 'Medium', L: 'Large' }
const SIZE_COLUMNS: Record<number, string> = { 1: 'grid-cols-1', 2: 'grid-cols-1 sm:grid-cols-2', 3: 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3', 4: 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4' }

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
const fmtVisitors = (n: number) => n >= 1_000_000 ? `${n / 1_000_000}M` : n >= 1_000 ? `${n / 1_000}k` : `${n}`
const numberCls = `w-full rounded-xl border bg-surface px-3 py-2 text-sm text-foreground ${fieldCls}`
const checkRowCls = 'flex cursor-pointer items-start gap-3 rounded-xl border border-border-default bg-surface p-4 text-sm text-foreground transition-colors hover:bg-surface-secondary'
const checkCls = 'mt-0.5 h-4 w-4 shrink-0 rounded accent-accent-600'
const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i)
const gb = (mib: number | null) => Math.round((mib ?? 0) / 1024)
const servers = (count: number, type: string) => `${count > 1 ? `${count} × ` : ''}${type}`
const SERVICES_GRID = 'sm:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))]'

const dbModeOf = (s: ComputeSpec): DbMode => (s.db.mode === 'dedicated' ? 'dedicated' : 'node')
/** High availability: a second server, plus a standby database when it is on RDS. */
const haOf = (s: ComputeSpec) => s.node.count > 1 && (s.db.mode !== 'dedicated' || s.db.multiAz)

/** A size card's spec with the chosen database and high availability (Basic: its database only). A disk never shrinks, so a running store keeps a bigger one. */
function shapeOf(k: PresetKey, mode: DbMode, ha: boolean, current?: ComputeSpec | null): ComputeSpec {
  const sized = k !== 'basic' && k !== 'shared'
  let s = presetSpec(k)
  if (k !== 'shared' && mode === 'dedicated') s = withDedicatedDb(s, k)
  if (sized && ha) s = withHighAvailability(s)
  if (current && current.db.mode === s.db.mode && current.db.storageGb > s.db.storageGb) s.db.storageGb = current.db.storageGb
  if (k === 'basic' && s.db.mode === 'dedicated' && current?.db.mode === 'dedicated' && BASIC_DB_CLASSES.includes(current.db.class ?? '')) s.db.class = current.db.class
  return s
}

interface ComputeOption<T extends string | number> {
  value: T
  label: string
  hint?: string
  disabled?: boolean
}

/** AdminSelect (themed by ecom.css) over numeric or string values, with a hint and a disabled state per option. */
function ComputeSelect<T extends string | number>({ id, label, labelCls = '', value, options, onChange }: {
  id: string
  label: string
  labelCls?: string
  value: T
  options: ComputeOption<T>[]
  onChange: (v: T) => void
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={`mb-1 block text-xs text-foreground-secondary ${labelCls}`}>{label}</label>
      <AdminSelect
        id={id}
        sm
        value={String(value)}
        options={options.map(o => ({ value: String(o.value), label: o.label, hint: o.hint, disabled: o.disabled }))}
        onChange={v => {
          const o = options.find(x => String(x.value) === v)
          if (o) onChange(o.value)
        }}
      />
    </div>
  )
}

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
  /** The plan fee in the totals; defaults to the chosen plan's monthly fee (onboarding passes its yearly-billing equivalent). */
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
  // A server change made so a choice fits, with the spec before it.
  const [notice, setNotice] = useState<{ text: string; undo: ComputeSpec } | null>(null)
  const uid = useId()
  // The plan the spec was last set for: a different one starts again from its default size.
  const shapedFor = useRef<string | null>(null)

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
  const choosable = plans.filter(p => p.active !== false || p.slug === planSlug)
  const isBasic = plan?.minPreset === 'basic'

  const visitorsPerMonth = TRAFFIC_BANDS[visitorIdx] ?? 5_000

  const evaluate = (spec: ComputeSpec, slug: string): ComputeChoice | null => {
    if (!catalog) return null
    const p = plans.find(x => x.slug === slug) ?? plan
    if (!p) return null
    const validation: Validation = validateSpec(spec, catalog, p, { current })
    let quote: Quote | null = null
    try {
      quote = quoteSpec(spec, catalog, p)
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

  // The size card a server type belongs to (by its memory), for the selected card and the database class.
  const sizeOfNode = (type: string | null): PresetKey | null => {
    const t = nodeTier(type, catalog)
    return t > 0 ? DEDICATED_PRESETS[Math.min(t, DEDICATED_PRESETS.length) - 1] : null
  }
  const defaultFor = (p: ComputePlan, mode: DbMode): ComputeSpec => {
    if (p.minPreset === 'basic') return shapeOf('basic', mode, false, current)
    if (p.minPlacement === 'pool') return presetSpec('shared')
    return shapeOf((p.defaultPreset ?? p.minPreset ?? 'small') as PresetKey, mode, false, current)
  }
  const isSizeCard = (s: ComputeSpec) => {
    const k = sizeOfNode(s.node.type)
    return !!k && specKey(shapeOf(k, dbModeOf(s), haOf(s), current)) === specKey(s)
  }

  // A saved choice the plan allows is kept when the configurator opens; Basic is always its fixed size (with
  // the database chosen), and a newly picked plan starts from its default size (keeping the database choice).
  useEffect(() => {
    if (!catalog || !plan) return
    const planChanged = shapedFor.current !== null && shapedFor.current !== planSlug
    shapedFor.current = planSlug
    const keep = !planChanged && !!value && plan.minPreset !== 'basic' && !planCompatibilityError(value, plan, catalog)
    const spec = keep && value ? value : defaultFor(plan, value ? dbModeOf(value) : 'node')
    const c = evaluate(spec, planSlug)
    if (c) onChange(c)
    setNotice(null)
    setCustom(keep && plan.minPlacement !== 'pool' && !isSizeCard(spec))
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
        .then(async r => {
          const d = await r.json().catch(() => null)
          if (!r.ok) return setCapacityError(d?.error || 'Could not check this size with the server. Try again.')
          setCapacityError(d?.capacityError ?? (d?.validation?.ok === false ? (d.validation.errors?.[0] ?? null) : null))
        })
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
  const fee = planFeeInr ?? plan.monthlyPriceInr
  const ha = haOf(spec)
  const dbMode = dbModeOf(spec)
  const fallbackKey = (plan.defaultPreset ?? plan.minPreset ?? 'small') as PresetKey
  const sizeKey = sizeOfNode(spec.node.type) ?? fallbackKey
  // The full monthly price (plan fee, infra, GST on infra) of a spec on this plan; null when a part has no price.
  const totalOf = (s: ComputeSpec) => {
    try {
      return monthlyTotal(quoteSpec(s, catalog, plan), fee, catalog.settings.gstRate).total
    } catch {
      return null
    }
  }
  // Whether the services fit the servers (the same check validateSpec makes).
  const fitsNow = (s: ComputeSpec) => s.node.placement !== 'dedicated' || serverFitErrors(s, catalog, planSlug).length === 0
  // What a choice that doesn't fit the current servers needs; undefined when it fits.
  const needs = (s: ComputeSpec): string | undefined => {
    if (fitsNow(s)) return undefined
    const to = fittingServers(s, catalog, planSlug)
    return to ? `needs ${servers(to.count > s.node.count ? to.count : 1, to.type)}` : 'too big for any server'
  }
  // Apply a choice; one that doesn't fit moves to the smallest server type (or more servers) it fits on.
  const choose = (next: ComputeSpec, what: string) => {
    let note: typeof notice = null
    if (next.node.placement === 'dedicated' && !fitsNow(next)) {
      const to = fittingServers(next, catalog, planSlug)
      if (to) {
        const before = totalOf(spec)
        next.node.type = to.type
        next.node.count = to.count
        const after = totalOf(next)
        const diff = before != null && after != null ? Math.round(after - before) : null
        const price = diff == null || diff === 0 ? '' : ` (${diff > 0 ? '+' : '−'}${inr(Math.abs(diff))}/mo)`
        note = { text: `${what} needs more room, so your server moved to ${servers(to.count, to.type)}${price}.`, undo: spec }
      }
    }
    setNotice(note)
    set(next)
  }
  const edit = (fn: (s: ComputeSpec) => void, what?: string) => {
    const next = cloneSpec(spec)
    fn(next)
    if (what) return choose(next, what)
    setNotice(null)
    set(next)
  }
  const priceFor = (key: PresetKey, p: ComputePlan) => quoteSpec(presetSpec(key), catalog, p).inrMonth
  const planFloorPrice = (p: ComputePlan) => {
    const k = (p.minPreset ?? p.defaultPreset ?? (p.minPlacement === 'pool' ? 'shared' : 'small')) as PresetKey
    const base = quoteSpec(presetSpec(k), catalog, p)
    return monthlyTotal(base, p.monthlyPriceInr, catalog.settings.gstRate).total
  }
  const ec2 = catalog.prices.filter(p => p.kind === 'ec2' && p.sellable)
  const rds = catalog.prices.filter(p => p.kind === 'rds' && p.sellable)
  let fit: Fit | null = null
  try {
    fit = spec.node.placement === 'dedicated' ? fitOf(spec, catalog, planSlug) : null
  } catch {
    fit = null
  }
  // The servers that would fit (null: none does) when the services don't fit the current ones.
  const fix = validation && !validation.ok && spec.node.placement === 'dedicated' && !fitsNow(spec) ? fittingServers(spec, catalog, planSlug) : undefined
  const recKey = plan.minPreset !== 'basic' ? recommendedPresetKey(planSlug, visitorsPerMonth, plan) : null
  // Sizes below the plan's minimum are not offered.
  const rankOf = (k: PresetKey) => (k === 'shared' ? -1 : PRESET_RANK[k])
  const floorRank = Math.max(1, plan.minPreset ? rankOf(plan.minPreset) : 1)
  const sizes = DEDICATED_PRESETS.filter(k => rankOf(k) >= floorRank)
  const basicTotal = isBasic ? totalOf(spec) : null
  const basicOnServer = isBasic ? totalOf(shapeOf('basic', 'node', false, current)) : null
  const basicWithRds = isBasic ? totalOf(shapeOf('basic', 'dedicated', false, current)) : null
  const basicRdsExtra = basicOnServer != null && basicWithRds != null ? basicWithRds - basicOnServer : null
  const setDbMode = (mode: DbMode) => {
    if (!custom) return set(shapeOf(sizeKey, mode, ha, current))
    edit(s => {
      const storageGb = Math.max(LIMITS.minStorageGb, s.db.storageGb)
      s.db =
        mode === 'dedicated'
          ? { mode: 'dedicated', class: PRESET_DB_CLASS[sizeOfNode(s.node.type) ?? 'small'] ?? 'db.t4g.micro', storageGb, multiAz: ha }
          : { mode: 'node', class: null, storageGb, multiAz: false }
    }, mode === 'node' ? 'The database on your server' : undefined)
  }
  const setHa = (on: boolean) => {
    if (!custom) return set(shapeOf(sizeKey, dbMode, on, current))
    edit(s => {
      s.node.count = on ? Math.max(2, s.node.count) : 1
      s.db.multiAz = on && s.db.mode === 'dedicated'
    })
  }
  const customising = custom && spec.node.placement === 'dedicated' && !isBasic
  // A copy of the spec with one change, for an option's hint.
  const variant = (fn: (s: ComputeSpec) => void) => {
    const s = cloneSpec(spec)
    fn(s)
    return s
  }
  const typeOptions: ComputeOption<string>[] = !customising ? [] : ec2.map(p => {
    const t = p.code.slice(4)
    const s = variant(x => void (x.node.type = t))
    const fits = fitsNow(s)
    const total = totalOf(s)
    return {
      value: t,
      label: t,
      hint: [`${p.vcpu} vCPU · ${gb(p.memoryMib)} GB`, total != null ? `${inr(total)}/mo` : null, fits ? null : 'too small'].filter(Boolean).join(' · '),
      disabled: !fits && t !== spec.node.type,
    }
  })
  const countOptions: ComputeOption<number>[] = !customising ? [] : range(1, LIMITS.maxNodes).map(n => {
    const s = variant(x => void (x.node.count = n))
    const total = totalOf(s)
    return { value: n, label: String(n), hint: [total != null ? `${inr(total)}/mo` : null, needs(s)].filter(Boolean).join(' · ') || undefined }
  })
  const classOptions: ComputeOption<string>[] = !customising ? [] : rds.map(p => {
    const c = p.code.slice(4)
    const total = totalOf(variant(x => void (x.db.class = c)))
    return { value: c, label: c, hint: [`${p.vcpu} vCPU · ${gb(p.memoryMib)} GB`, total != null ? `${inr(total)}/mo` : null].filter(Boolean).join(' · ') }
  })

  return (
    <div className="space-y-5">
      {/* ── Plan cards ── */}
      {choosable.length > 0 && (
        <ChoiceCards<string>
          ariaLabel="Plan"
          columns="grid-cols-2 xl:grid-cols-4"
          cardClassName="bg-surface-elevated p-4"
          value={planSlug}
          onChange={s => onPlanChange?.(s)}
          options={choosable.map(p => ({
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

      {/* ── Basic: fixed server, database on it or on RDS ── */}
      {isBasic ? (
        <div className="rounded-2xl border border-border-default bg-surface-elevated p-4">
          <div className="font-semibold text-foreground">{PRESETS.basic.label}</div>
          <p className="mt-1 text-sm text-foreground-secondary">
            {dbMode === 'dedicated' ? 'Own server, with its PostgreSQL on a managed RDS database.' : PRESETS.basic.blurb}
          </p>
          {basicTotal != null && <p className="mt-2 text-sm text-foreground">{inr(basicTotal)}/mo incl. GST</p>}
          <div className="mt-3">
            <div className="mb-1 text-sm font-medium text-foreground">Database</div>
            <Segmented<DbMode>
              ariaLabel="Database"
              size="sm"
              value={dbMode}
              onChange={m => set(shapeOf('basic', m, false, current))}
              options={[
                { value: 'node', label: 'On your server (included)' },
                { value: 'dedicated', label: basicRdsExtra != null ? `RDS +${inr(basicRdsExtra)}/mo` : 'RDS' },
              ]}
            />
            <p className="mt-1 text-xs text-foreground-muted">
              {dbMode === 'dedicated'
                ? `A managed PostgreSQL server (${spec.db.class ?? PRESET_DB_CLASS.basic}, ${spec.db.storageGb} GB), separate from your app server.`
                : 'PostgreSQL runs on your own server — nightly backups to S3.'}
            </p>
          </div>
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

          {/* ── Size cards: each with its monthly total, database on the server or on its own ── */}
          <ChoiceCards<PresetKey>
            ariaLabel="Server size"
            columns={SIZE_COLUMNS[sizes.length] ?? SIZE_COLUMNS[4]}
            cardClassName="bg-surface-elevated p-4"
            value={custom || !sizes.includes(sizeKey) ? null : sizeKey}
            onChange={k => {
              setCustom(false)
              setNotice(null)
              set(shapeOf(k, dbMode, ha, current))
            }}
            options={sizes.map(k => {
              const onServer = totalOf(shapeOf(k, 'node', ha, current))
              const withDb = totalOf(shapeOf(k, 'dedicated', ha, current))
              return {
                value: k,
                label: PRESETS[k].label,
                content: (
                  <>
                    <div className="flex items-center justify-between pr-6">
                      <div className="font-semibold text-foreground">{PRESETS[k].label}</div>
                      {recKey === k && <span className="ml-1 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold org-sage org-sage-text">Recommended</span>}
                    </div>
                    <div className="mt-2 space-y-0.5 text-sm">
                      {onServer != null && (
                        <div className={`flex justify-between gap-2 ${dbMode === 'node' ? 'font-bold text-foreground' : 'text-foreground-secondary'}`}>
                          <span>On your server</span><span>{inr(onServer)}<span className="text-xs font-normal text-foreground-muted">/mo</span></span>
                        </div>
                      )}
                      {withDb != null && (
                        <div className={`flex justify-between gap-2 ${dbMode === 'dedicated' ? 'font-bold text-foreground' : 'text-foreground-secondary'}`}>
                          <span>With dedicated DB</span><span>{inr(withDb)}<span className="text-xs font-normal text-foreground-muted">/mo</span></span>
                        </div>
                      )}
                    </div>
                    <div className="mt-1 text-[10px] text-foreground-muted">Incl. GST and the {plan.name} plan fee</div>
                    <div className="mt-1 text-xs text-foreground-secondary">{PRESETS[k].blurb}</div>
                  </>
                ),
              }
            })}
          />
          <label className={checkRowCls}>
            <input type="checkbox" className={checkCls} checked={ha} onChange={e => setHa(e.target.checked)} />
            <span>
              High availability
              <span className="block text-xs text-foreground-muted">
                {dbMode === 'dedicated'
                  ? 'A second server and a standby database in another zone, so one failing never stops the store.'
                  : 'A second server running copies of your store. The database stays on one server; choose a dedicated database for a standby.'}
              </span>
            </span>
          </label>
          {/* ── Database: on the store's server (default) vs its own RDS ── */}
          <div>
            <div className="mb-1 text-sm font-medium text-foreground">Database</div>
            <Segmented<DbMode>
              ariaLabel="Database"
              size="sm"
              value={dbMode}
              onChange={setDbMode}
              options={[
                { value: 'node', label: 'On your server' },
                { value: 'dedicated', label: 'Dedicated database (RDS)' },
              ]}
            />
            <p className="mt-1 text-xs text-foreground-muted">
              {dbMode === 'dedicated'
                ? 'A managed PostgreSQL server, separate from your app server.'
                : 'PostgreSQL runs on your own server — nightly backups to S3.'}
            </p>
          </div>
          {plan.advanced && (
            <Segmented<'preset' | 'custom'>
              ariaLabel="Settings"
              size="sm"
              value={custom ? 'custom' : 'preset'}
              onChange={v => {
                if (v === 'preset') set(shapeOf(sizes.includes(sizeKey) ? sizeKey : (sizes[0] ?? fallbackKey), dbMode, ha, current))
                setNotice(null)
                setCustom(v === 'custom')
              }}
              options={[{ value: 'preset', label: 'Sizes' }, { value: 'custom', label: 'Customise' }]}
            />
          )}
        </>
      )}

      {customising && (
        <div className="space-y-4 rounded-2xl border border-border-default bg-surface-elevated p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ComputeSelect id={`${uid}-type`} label="Server" value={spec.node.type ?? ''} options={typeOptions}
              onChange={t => edit(s => void (s.node.type = t))} />
            <ComputeSelect id={`${uid}-count`} label="Servers" value={spec.node.count} options={countOptions}
              onChange={n => edit(s => void (s.node.count = n), `${n} server${n > 1 ? 's' : ''}`)} />
            {spec.db.mode === 'dedicated' ? (
              <ComputeSelect id={`${uid}-db`} label="Database" value={spec.db.class ?? ''} options={classOptions}
                onChange={c => edit(s => void (s.db.class = c))} />
            ) : (
              <div className="min-w-0">
                <span className="mb-1 block text-xs text-foreground-secondary">Database</span>
                <div className="rounded-xl border border-border-default bg-surface px-3 py-2 text-sm text-foreground-secondary">On your server (included)</div>
              </div>
            )}
            <label className="block min-w-0">
              <span className="mb-1 block text-xs text-foreground-secondary">{spec.db.mode === 'dedicated' ? 'Database storage (GB)' : 'Database disk (GB)'}</span>
              <input
                type="number"
                inputMode="numeric"
                className={numberCls}
                min={current && current.db.storageGb && current.db.mode === spec.db.mode ? current.db.storageGb : LIMITS.minStorageGb}
                max={LIMITS.maxStorageGb}
                step={10}
                value={spec.db.storageGb}
                onChange={e => edit(s => void (s.db.storageGb = Math.round(Number(e.target.value) || 0)))}
              />
            </label>
            <label className="block min-w-0 sm:col-span-2">
              <span className="mb-1 block text-xs text-foreground-secondary">Object storage, S3 (GB)</span>
              <input
                type="number"
                inputMode="numeric"
                className={numberCls}
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
            <label className={checkRowCls}>
              <input type="checkbox" className={checkCls} checked={spec.db.multiAz} onChange={e => edit(s => void (s.db.multiAz = e.target.checked))} />
              <span>Standby database in a second zone</span>
            </label>
          )}
          <div>
            <div className={`hidden gap-2 pb-1 text-xs text-foreground-muted sm:grid ${SERVICES_GRID}`}>
              <span>Service</span><span>Copies</span><span>Scale up to</span><span>Size</span>
            </div>
            <div className="divide-y divide-border-default/60">
              {activeServices(planSlug).map(k => {
                const sv = spec.services[k]
                const label = SERVICE_LABEL[k]
                const copies = range(1, LIMITS.maxReplicas).map(n => ({
                  value: n,
                  label: String(n),
                  hint: needs(variant(x => {
                    x.services[k].replicas = n
                    x.services[k].maxReplicas = Math.max(x.services[k].maxReplicas, n)
                  })),
                }))
                const scale = range(sv.replicas, LIMITS.maxReplicas).map(n => ({ value: n, label: String(n), hint: needs(variant(x => void (x.services[k].maxReplicas = n))) }))
                const sizesFor = (['S', 'M', 'L'] as PodSize[]).map(z => ({ value: z, label: SIZE_LABEL[z], hint: needs(variant(x => void (x.services[k].size = z))) }))
                return (
                  <div key={k} className={`grid grid-cols-3 gap-2 py-2 sm:items-end ${SERVICES_GRID}`}>
                    <div className="col-span-3 text-sm text-foreground sm:col-span-1 sm:self-center">{label}</div>
                    <ComputeSelect id={`${uid}-${k}-copies`} label="Copies" labelCls="sm:sr-only" value={sv.replicas} options={copies}
                      onChange={n => edit(s => {
                        s.services[k].replicas = n
                        s.services[k].maxReplicas = Math.max(s.services[k].maxReplicas, n)
                      }, `${label} at ${n} ${n > 1 ? 'copies' : 'copy'}`)} />
                    <ComputeSelect id={`${uid}-${k}-scale`} label="Scale up to" labelCls="sm:sr-only" value={sv.maxReplicas} options={scale}
                      onChange={n => edit(s => void (s.services[k].maxReplicas = n), `${label} scaling to ${n}`)} />
                    <ComputeSelect id={`${uid}-${k}-size`} label="Size" labelCls="sm:sr-only" value={sv.size} options={sizesFor}
                      onChange={z => edit(s => void (s.services[k].size = z), `${label} at size ${SIZE_LABEL[z]}`)} />
                  </div>
                )
              })}
            </div>
          </div>
          {notice && (
            <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl org-sand p-3 text-sm text-foreground">
              <span className="min-w-0">{notice.text}</span>
              <button type="button" className="shrink-0 font-semibold underline" onClick={() => { set(notice.undo); setNotice(null) }}>Undo</button>
            </div>
          )}
          {fit && (
            <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
              <Meter label="Memory" used={fit.memory.requestedMib} total={fit.memory.allocatableMib} unit="MB" hard={!validation?.ok} />
              <Meter label="CPU" used={fit.cpu.requestedMilli / 1000} total={fit.cpu.allocatableMilli / 1000} unit="vCPU" hard={!validation?.ok} />
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
          {fix && (fix.type !== spec.node.type || fix.count !== spec.node.count) && (
            <button type="button" className="mt-2 underline" onClick={() => edit(s => {
              s.node.type = fix.type
              s.node.count = fix.count
            })}>Use {servers(fix.count, fix.type)}</button>
          )}
          {fix === null && (
            <p className="mt-2">Even {LIMITS.maxNodes} of the largest server can&apos;t run this. Choose smaller sizes or fewer copies.</p>
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
            One subscription covers your plan and servers. {isBasic ? 'Basic is a fixed size; its database can move to RDS.' : 'Change size any time from Plan & servers.'}
          </p>
        </div>
      )}
    </div>
  )
}

/** `hard`: over the limit is an error (red); otherwise a tolerated squeeze (amber). */
function Meter({ label, used, total, unit, hard }: { label: string; used: number; total: number; unit: string; hard: boolean }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0
  return (
    <div className="rounded-xl bg-surface p-2">
      <div className="flex justify-between text-foreground-secondary">
        <span>{label}</span>
        <span>{Math.round(used * 100) / 100} / {Math.round(total * 100) / 100} {unit}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-border-default">
        <div className={`h-1.5 rounded-full ${used > total ? (hard ? 'bg-red-500' : 'bg-amber-500') : 'bg-foreground'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
