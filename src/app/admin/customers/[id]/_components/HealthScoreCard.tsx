'use client'

import { useState } from 'react'
import { RequireWrite } from '@/contexts/AdminScopesContext'

interface HealthBreakdown {
  score: number
  recency_score: number
  frequency_score: number
  monetary_score: number
  engagement_score: number
  satisfaction_score: number
  churn_risk: 'healthy' | 'rising_concern' | 'high'
  trend_delta_7d: number
  trend_delta_30d: number
  last_computed_at: string
}

const RISK_LABEL: Record<string, { label: string; color: string }> = {
  healthy:        { label: 'Healthy',        color: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  rising_concern: { label: 'Rising concern', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300' },
  high:           { label: 'High risk',      color: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
}

function scoreColor(score: number) {
  if (score >= 70) return { ring: 'stroke-green-500', text: 'text-green-600 dark:text-green-400' }
  if (score >= 40) return { ring: 'stroke-yellow-500', text: 'text-yellow-600 dark:text-yellow-400' }
  return { ring: 'stroke-red-500', text: 'text-red-600 dark:text-red-400' }
}

function Bar({ label, value, weight }: { label: string; value: number; weight: number }) {
  const color = value >= 70 ? 'bg-green-500' : value >= 40 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-foreground-secondary">{label}</span>
        <span className="text-foreground-muted">
          <span className="font-semibold text-foreground">{value}</span>
          <span className="text-[10px] ml-1">×{weight}%</span>
        </span>
      </div>
      <div className="h-1.5 bg-surface-secondary rounded-full mt-1 overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

export default function HealthScoreCard({ customerId, initial }: { customerId: string; initial: HealthBreakdown | null }) {
  const [health, setHealth] = useState<HealthBreakdown | null>(initial)
  const [busy, setBusy] = useState(false)

  async function recompute() {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/health`, {
        method: 'POST',
        credentials: 'include',
      })
      if (res.ok) {
        const data = await res.json()
        setHealth(data.health)
      }
    } finally {
      setBusy(false)
    }
  }

  if (!health) {
    return (
      <div>
        <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest mb-3">Health Score</h2>
        <p className="text-sm text-foreground-muted">No score computed yet.</p>
        <RequireWrite scope="customers:write">
        <button
          type="button"
          onClick={recompute}
          disabled={busy}
          className="mt-3 px-3 py-1.5 bg-accent-500 hover:bg-accent-600 text-white rounded-lg text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
        >
          {busy ? 'Computing…' : 'Compute now'}
        </button>
        </RequireWrite>
      </div>
    )
  }

  const sc = scoreColor(health.score)
  const risk = RISK_LABEL[health.churn_risk] ?? RISK_LABEL.healthy
  const circumference = 2 * Math.PI * 36
  const offset = circumference - (health.score / 100) * circumference

  const arrow = health.trend_delta_30d > 5 ? '▲' : health.trend_delta_30d < -5 ? '▼' : '→'
  const arrowColor = health.trend_delta_30d > 5
    ? 'text-green-600 dark:text-green-400'
    : health.trend_delta_30d < -5
    ? 'text-red-600 dark:text-red-400'
    : 'text-foreground-muted'

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest">Health Score</h2>
        <RequireWrite scope="customers:write">
        <button
          type="button"
          onClick={recompute}
          disabled={busy}
          className="text-[10px] font-semibold text-accent-500 hover:text-accent-600 transition-colors disabled:opacity-50"
        >
          {busy ? 'Recomputing…' : 'Recompute'}
        </button>
        </RequireWrite>
      </div>

      <div className="flex items-center gap-4 mb-4">
        <div className="relative w-24 h-24 shrink-0">
          <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
            <circle cx="40" cy="40" r="36" strokeWidth="6" fill="none" className="stroke-surface-secondary" />
            <circle
              cx="40" cy="40" r="36" strokeWidth="6" fill="none"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
              className={sc.ring}
              style={{ transition: 'stroke-dashoffset 0.5s ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-2xl font-bold ${sc.text}`}>{health.score}</span>
            <span className="text-[9px] text-foreground-muted uppercase tracking-wide">/ 100</span>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <span className={`inline-block px-2 py-0.5 text-xs font-semibold rounded-full ${risk.color}`}>
            {risk.label}
          </span>
          <p className={`mt-2 text-xs ${arrowColor}`}>
            <span className="font-bold">{arrow}</span>
            {' '}
            {health.trend_delta_30d > 0 ? '+' : ''}{health.trend_delta_30d} (30d)
            {' · '}
            {health.trend_delta_7d > 0 ? '+' : ''}{health.trend_delta_7d} (7d)
          </p>
          <p className="text-[10px] text-foreground-muted mt-1">
            Updated {new Date(health.last_computed_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Bar label="Recency"      value={health.recency_score}      weight={40} />
        <Bar label="Frequency"    value={health.frequency_score}    weight={30} />
        <Bar label="Monetary"     value={health.monetary_score}     weight={20} />
        <Bar label="Engagement"   value={health.engagement_score}   weight={5} />
        <Bar label="Satisfaction" value={health.satisfaction_score} weight={5} />
      </div>
    </div>
  )
}
