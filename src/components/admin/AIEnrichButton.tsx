'use client'

import { useState } from 'react'

interface Props {
  fieldLabel: string
  value: string
  onChange: (value: string) => void
  context?: string
  children?: React.ReactNode
}

export default function AIEnrichButton({ fieldLabel, value, onChange, context, children }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [prev, setPrev] = useState<string | null>(null)

  async function handleEnrich() {
    if (!value.trim() || loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/ai-enrich-field', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fieldLabel, value, context }),
      })
      const data = await res.json() as { result?: string; error?: string }
      if (!res.ok || !data.result) {
        setError(data.error || 'Enrichment failed')
        return
      }
      setPrev(value)
      onChange(data.result)
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  function handleUndo() {
    if (prev !== null) {
      onChange(prev)
      setPrev(null)
      setError(null)
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {children}
      <button
        type="button"
        onClick={handleEnrich}
        disabled={loading || !value.trim()}
        title="Enrich with AI"
        className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 border border-violet-200 dark:border-violet-700 hover:bg-violet-100 dark:hover:bg-violet-800/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? (
          <>
            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Enriching…
          </>
        ) : (
          <>
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
            AI
          </>
        )}
      </button>
      {prev !== null && (
        <button
          type="button"
          onClick={handleUndo}
          title="Undo AI enrichment"
          className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-800/40 transition-colors"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 14L5 10l4-4M5 10h9a5 5 0 010 10H9" />
          </svg>
          Undo
        </button>
      )}
      {error && (
        <span className="text-[11px] text-red-500 dark:text-red-400">{error}</span>
      )}
    </div>
  )
}
