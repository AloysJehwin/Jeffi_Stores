'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Segmented } from '../../_ui'
import { ComputeConfigurator, type ComputeChoice } from '../../_compute/ComputeConfigurator'
import { describeChange } from '@/lib/compute/changes'
import { specKey } from '@/lib/compute/presets'
import type { ComputeSpec } from '@/lib/compute/spec'
import { Card, Row } from '../_components/Card'

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
    s.db.mode === 'shared' ? 'shared database' : `${s.db.class?.replace(/^db\./, '')} database, ${s.db.storageGb} GB${s.db.multiAz ? ', with standby' : ''}`,
  ].join(' · ')

export default function ComputeClient({
  tenantId,
  planSlug,
  planFeeInr,
  current,
  change,
  rateInrHour,
}: {
  tenantId: string
  planSlug: string
  planFeeInr: number
  current: ComputeSpec
  change: { desired: ComputeSpec; status: string; error: string | null; applyMode: ApplyMode } | null
  rateInrHour: number | null
}) {
  const router = useRouter()
  const [choice, setChoice] = useState<ComputeChoice | null>(null)
  const [applyMode, setApplyMode] = useState<ApplyMode>(change?.applyMode ?? 'window')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = change?.status === 'applying'
  const next = choice?.spec ?? null
  const changed = !!next && specKey(next) !== specKey(current)
  const what = next && changed ? describeChange(current, next, applyMode) : null

  async function apply() {
    if (!next) return
    setSaving(true)
    setError(null)
    const r = await fetch('/api/ecom/compute', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, spec: next, applyMode }),
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

      <Card title="Change servers">
        {busy ? (
          <p className="text-sm text-foreground-secondary">A change is being applied. You can make another once it has finished.</p>
        ) : (
          <div className="space-y-6">
            <ComputeConfigurator planSlug={planSlug} value={change?.desired ?? current} onChange={setChoice} current={current} planFeeInr={planFeeInr} />
            {what && (
              <div className="space-y-3 rounded-xl border border-border-default p-4">
                <p className="text-sm font-medium text-foreground">What happens</p>
                <ul className="list-disc space-y-1 pl-5 text-sm text-foreground-secondary">
                  {what.notes.map(n => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
                {what.classChange && (
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
