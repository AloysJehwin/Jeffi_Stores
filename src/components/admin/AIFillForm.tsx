'use client'

import { useState } from 'react'
import { RequireWrite } from '@/contexts/AdminScopesContext'

export interface AIFillField {
  name: string
  label: string
  type: 'text' | 'number' | 'boolean' | 'textarea'
}

interface Props {
  fields: AIFillField[]
  onFill: (values: Record<string, unknown>) => void
  context?: string
}

export default function AIFillForm({ fields, onFill, context }: Props) {
  const [scenario, setScenario] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filled, setFilled] = useState(false)

  async function handleFill() {
    if (!scenario.trim() || loading) return
    setLoading(true)
    setError(null)
    setFilled(false)
    try {
      const res = await fetch('/api/admin/ai-fill-form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenario: context ? `${context}\n${scenario.trim()}` : scenario.trim(),
          fields,
        }),
      })
      const data = await res.json() as { fields?: Record<string, unknown>; error?: string }
      if (!res.ok || !data.fields) {
        setError(data.error || 'AI fill failed')
        return
      }
      onFill(data.fields)
      setFilled(true)
      setTimeout(() => setFilled(false), 3000)
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-lg border border-violet-200 dark:border-violet-800/50 bg-violet-50 dark:bg-violet-900/10 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <svg className="w-4 h-4 text-violet-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
        </svg>
        <span className="text-sm font-semibold text-violet-700 dark:text-violet-300">AI Fill</span>
        <span className="text-xs text-violet-500 dark:text-violet-400">Describe what you need — AI fills all fields</span>
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={scenario}
          onChange={e => setScenario(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleFill()}
          placeholder="e.g. 10% discount coupon for new customers, valid 30 days…"
          className="flex-1 px-3 py-2 text-sm border border-violet-200 dark:border-violet-700 rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent"
        />
        <RequireWrite scope="products:write">
          <button
            type="button"
            onClick={handleFill}
            disabled={loading || !scenario.trim()}
            className="px-4 py-2 text-sm font-semibold bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 flex-shrink-0"
          >
            {loading ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                Filling…
              </>
            ) : filled ? (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Filled!
              </>
            ) : 'Fill with AI'}
          </button>
        </RequireWrite>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}
