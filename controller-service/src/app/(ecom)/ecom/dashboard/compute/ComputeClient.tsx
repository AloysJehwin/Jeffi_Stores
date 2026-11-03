'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Segmented } from '../../_ui'
import { ComputeConfigurator, type ComputeChoice } from '../../_compute/ComputeConfigurator'
import { describeChange } from '@controller/lib/compute/changes'
import { specKey } from '@/lib/compute/presets'
import type { ComputeSpec } from '@/lib/compute/spec'
import { Card, Row } from '../_components/Card'
type ComparisonRow = { group: string; label: string; scopeKey: string | null }

type ApplyMode = 'window' | 'now'
type Interval = 'monthly' | 'yearly'

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

const STATUS: Record<string, string> = {
  pending: 'Waiting to start',
  applying: 'Being applied',
  failed: 'Could not be applied',
  paused: 'Paused',
  scheduled: 'At your next renewal',
}

const summary = (s: ComputeSpec) =>
  [
    s.node.placement === 'pool' ? 'Shared servers' : `${s.node.count > 1 ? `${s.node.count}× ` : ''}${s.node.type}`,
    s.db.mode === 'shared' ? 'shared database' : s.db.mode === 'node' ? 'on-node database' : `${s.db.class?.replace(/^db\./, '')} database, ${s.db.storageGb} GB${s.db.multiAz ? ', with standby' : ''}`,
  ].join(' · ')

/** Features gained/lost moving from one plan to another, from the comparison rows + feature matrix. */
function planDelta(from: string, to: string, matrix: Record<string, string[]>, rows: ComparisonRow[]): { gained: string[]; lost: string[] } {
  if (from === to) return { gained: [], lost: [] }
  const fromKeys = new Set(matrix[from] ?? [])
  const toKeys = new Set(matrix[to] ?? [])
  const gained: string[] = []
  const lost: string[] = []
  for (const row of rows) {
    if (!row.scopeKey) continue
    const inFrom = fromKeys.has(row.scopeKey)
    const inTo = toKeys.has(row.scopeKey)
    if (inTo && !inFrom) gained.push(row.label)
    else if (inFrom && !inTo) lost.push(row.label)
  }
  return { gained, lost }
}

