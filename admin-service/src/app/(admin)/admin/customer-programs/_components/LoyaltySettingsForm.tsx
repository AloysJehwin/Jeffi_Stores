'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import DatePicker from '@/components/ui/DatePicker'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { useToast } from '@/contexts/ToastContext'
import type { LoyaltySettings } from '@/lib/loyalty/settings'
import { fieldInputCls } from '@/components/admin/kit'

const inputClass = fieldInputCls
const labelClass = 'mb-1.5 block text-xs font-medium text-foreground-secondary'
const hintClass = 'mt-1 text-xs text-foreground-muted'
const cardClass = 'rounded-xl border border-border-default bg-surface-elevated p-5 space-y-4'
const headingClass = 'text-sm font-semibold uppercase tracking-wide text-foreground'

interface TierRow {
  key: string
  name: string
  minPoints: string
  multiplier: string
}

function firstFieldError(body: { error?: string; fields?: Record<string, string> } | null): string {
  const field = body?.fields ? Object.values(body.fields)[0] : null
  return field || body?.error || 'Could not save the settings'
}

export default function LoyaltySettingsForm({ initial }: { initial: LoyaltySettings }) {
  const router = useRouter()
  const { showToast } = useToast()
  const canWrite = useCanWrite('campaigns')
  const [rupeesPerPoint, setRupeesPerPoint] = useState(String(initial.rupeesPerPoint))
  const [pointValue, setPointValue] = useState(String(initial.pointValue))
  const [creditDelayDays, setCreditDelayDays] = useState(String(initial.creditDelayDays))
  const [minRedeemPoints, setMinRedeemPoints] = useState(String(initial.minRedeemPoints))
  const [countFrom, setCountFrom] = useState(initial.countFrom ?? '')
  const [tiers, setTiers] = useState<TierRow[]>(
    initial.tiers
      .filter(tier => tier.key !== 'bronze')
      .map(tier => ({
        key: tier.key,
        name: tier.name,
        minPoints: String(tier.minPoints),
        multiplier: String(tier.multiplier),
      }))
  )
  const [saving, setSaving] = useState(false)
  const [recalculating, setRecalculating] = useState(false)

  const patchTier = (key: string, patch: Partial<TierRow>) =>
    setTiers(rows => rows.map(row => (row.key === key ? { ...row, ...patch } : row)))

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/loyalty', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rupeesPerPoint: Number(rupeesPerPoint),
          pointValue: Number(pointValue),
          creditDelayDays: Number(creditDelayDays),
          minRedeemPoints: Number(minRedeemPoints),
          countFrom: countFrom || null,
          tiers: tiers.map(row => ({
            key: row.key,
            minPoints: Number(row.minPoints),
            multiplier: Number(row.multiplier),
          })),
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        showToast(firstFieldError(body), 'error')
        return
      }
      showToast('Loyalty settings saved', 'success')
      router.refresh()
    } catch {
      showToast('Could not save the settings', 'error')
    } finally {
      setSaving(false)
    }
  }

  const recalculate = async () => {
    if (recalculating) return
    setRecalculating(true)
    try {
      const res = await fetch('/api/admin/loyalty/recalculate', { method: 'POST' })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        showToast(body?.error || 'Recalculation failed', 'error')
        return
      }
      showToast(
        `Checked ${body.users} customers: ${body.earned} points added, ${body.reversed} taken back, ${body.upgrades} tier upgrades.`,
        'success'
      )
      router.refresh()
    } catch {
      showToast('Recalculation failed', 'error')
    } finally {
      setRecalculating(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <div className={cardClass}>
        <h2 className={headingClass}>Earning and redeeming</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <div>
            <label className={labelClass}>Rupees per point</label>
            <input
              type="number"
              min="1"
              step="1"
              value={rupeesPerPoint}
              onChange={e => setRupeesPerPoint(e.target.value)}
              disabled={!canWrite}
              className={inputClass}
            />
            <p className={hintClass}>Spend this much on products to earn 1 point.</p>
          </div>
          <div>
            <label className={labelClass}>Value of 1 point (₹)</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={pointValue}
              onChange={e => setPointValue(e.target.value)}
              disabled={!canWrite}
              className={inputClass}
            />
            <p className={hintClass}>What a point is worth when redeemed.</p>
          </div>
          <div>
            <label className={labelClass}>Minimum points to redeem</label>
            <input
              type="number"
              min="1"
              step="1"
              value={minRedeemPoints}
              onChange={e => setMinRedeemPoints(e.target.value)}
              disabled={!canWrite}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Days after delivery</label>
            <input
              type="number"
              min="0"
              max="90"
              step="1"
              value={creditDelayDays}
              onChange={e => setCreditDelayDays(e.target.value)}
              disabled={!canWrite}
              className={inputClass}
            />
            <p className={hintClass}>Points are added this long after delivery, once returns are unlikely.</p>
          </div>
        </div>
        <div className="max-w-xs">
          <label className={labelClass}>Count orders delivered from</label>
          <DatePicker value={countFrom} onChange={setCountFrom} disabled={!canWrite} placeholder="All past orders" />
          <p className={hintClass}>
            Leave empty to count every past order.
            {countFrom && (
              <button type="button" onClick={() => setCountFrom('')} className="ml-2 text-accent-500 hover:underline">
                Clear
              </button>
            )}
          </p>
        </div>
      </div>

      <div className={cardClass}>
        <h2 className={headingClass}>Tiers</h2>
        <p className="text-sm text-foreground-secondary">
          A customer moves up when the points they have ever earned reach the threshold, and never moves down. Everyone
          starts at Bronze, earning 1x.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-foreground-muted">
                <th className="py-2 pr-4 font-medium">Tier</th>
                <th className="py-2 pr-4 font-medium">Points needed</th>
                <th className="py-2 font-medium">Earning rate (x)</th>
              </tr>
            </thead>
            <tbody>
              {tiers.map(row => (
                <tr key={row.key} className="border-t border-border-default">
                  <td className="py-3 pr-4 font-medium text-foreground">{row.name}</td>
                  <td className="py-3 pr-4">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={row.minPoints}
                      onChange={e => patchTier(row.key, { minPoints: e.target.value })}
                      disabled={!canWrite}
                      aria-label={`${row.name} points needed`}
                      className={`${inputClass} max-w-[10rem]`}
                    />
                  </td>
                  <td className="py-3">
                    <input
                      type="number"
                      min="1"
                      max="10"
                      step="0.05"
                      value={row.multiplier}
                      onChange={e => patchTier(row.key, { multiplier: e.target.value })}
                      disabled={!canWrite}
                      aria-label={`${row.name} earning rate`}
                      className={`${inputClass} max-w-[10rem]`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {canWrite ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="control-md bg-accent-500 hover:bg-accent-600 text-white font-semibold transition-colors disabled:opacity-60"
          >
            {saving ? 'Saving' : 'Save settings'}
          </button>
          <button
            type="button"
            onClick={recalculate}
            disabled={recalculating || !initial.enabled}
            className="control-md bg-surface border border-border-secondary hover:bg-surface-secondary text-foreground font-semibold transition-colors disabled:opacity-60"
          >
            {recalculating ? 'Recalculating' : 'Recalculate now'}
          </button>
        </div>
      ) : (
        <p className="text-xs text-foreground-muted">Read-only access: these settings cannot be changed.</p>
      )}
    </form>
  )
}
