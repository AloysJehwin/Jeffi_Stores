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

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

const STATUS: Record<string, string> = {
  pending: 'Waiting to start',
  applying: 'Being applied',
  failed: 'Could not be applied',
  paused: 'Paused',
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
  planFeeInr,
  current,
  change,
  rateInrHour,
  paused,
  plans,
  featureMatrix,
  comparisonRows,
}: {
  tenantId: string
  planSlug: string
  planFeeInr: number
  current: ComputeSpec
  change: { desired: ComputeSpec; status: string; error: string | null; applyMode: ApplyMode } | null
  rateInrHour: number | null
  paused: boolean
  plans: { slug: string; name: string }[]
  featureMatrix: Record<string, string[]>
  comparisonRows: ComparisonRow[]
}) {
  const router = useRouter()
  const [choice, setChoice] = useState<ComputeChoice | null>(null)
  const [nextPlan, setNextPlan] = useState<string>(planSlug)
  const [applyMode, setApplyMode] = useState<ApplyMode>(change?.applyMode ?? 'window')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = change?.status === 'applying'
  const next = choice?.spec ?? null
  const specChanged = !!next && specKey(next) !== specKey(current)
  const planChanged = nextPlan !== planSlug
  const changed = specChanged || planChanged
  const what = next && specChanged ? describeChange(current, next, applyMode) : null
  const delta = planChanged ? planDelta(planSlug, nextPlan, featureMatrix, comparisonRows) : { gained: [], lost: [] }
  const planName = (slug: string) => plans.find(p => p.slug === slug)?.name ?? slug

  async function apply() {
    if (!next) return
    setSaving(true)
    setError(null)
    const r = await fetch('/api/ecom/compute', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, spec: next, applyMode, planSlug: nextPlan }),
    }).catch(() => null)
    const d = await r?.json().catch(() => null)
    setSaving(false)
    if (!r?.ok) return setError(d?.error || 'Could not save the change. Try again.')
    router.refresh()
  }

  return (
    <div className="space-y-6">
      <Card title="Running now">
        <div className="space-y-2">
          <Row label="Plan" value={planName(planSlug)} />
          <Row label="Servers" value={summary(current)} />
          {rateInrHour != null && <Row label="Cost" value={`${inr(rateInrHour * 730)}/month (${inr(rateInrHour * 24)}/day) + GST`} />}
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
              value={change?.desired ?? current}
              onChange={setChoice}
              current={current}
              planFeeInr={planFeeInr}
            />

            {changed && (
              <div className="space-y-3 rounded-xl border border-border-default p-4">
                <p className="text-sm font-medium text-foreground">What changes</p>
                {planChanged && (
                  <div className="text-sm text-foreground-secondary">
                    Plan: <span className="font-medium text-foreground">{planName(planSlug)}</span> → <span className="font-medium text-foreground">{planName(nextPlan)}</span>
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
                  Plan changes are billed on your subscription (upgrade now, downgrade at renewal). Server changes {what?.classChange ? (applyMode === 'now' ? 'apply right away.' : 'apply in the maintenance window.') : 'apply right away.'}
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