export default function ComputeClient({
  tenantId,
  planSlug,
  billingInterval,
  current,
  change,
  priceInrMonth,
  paymentsEnabled,
  paused,
  plans,
  featureMatrix,
  comparisonRows,
}: {
  tenantId: string
  planSlug: string
  billingInterval: Interval
  current: ComputeSpec
  change: { desired: ComputeSpec; status: string; error: string | null; applyMode: ApplyMode } | null
  /** What the running servers cost on the current plan, per month (plan fee and GST included). */
  priceInrMonth: number | null
  paymentsEnabled: boolean
  paused: boolean
  plans: { slug: string; name: string }[]
  featureMatrix: Record<string, string[]>
  comparisonRows: ComparisonRow[]
}) {
  const router = useRouter()
  const [choice, setChoice] = useState<ComputeChoice | null>(null)
  const [nextPlan, setNextPlan] = useState<string>(planSlug)
  const [interval, setInterval] = useState<Interval>(billingInterval)
  const [applyMode, setApplyMode] = useState<ApplyMode>(change?.applyMode ?? 'window')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = change?.status === 'applying'
  const next = choice?.spec ?? null
  const specChanged = !!next && specKey(next) !== specKey(current)
  const planChanged = nextPlan !== planSlug
  const intervalChanged = interval !== billingInterval
  const changed = specChanged || planChanged || intervalChanged
  const what = next && specChanged ? describeChange(current, next, applyMode) : null
  const delta = planChanged ? planDelta(planSlug, nextPlan, featureMatrix, comparisonRows) : { gained: [], lost: [] }
  const planName = (slug: string) => plans.find(p => p.slug === slug)?.name ?? slug

  // A plan or billing change goes through the subscription (/api/ecom/plan); a resize on the same plan is a compute change.
  async function apply() {
    if (!next) return
    setSaving(true)
    setError(null)
    const viaPlan = planChanged || intervalChanged
    const r = await fetch(viaPlan ? '/api/ecom/plan' : '/api/ecom/compute', {
      method: viaPlan ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(viaPlan ? { tenantId, planSlug: nextPlan, spec: next, billingInterval: interval, applyMode } : { tenantId, spec: next, applyMode }),
    }).catch(() => null)
    const d = await r?.json().catch(() => null)
    setSaving(false)
    if (!r?.ok) return setError(d?.error || 'Could not save the change. Try again.')
    if (d?.checkoutUrl) return void (window.location.href = d.checkoutUrl)
    router.refresh()
  }

  return (
    <div className="space-y-6">
      <Card title="Running now">
        <div className="space-y-2">
          <Row label="Plan" value={planName(planSlug)} />
          <Row label="Servers" value={summary(current)} />
          <Row label="Billing" value={<span className="capitalize">{billingInterval}</span>} />
          {priceInrMonth != null && (
            <Row
              label="Cost"
              value={`${inr(priceInrMonth)}/month incl. GST${billingInterval === 'yearly' ? ` (${inr(priceInrMonth * 10)}/year)` : ''}`}
            />
          )}
          {change && (
            <Row
              label="Change"
              value={
                <span className={change.status === 'failed' ? 'text-red-600 dark:text-red-400' : undefined}>
                  {STATUS[change.status] ?? change.status}: {summary(change.desired)}
                  {change.error ? ` (${change.error})` : ''}
                </span>
              }
            />
          )}
        </div>
      </Card>

      <Card title="Change plan or servers">
        {paused ? (
          <p className="text-sm text-foreground-secondary">Your store is paused. You can change it once it runs again.</p>
        ) : busy ? (
          <p className="text-sm text-foreground-secondary">A change is being applied. You can make another once it has finished.</p>
        ) : (
          <div className="space-y-6">
            <ComputeConfigurator
              planSlug={nextPlan}
              onPlanChange={setNextPlan}
              value={choice?.spec ?? change?.desired ?? current}
              onChange={setChoice}
              current={current}
            />
            <div>
              <div className="mb-1 text-sm font-medium text-foreground">Billing</div>
              <Segmented<Interval>
                ariaLabel="Billing interval"
                size="sm"
                value={interval}
                onChange={setInterval}
                options={[{ value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly', count: '2 months free' }]}
              />
            </div>

            {changed && (
              <div className="space-y-3 rounded-xl border border-border-default p-4">
                <p className="text-sm font-medium text-foreground">What changes</p>
                {planChanged && (
                  <div className="text-sm text-foreground-secondary">
                    Plan: <span className="font-medium text-foreground">{planName(planSlug)}</span> → <span className="font-medium text-foreground">{planName(nextPlan)}</span>
                  </div>
                )}
                {intervalChanged && (
                  <div className="text-sm text-foreground-secondary">
                    Billing: <span className="font-medium capitalize text-foreground">{billingInterval}</span> → <span className="font-medium capitalize text-foreground">{interval}</span>
                  </div>
                )}
                {delta.gained.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-foreground-muted">Gained</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-foreground-secondary">
                      {delta.gained.map(f => <li key={`g:${f}`}>{f}</li>)}
                    </ul>
                  </div>
                )}
                {delta.lost.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-foreground-muted">Lost</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-foreground-secondary">
                      {delta.lost.map(f => <li key={`l:${f}`}>{f}</li>)}
                    </ul>
                  </div>
                )}
                {what?.notes.length ? (
                  <ul className="list-disc space-y-1 pl-5 text-sm text-foreground-secondary">
                    {what.notes.map(n => <li key={n}>{n}</li>)}
                  </ul>
                ) : null}
                {what?.classChange && (
                  <Segmented
                    ariaLabel="When to change the database size"
                    options={[
                      { value: 'window', label: 'In the maintenance window' },
                      { value: 'now', label: 'Now' },
                    ]}
                    value={applyMode}
                    onChange={setApplyMode}
                  />
                )}
                <p className="text-xs text-foreground-muted">
                  {paymentsEnabled ? 'Plan changes are billed on your subscription (upgrade now, downgrade at renewal).' : 'Plan changes apply now.'} Server changes {what?.classChange ? (applyMode === 'now' ? 'apply right away.' : 'apply in the maintenance window.') : 'apply right away.'}
                </p>
              </div>
            )}

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <button
              type="button"
              disabled={!changed || !choice?.valid || saving}
              onClick={apply}
              className="rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Apply change'}
            </button>
          </div>
        )}
      </Card>
    </div>
  )
}
