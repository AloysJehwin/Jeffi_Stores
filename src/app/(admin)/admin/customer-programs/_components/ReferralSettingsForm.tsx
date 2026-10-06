'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { useToast } from '@/contexts/ToastContext'
import type { ReferralSettings } from '@/lib/referrals/settings'

const inputClass =
  'w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent disabled:opacity-60'
const labelClass = 'block text-sm font-medium text-foreground-secondary mb-1.5'
const hintClass = 'mt-1 text-xs text-foreground-muted'
const cardClass = 'bg-surface-elevated rounded-lg border border-border-default p-6 space-y-5'
const headingClass = 'text-sm font-semibold text-foreground-secondary uppercase tracking-wide'

function firstFieldError(body: { error?: string; fields?: Record<string, string> } | null): string {
  const field = body?.fields ? Object.values(body.fields)[0] : null
  return field || body?.error || 'Could not save the settings'
}

export default function ReferralSettingsForm({ initial }: { initial: ReferralSettings }) {
  const router = useRouter()
  const { showToast } = useToast()
  const canWrite = useCanWrite('campaigns')
  const [rewardPoints, setRewardPoints] = useState(String(initial.rewardPoints))
  const [yearlyCap, setYearlyCap] = useState(String(initial.yearlyCap))
  const [qualifyDays, setQualifyDays] = useState(String(initial.qualifyDays))
  const [saving, setSaving] = useState(false)

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/referrals', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rewardPoints: Number(rewardPoints),
          yearlyCap: Number(yearlyCap),
          qualifyDays: Number(qualifyDays),
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        showToast(firstFieldError(body), 'error')
        return
      }
      showToast('Referral settings saved', 'success')
      router.refresh()
    } catch {
      showToast('Could not save the settings', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <div className={cardClass}>
        <h2 className={headingClass}>Rewards</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <div>
            <label htmlFor="referral-points" className={labelClass}>
              Reward points
            </label>
            <input
              id="referral-points"
              inputMode="numeric"
              value={rewardPoints}
              onChange={e => setRewardPoints(e.target.value.replace(/\D/g, '').slice(0, 6))}
              disabled={!canWrite}
              className={inputClass}
            />
            <p className={hintClass}>Paid to the referrer per friend. Spendable only, never counts toward tier.</p>
          </div>
          <div>
            <label htmlFor="referral-cap" className={labelClass}>
              Rewards per customer per year
            </label>
            <input
              id="referral-cap"
              inputMode="numeric"
              value={yearlyCap}
              onChange={e => setYearlyCap(e.target.value.replace(/\D/g, '').slice(0, 4))}
              disabled={!canWrite}
              className={inputClass}
            />
            <p className={hintClass}>Counted over the last 12 months. A reward taken back frees its slot.</p>
          </div>
          <div>
            <label htmlFor="referral-days" className={labelClass}>
              First order within (days)
            </label>
            <input
              id="referral-days"
              inputMode="numeric"
              value={qualifyDays}
              onChange={e => setQualifyDays(e.target.value.replace(/\D/g, '').slice(0, 3))}
              disabled={!canWrite}
              className={inputClass}
            />
            <p className={hintClass}>The friend&apos;s first delivered order must be placed this soon after signing up.</p>
          </div>
        </div>
      </div>

      {canWrite ? (
        <button
          type="submit"
          disabled={saving}
          className="px-6 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold transition-colors text-sm disabled:opacity-60"
        >
          {saving ? 'Saving' : 'Save settings'}
        </button>
      ) : (
        <p className="text-xs text-foreground-muted">Read-only access: these settings cannot be changed.</p>
      )}
    </form>
  )
}
